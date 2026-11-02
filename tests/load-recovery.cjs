// Reproduces stale-host and retry failures in disposable profiles, never real data.
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, Notification } = require("electron");
const phase = process.env.REMINDERS_CHECK_PHASE;
const profile = process.env.REMINDERS_CHECK_PROFILE;
if (!profile || !phase) throw Error("Run through tests/electron-smoke.cjs");
app.setPath("userData", profile);
if (process.env.REMINDERS_INTERACTIVE_TESTS !== "1")
  app.on("browser-window-created", (_event, window) => {
    window.show = () => {};
    window.showInactive = () => {};
    window.focus = () => {};
  });
Notification.prototype.show = function () {};
const canonicalPath = path.join(profile, "personal-reminders.json");
const legacy = JSON.stringify({
  version: 1,
  reminders: [
    {
      id: "legacy-existing",
      title: "Existing local reminder",
      note: "Keep this note",
      date: "2099-01-01",
      time: "10:00",
      repeat: "weekly",
    },
  ],
});
const fixture = {
  version: 1,
  reminders: [
    {
      id: "retry-existing",
      title: "Existing file reminder",
      note: "",
      date: "2099-01-02",
      time: "11:00",
      repeat: "none",
    },
  ],
  receipts: {},
  imports: { "file:renderer": true },
  deleted: [],
};
const broken = '{"version":1,';
if (phase === "retry-store") fs.writeFileSync(canonicalPath, broken);
const timeout = setTimeout(() => {
  console.error("Load recovery check timed out");
  app.exit(1);
}, 45000);
app.on("web-contents-created", (_event, contents) => {
  contents.on("preload-error", (_e, _p, error) => {
    console.error(error);
    app.exit(1);
  });
  contents.on("console-message", (_event, ...details) => {
    if (
      details.some(
        (detail) =>
          typeof detail === "string" &&
          detail.includes("Reminder initialization failed"),
      )
    )
      console.log("Expected renderer diagnostic:", ...details);
  });
  contents.once("did-finish-load", async () => {
    if (contents.getTitle() === "Reminder black overlay") return;
    if (contents.getURL().includes("/popup.html")) return;
    try {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const common = `
        const wait = () => new Promise(resolve => setTimeout(resolve, 80));
        const check = (v, message) => { if (!v) throw Error(message); };
        const query = s => document.querySelector(s);
        const click = async s => { query(s).click(); await wait(); };
        const retry = async () => {
          await click('.storage-error button');
          for (let i=0;i<100 && query('.storage-loading');i++) await wait();
        };
      `;
      if (phase === "stale-host") {
        await contents.executeJavaScript(`(async()=>{${common}
          check(typeof window.reminders === 'undefined', 'Old host unexpectedly has bridge');
          check(query('.storage-error').textContent.includes('Fully close the app'), 'Missing restart explanation');
          check(!query('.section-heading button').disabled, 'New Reminder is disabled on loading failure');
          await click('.section-heading button');
          check(query('dialog').open, 'New Reminder does not open during loading failure');
          check(query('form [type="submit"]').disabled, 'Unsafe save allowed without storage');
          await click('form .secondary-button'); await retry();
          check(query('.storage-error').textContent.includes('preload'), 'Retry hides the actual cause');
          window.__runtimeErrors = []; window.addEventListener('error', e => window.__runtimeErrors.push(e.message));
          await new Promise(resolve => setTimeout(resolve, 5200));
          check(window.__runtimeErrors.length === 0, 'Status polling throws with missing bridge');
          check(document.querySelectorAll('.default-card').length === 4, 'Defaults changed');
        })()`);
      } else if (phase === "seed-legacy") {
        await contents.executeJavaScript(
          `localStorage.setItem('reminders.personal.v1', ${JSON.stringify(legacy)})`,
        );
      } else if (phase === "import-legacy") {
        await contents.executeJavaScript(`(async()=>{${common}
          for(let i=0;i<100 && query('.storage-loading');i++) await wait();
          check(query('.personal-card h3')?.textContent === 'Existing local reminder', 'Legacy reminder not imported');
          check(localStorage.getItem('reminders.personal.v1') === ${JSON.stringify(legacy)}, 'Original legacy bytes changed');
          await click('.section-heading button'); check(query('dialog').open, 'New Reminder not working after migration');
        })()`);
        const backups = fs
          .readdirSync(profile)
          .filter((file) => file.includes(".legacy-"));
        if (
          backups.length !== 1 ||
          fs.readFileSync(path.join(profile, backups[0]), "utf8") !== legacy
        )
          throw Error("Legacy backup missing or changed");
      } else if (phase === "retry-store") {
        await contents.executeJavaScript(`(async()=>{${common}
          check(query('.storage-error')?.textContent.includes('SyntaxError'), 'Underlying store error hidden');
          await click('.section-heading button'); check(query('dialog').open, 'New Reminder cannot open');
          check(query('form [type="submit"]').disabled, 'Save should wait for successful storage load');
          await click('form .secondary-button'); await retry();
          check(!!query('.storage-error'), 'Retry swallowed persistent error');
        })()`);
        if (fs.readFileSync(canonicalPath, "utf8") !== broken)
          throw Error("Failed load overwrote source");
        // Simulate an external permission/data repair in this owned test fixture.
        fs.writeFileSync(canonicalPath, JSON.stringify(fixture));
        await contents.executeJavaScript(`(async()=>{${common}
          await retry();
          check(!query('.storage-error'), 'Retry never reopens the failed main-process store');
          check(query('.personal-card h3')?.textContent === 'Existing file reminder', 'Retry lost existing reminder');
          await click('.section-heading button');
          check(query('dialog').open && !query('form [type="submit"]').disabled, 'Form not usable after recovery');
          const values = { 'reminder-title':'Created after retry', 'reminder-date':'2099-02-01', 'reminder-time':'12:00' };
          for(const [id,value] of Object.entries(values)) {
            const input=document.getElementById(id);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
            input.dispatchEvent(new Event('input',{bubbles:true})); await wait();
          }
          query('form').requestSubmit(); await wait();
          check(!query('dialog').open && document.querySelectorAll('.personal-card').length === 2, 'Create after Retry failed');
        })()`);
      } else if (phase === "verify-recovery") {
        await contents.executeJavaScript(`(async()=>{${common}
          for(let i=0;i<100 && query('.storage-loading');i++) await wait();
          check(document.querySelectorAll('.personal-card').length === 2, 'Recovered reminders did not persist across restart');
          check(query('.personal-card h3').textContent === 'Existing file reminder', 'Existing data lost after restart');
        })()`);
      }
      console.log(phase + " passed");
      clearTimeout(timeout);
      app.quit();
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});
if (phase === "stale-host" || phase === "seed-legacy") {
  app.whenReady().then(() => {
    const window = new BrowserWindow({
      width: 1000,
      height: 700,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });
    void window.loadFile(path.join(__dirname, "../out/renderer/index.html"));
  });
} else require("../out/main/index.js");
