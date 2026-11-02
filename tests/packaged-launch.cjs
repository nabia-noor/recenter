// Test the real packaged executable. Inspector is used only by this runner to
// isolate its profile before main.js executes; no testing IPC is shipped.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = async function checkPackagedLaunch(
  executable,
  profile,
  phase,
) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  const child = spawn(executable, ["--inspect-brk=127.0.0.1:0", "--disable-gpu"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const exited = new Promise((resolve) =>
    child.once("exit", (code) => resolve(code)),
  );
  let diagnostics = "";
  child.stderr.on("data", (chunk) => {
    diagnostics = (diagnostics + chunk).slice(-4000);
  });
  child.stdout.resume();
  let socket;
  try {
    const url = await new Promise((resolve, reject) => {
      let output = "";
      const timeout = setTimeout(
        () => reject(Error("Packaged inspector startup timed out")),
        20000,
      );
      child.once("error", reject);
      child.stderr.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[0]);
        }
      });
    });
    socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    let serial = 0;
    const pending = new Map();
    let paused;
    const firstPause = new Promise((resolve) => {
      paused = resolve;
    });
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(event.data);
      if (response.method === "Debugger.paused") paused(response.params);
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      clearTimeout(entry.timer);
      if (response.error) entry.reject(Error(JSON.stringify(response.error)));
      else entry.resolve(response.result);
    });
    const rpc = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error(`Inspector timeout: ${method}`));
        }, 20000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const value = (response) => {
      if (response.exceptionDetails)
        throw Error(JSON.stringify(response.exceptionDetails));
      return response.result?.value;
    };
    await rpc("Debugger.enable");
    await rpc("Runtime.runIfWaitingForDebugger");
    const pause = await Promise.race([
      firstPause,
      delay(20000).then(() => {
        throw Error("No startup pause");
      }),
    ]);
    value(
      await rpc("Debugger.evaluateOnCallFrame", {
        callFrameId: pause.callFrames[0].callFrameId,
        expression: `globalThis.__recenterCheckElectron = require('electron');
        __recenterCheckElectron.app.setPath('userData', ${JSON.stringify(profile)});
        __recenterCheckElectron.app.setPath('sessionData', ${JSON.stringify(profile)});
        __recenterCheckElectron.app.on('browser-window-created', (_event, window) => {
          window.webContents.on('did-fail-load', (_event, code, description) => console.error('Test renderer load:', code, description));
          window.webContents.on('render-process-gone', (_event, details) => console.error('Test renderer exited:', JSON.stringify(details)));
          window.show = () => {}; window.showInactive = () => {}; window.focus = () => {};
        }); true`,
        returnByValue: true,
      }),
    );
    await rpc("Debugger.resume");
    const evaluate = async (expression) =>
      value(
        await rpc("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true,
        }),
      );
    let ready = false;
    const readyDeadline = Date.now() + 60000;
    for (; Date.now() < readyDeadline;) {
      ready = await evaluate(`(async () => {
        const window = __recenterCheckElectron.BrowserWindow.getAllWindows()[0];
        return window && !window.webContents.isLoading() && await window.webContents.executeJavaScript(
          "!!document.querySelector('.section-heading button') && !document.querySelector('.storage-loading')");
      })()`);
      if (ready) break;
      await delay(100);
    }
    assert.ok(ready, `Installed renderer did not load: ${diagnostics}`);
    const info = await evaluate(`({name:__recenterCheckElectron.app.getName(),
      packaged:__recenterCheckElectron.app.isPackaged,
      profile:__recenterCheckElectron.app.getPath('userData'),
      resizable:__recenterCheckElectron.BrowserWindow.getAllWindows()[0].isResizable(),
      fullscreen:__recenterCheckElectron.BrowserWindow.getAllWindows()[0].isFullScreen()})`);
    assert.equal(info.name, "Recenter");
    assert.equal(info.packaged, true);
    assert.equal(info.profile, profile);
    assert.equal(info.resizable, false);
    assert.equal(info.fullscreen, false);
    await evaluate(
      `__recenterCheckElectron.BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(${JSON.stringify(`(async () => {
      const check = (ok, message) => { if (!ok) throw Error(message); };
      const wait = () => new Promise(resolve => setTimeout(resolve,100));
      const query = selector => document.querySelector(selector);
      check(document.title === 'Recenter', 'Installed window title');
      check(query('.brand').textContent.trim() === 'Recenter.', 'Installed brand');
      check(query('h1').textContent === 'Return to what matters.', 'Installed tagline');
      check(query('.page-description').textContent.trim() === 'Capture the idea of returning to your values, intentions, and commitments throughout the day.', 'Installed description');
      check(!query('.storage-error'), 'Installed storage load failed');
      check(typeof require === 'undefined' && typeof process === 'undefined', 'Renderer security');
      check(document.querySelectorAll('.default-card').length === 4, 'Defaults missing');
      check(document.body.scrollWidth <= innerWidth && document.body.scrollHeight <= innerHeight, 'Window overflow');
      if (${JSON.stringify(phase)} === 'create') {
        query('.section-heading button').click(); await wait();
        check(query('dialog').open, 'Installed New Reminder button');
        for (const [id, value] of [['title','Installed Recenter check'],['date','2099-11-03'],['time','09:30']]) {
          const input = query('#reminder-' + id);
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
          input.dispatchEvent(new Event('input',{bubbles:true})); await wait();
        }
        query('form').requestSubmit(); await wait();
        check(!query('dialog').open && query('.personal-card h3').textContent === 'Installed Recenter check', 'Installed save failed');
      } else {
        check(query('.personal-card h3').textContent === 'Installed Recenter check', 'Installed restart lost data');
      }
      return true;
    })()`)})`,
    );
    await delay(500);
    const screenshot = await evaluate(
      `__recenterCheckElectron.BrowserWindow.getAllWindows()[0].webContents.capturePage().then(image => image.toPNG().toString('base64'))`,
    );
    fs.writeFileSync(
      path.join(profile, `installed-${phase}.png`),
      Buffer.from(screenshot, "base64"),
    );
    await rpc("Debugger.disable");
    await evaluate(
      "setTimeout(() => __recenterCheckElectron.app.quit(), 500); true",
    );
    socket.close();
    const exitCode = await Promise.race([
      exited,
      delay(30000).then(() => {
        throw Error(`Installed app did not quit: ${diagnostics}`);
      }),
    ]);
    assert.equal(exitCode, 0);
    console.log(`Installed packaged Recenter ${phase} passed.`);
  } finally {
    socket?.close();
    if (child.exitCode === null) child.kill();
  }
};

if (require.main === module) {
  const executable = path.resolve(process.argv[2]);
  const profile = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "recenter-packaged-"),
  );
  module
    .exports(executable, profile, "create")
    .then(() => module.exports(executable, profile, "restart"))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
