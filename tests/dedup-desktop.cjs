// Real main/preload startup against legacy duplicate data, with all windows hidden.
const { app, BrowserWindow, Notification } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const profile = process.env.REMINDERS_CHECK_PROFILE;
if (!profile) throw Error("Use the desktop runner");
app.setPath("userData", profile);
app.on("browser-window-created", (_event, window) => {
  window.show = () => {};
  window.showInactive = () => {};
  window.focus = () => {};
});
let deliveries = 0;
Notification.prototype.show = function () {
  deliveries++;
};
const file = path.join(profile, "personal-reminders.json");
if (process.env.REMINDERS_CHECK_PHASE === "dedup-first") {
  const reminder = {
    id: "existing-personal",
    title: "Existing reminder",
    date: "2000-01-01",
    time: "10:00",
    repeat: "none",
    note: "Must be preserved",
  };
  const occurrence = "2000-01-01T10:00";
  const first = {
    reminder,
    occurrence,
    signature: "old-daily",
    key: JSON.stringify([reminder.id, "old-daily", occurrence]),
  };
  const second = {
    ...first,
    signature: "old-weekly",
    key: JSON.stringify([reminder.id, "old-weekly", occurrence]),
  };
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      reminders: [reminder],
      receipts: {},
      imports: { "file:renderer": true },
      deleted: [],
      pending: [first, second],
      handled: { [first.key]: "2000-01-01T10:01:00.000Z" },
    }),
  );
}
const original = fs.readFileSync(file, "utf8");
const timer = setTimeout(() => {
  console.error("Dedup startup timed out");
  app.exit(1);
}, 20000);
app.on("web-contents-created", (_event, contents) => {
  contents.once("did-finish-load", async () => {
    if (
      contents.getURL().includes("/popup.html") ||
      contents.getTitle() === "Reminder black overlay"
    )
      return;
    try {
      await new Promise((resolve) => setTimeout(resolve, 1600));
      if (BrowserWindow.getAllWindows().length !== 1)
        throw Error("Handled occurrence created popup/overlay windows");
      if (deliveries !== 0)
        throw Error("Handled occurrence repeated a native notification");
      if (fs.readFileSync(file, "utf8") !== original)
        throw Error("Loading reset or rewrote existing data");
      const count = await contents.executeJavaScript(
        `document.querySelectorAll('.personal-card').length`,
      );
      if (count !== 1) throw Error("Saved personal reminder was lost");
      console.log(process.env.REMINDERS_CHECK_PHASE + " passed");
      clearTimeout(timer);
      app.quit();
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
});
require("../out/main/index.js");
