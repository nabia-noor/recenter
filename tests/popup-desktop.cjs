const { app, BrowserWindow, Notification, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const profile = process.env.REMINDERS_CHECK_PROFILE;
const phase = process.env.REMINDERS_CHECK_PHASE;
if (!profile) throw Error("Use the desktop test runner");
app.setPath("userData", profile);
Notification.prototype.show = function () {};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (value, message) => {
  if (!value) throw Error(message);
};
const read = () =>
  JSON.parse(
    fs.readFileSync(path.join(profile, "personal-reminders.json"), "utf8"),
  );
const timeout = setTimeout(() => {
  console.error("Popup desktop test timed out");
  app.exit(1);
}, 60000);
async function popupWindow() {
  for (let i = 0; i < 100; i++) {
    const popup = BrowserWindow.getAllWindows().find(
      (window) =>
        window.webContents.getURL().includes("/popup.html") &&
        !window.webContents.isLoading(),
    );
    if (
      popup &&
      (await popup.webContents.executeJavaScript(
        `!!document.querySelector('.hold-button') && !document.querySelector('.hold-button').disabled`,
      ))
    )
      return popup;
    await wait(100);
  }
  throw Error("Popup did not appear");
}
async function point(window) {
  return window.webContents.executeJavaScript(
    `(() => { const r=document.querySelector('.hold-button').getBoundingClientRect(); return { x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2) }; })()`,
  );
}
async function down(window) {
  window.show();
  window.focus();
  await wait(150);
  await window.webContents.executeJavaScript(`(() => {
    window.__popupTestEvents = [];
    if (window.__popupTestTracing) return;
    window.__popupTestTracing = true;
    for (const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','pointerleave','blur','focus']) {
      window.addEventListener(type, event => {
        window.__popupTestEvents.push({type, x:event.clientX, y:event.clientY, buttons:event.buttons});
      }, true);
    }
  })()`);
  const p = await point(window);
  window.webContents.sendInputEvent({ type: "mouseMove", ...p });
  window.webContents.sendInputEvent({
    type: "mouseDown",
    ...p,
    button: "left",
    clickCount: 1,
  });
  return p;
}
function up(window, point) {
  if (!window.isDestroyed())
    window.webContents.sendInputEvent({
      type: "mouseUp",
      ...point,
      button: "left",
      clickCount: 1,
    });
}
async function fullHold(window) {
  const p = await down(window);
  for (let i = 0; i < 65 && !window.isDestroyed(); i++) await wait(100);
  up(window, p);
  if (!window.isDestroyed()) {
    const diagnostic = await window.webContents.executeJavaScript(`({
      focused:document.hasFocus(), events:window.__popupTestEvents,
      progress:document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')
    })`);
    throw Error(
      `Full five-second hold did not close the popup: ${JSON.stringify(diagnostic)}`,
    );
  }
}
async function checkOverlays() {
  const overlays = BrowserWindow.getAllWindows().filter(
    (window) => window.getTitle() === "Reminder black overlay",
  );
  const displays = screen.getAllDisplays();
  check(
    overlays.length === displays.length,
    "Expected exactly one overlay per display",
  );
  for (const display of displays) {
    const overlay = overlays.find((window) => {
      const b = window.getBounds();
      return (
        Math.abs(b.x - display.bounds.x) <= 2 &&
        Math.abs(b.y - display.bounds.y) <= 2
      );
    });
    check(
      overlay && overlay.isVisible() && overlay.isAlwaysOnTop(),
      "Overlay missing or not above normal windows",
    );
    const bounds = overlay.getBounds();
    check(
      Math.abs(bounds.width - display.bounds.width) <= 2 &&
        Math.abs(bounds.height - display.bounds.height) <= 2,
      "Overlay does not cover full display bounds",
    );
    check(
      !overlay.getOpacity || overlay.getOpacity() === 1,
      "Overlay is not opaque",
    );
    check(
      await overlay.webContents.executeJavaScript(
        `getComputedStyle(document.body).backgroundColor === 'rgb(0, 0, 0)' && typeof window.reminders === 'undefined' && typeof require === 'undefined'`,
      ),
      "Overlay not solid black or has privileged APIs",
    );
  }
}
app.on("web-contents-created", (_event, contents) => {
  contents.on("preload-error", (_event, _file, error) => {
    console.error(error);
    app.exit(1);
  });
  contents.once("did-finish-load", async () => {
    if (contents.getTitle() === "Reminder black overlay") return;
    if (contents.getURL().includes("/popup.html")) return;
    try {
      await wait(400);
      const main = BrowserWindow.fromWebContents(contents);
      if (phase === "popup-interactions") {
        main.minimize();
        await contents.executeJavaScript(`(async()=>{
          await window.reminders.initialize(null,false);
          const r={id:'popup-first',title:'Take a little break',note:'A moment to reset your day.',date:'2000-01-01',time:'10:00',repeat:'none'};
          await window.reminders.save(r);
          await window.reminders.save({...r,id:'popup-second',title:'Drink a glass of water'});
        })()`);
        let popup = await popupWindow();
        check(
          main.isMinimized(),
          "Popup unexpectedly restored the main window",
        );
        check(popup.isAlwaysOnTop(), "Popup is not always on top");
        await checkOverlays();
        const initialOverlays = BrowserWindow.getAllWindows().filter(
          (window) => window.getTitle() === "Reminder black overlay",
        );
        popup.destroy();
        check(
          initialOverlays.every((window) => window.isDestroyed()),
          "Unexpected popup closure left black overlays behind",
        );
        popup = await popupWindow();
        await checkOverlays();
        check(
          await popup.webContents.executeJavaScript(
            `document.querySelector('h1').textContent === 'Take a little break' && typeof require === 'undefined' && typeof process === 'undefined'`,
          ),
          "Title or security check failed",
        );
        const rejected = await contents.executeJavaScript(
          `window.reminderPopup.get().then(()=>false,()=>true)`,
        );
        check(rejected, "Main renderer was allowed to access popup IPC");
        popup.close();
        await wait(150);
        check(!popup.isDestroyed(), "Popup closed without holding");
        fs.writeFileSync(
          path.join(profile, "popup-preview.png"),
          (await popup.webContents.capturePage()).toPNG(),
        );
        let p = await down(popup);
        await wait(1100);
        check(
          await popup.webContents.executeJavaScript(
            `Number(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')) > 0`,
          ),
          "Hold progress not visible",
        );
        up(popup, p);
        await wait(200);
        check(
          !popup.isDestroyed() && read().pending.length === 2,
          "Early release dismissed a reminder",
        );
        await checkOverlays();
        check(
          await popup.webContents.executeJavaScript(
            `document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') === '0'`,
          ),
          "Early release did not reset progress",
        );
        p = await down(popup);
        await wait(800);
        popup.webContents.sendInputEvent({ type: "mouseMove", x: 2, y: 2 });
        await wait(200);
        up(popup, { x: 2, y: 2 });
        check(
          await popup.webContents.executeJavaScript(
            `document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') === '0'`,
          ),
          "Leaving button did not reset",
        );
        p = await down(popup);
        await wait(800);
        main.restore();
        main.focus();
        await wait(250);
        up(popup, p);
        check(
          !popup.isDestroyed() && read().pending.length === 2,
          "Focus loss dismissed reminder",
        );
        check(
          await popup.webContents.executeJavaScript(
            `document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow') === '0'`,
          ),
          "Focus loss did not reset",
        );
        main.minimize();
        await fullHold(popup);
        popup = await popupWindow();
        await checkOverlays();
        check(
          read().pending.length === 1 &&
            Object.keys(read().handled).length === 1,
          "Dismissal was not recorded atomically",
        );
        check(
          await popup.webContents.executeJavaScript(
            `document.querySelector('h1').textContent === 'Drink a glass of water'`,
          ),
          "Second reminder was lost",
        );
      } else if (phase === "popup-resume") {
        const popup = await popupWindow();
        await checkOverlays();
        check(
          await popup.webContents.executeJavaScript(
            `document.querySelector('h1').textContent === 'Drink a glass of water'`,
          ),
          "Unhandled popup was not restored after restart",
        );
        await fullHold(popup);
        await wait(1200);
        check(
          read().pending.length === 0 &&
            Object.keys(read().handled).length === 2,
          "Queue not fully acknowledged",
        );
        check(
          BrowserWindow.getAllWindows().length === 1,
          "Duplicate popup reopened",
        );
      } else {
        await wait(1200);
        check(
          read().pending.length === 0,
          "Handled occurrence returned to queue",
        );
        check(
          BrowserWindow.getAllWindows().length === 1,
          "Handled popup reopened after restart",
        );
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
require("../out/main/index.js");
app.on("will-quit", () => {
  check(
    !BrowserWindow.getAllWindows().some(
      (window) => window.getTitle() === "Reminder black overlay",
    ),
    "Overlay survived app shutdown",
  );
});
