// Runs the real app across restarts with an isolated profile. The notification
// show method is stubbed so automated tests never send real OS notifications.
// No personal reminder data or normal app profile is touched.
const fs = require("node:fs");
const path = require("node:path");
const interactive = process.env.REMINDERS_INTERACTIVE_TESTS === "1";

if (!process.versions.electron) {
  const { spawnSync } = require("node:child_process");
  const profile = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "reminders-check-"),
  );
  const env = { ...process.env, REMINDERS_CHECK_PROFILE: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_RENDERER_URL;
  try {
    for (const phase of [
      "create",
      "edit-delete",
      "verify-delete",
      "verify-empty",
      ...(interactive ? ["notifications", "notify-restart"] : []),
    ]) {
      const result = spawnSync(require("electron"), [__filename], {
        env: { ...env, REMINDERS_CHECK_PHASE: phase },
        stdio: "inherit",
        timeout: 60000,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) throw Error(`Desktop check failed: ${phase}`);
    }
    for (const [phase, directory] of [
      ["stale-host", "stale"],
      ["seed-legacy", "migration"],
      ["import-legacy", "migration"],
      ["retry-store", "recovery"],
      ["verify-recovery", "recovery"],
    ]) {
      const isolatedProfile = path.join(profile, directory);
      fs.mkdirSync(isolatedProfile, { recursive: true });
      const result = spawnSync(
        require("electron"),
        [path.join(__dirname, "load-recovery.cjs")],
        {
          env: {
            ...env,
            REMINDERS_CHECK_PROFILE: isolatedProfile,
            REMINDERS_CHECK_PHASE: phase,
          },
          stdio: "inherit",
          timeout: 60000,
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw Error(`Load recovery check failed: ${phase}`);
    }
    const popupProfile = path.join(profile, "popup-tests");
    const dedupProfile = path.join(profile, "dedup-tests");
    fs.mkdirSync(dedupProfile);
    for (const phase of ["dedup-first", "dedup-restart"]) {
      const result = spawnSync(
        require("electron"),
        [path.join(__dirname, "dedup-desktop.cjs")],
        {
          env: {
            ...env,
            REMINDERS_CHECK_PROFILE: dedupProfile,
            REMINDERS_CHECK_PHASE: phase,
          },
          stdio: "inherit",
          timeout: 30000,
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) throw Error(`Dedup check failed: ${phase}`);
    }
    fs.mkdirSync(popupProfile);
    for (const phase of interactive
      ? ["popup-interactions", "popup-resume", "popup-handled"]
      : []) {
      const result = spawnSync(
        require("electron"),
        [path.join(__dirname, "popup-desktop.cjs")],
        {
          env: {
            ...env,
            REMINDERS_CHECK_PROFILE: popupProfile,
            REMINDERS_CHECK_PHASE: phase,
          },
          stdio: "inherit",
          timeout: 75000,
        },
      );
      if (result.error) throw result.error;
      if (result.status !== 0) throw Error(`Popup check failed: ${phase}`);
    }
    console.log(
      "Desktop CRUD, validation, persistence across restarts and security checks passed.",
    );
  } finally {
    // This path is the unique directory returned by mkdtempSync above.
    fs.rmSync(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
} else {
  const { app, BrowserWindow, Notification } = require("electron");
  if (!interactive)
    app.on("browser-window-created", (_event, window) => {
      window.show = () => {};
      window.showInactive = () => {};
      window.focus = () => {};
    });
  const phaseName = process.env.REMINDERS_CHECK_PHASE;
  const sent = [];
  Notification.prototype.show = function () {
    sent.push(this);
  };
  const dataPath = path.join(
    process.env.REMINDERS_CHECK_PROFILE,
    "personal-reminders.json",
  );
  if (phaseName === "notifications") {
    const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
    data.reminders = [
      {
        id: "notification-check",
        title: "Notification check",
        note: "Click restores the app",
        date: "2000-01-01",
        time: "10:00",
        repeat: "none",
      },
    ];
    fs.writeFileSync(dataPath, JSON.stringify(data));
  }
  app.setPath("userData", process.env.REMINDERS_CHECK_PROFILE);
  const timeout = setTimeout(() => {
    console.error("Desktop check timed out");
    app.exit(1);
  }, 45000);
  app.on("web-contents-created", (_event, contents) => {
    contents.on("preload-error", (_event, _file, error) => {
      console.error(error);
      app.exit(1);
    });
    contents.once("did-finish-load", async () => {
      if (contents.getTitle() === "Reminder black overlay") return;
      if (contents.getURL().includes("/popup.html")) return;
      try {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const phase = process.env.REMINDERS_CHECK_PHASE;
        const result = await contents.executeJavaScript(`(async () => {
          const phase = ${JSON.stringify(phase)};
          const wait = () => new Promise(resolve => setTimeout(resolve, 70));
          const check = (value, message) => { if (!value) throw Error(message); };
          const query = selector => document.querySelector(selector);
          const click = async selector => { query(selector).click(); await wait(); };
          const submit = async () => { query('.reminder-dialog form').requestSubmit(); await wait(); };
          const set = async (selector, value) => {
            const input = query(selector);
            const type = input instanceof HTMLSelectElement ? HTMLSelectElement : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
            Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(input, value);
            input.dispatchEvent(new Event(type === HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
            await wait();
          };
          const checkDefaults = () => {
            check(document.querySelectorAll('.default-card').length === 4, 'Defaults changed');
            check(!query('.defaults-panel button'), 'Personal actions leaked into defaults');
          };
          check(typeof require === 'undefined' && typeof process === 'undefined', 'Node exposed in renderer');
          checkDefaults();
          check(document.title === 'Recenter', 'Window branding changed');
          check(query('.brand').textContent.trim() === 'Recenter.', 'App brand missing');
          check(query('main h1').textContent === 'Return to what matters.', 'Tagline changed');
          check(query('.page-description').textContent.trim() === 'Capture the idea of returning to your values, intentions, and commitments throughout the day.', 'Supporting description changed');
          check(query('.brand-icon svg circle'), 'Focus brand icon missing');
          for (let i=0; i<100 && query('.storage-loading'); i++) await wait();
          check(!query('.storage-error') && !query('.storage-loading'), 'Reminder bridge did not load');
          check(!window.reminders.invoke && !window.reminders.send, 'Generic IPC exposed');
          if (phase === 'create') {
            check(!query('.personal-card'), 'Test profile not empty');
            await click('.section-heading button');
            check(query('dialog').open, 'New Reminder did not open');
            check(document.activeElement.id === 'reminder-title', 'Title not focused');
            const rect = query('dialog').getBoundingClientRect();
            check(Math.abs(rect.left + rect.width / 2 - innerWidth / 2) < 2 && Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 2, 'Dialog not centered');
            check(rect.top >= 0 && rect.bottom <= innerHeight, 'Dialog does not fit');
            await submit();
            check(query('#title-error') && query('#date-error') && query('#time-error'), 'Required fields not validated');
            await set('#reminder-title', '  Smoke reminder  ');
            await set('#reminder-date', '2026-11-03');
            await set('#reminder-time', '09:30');
            await set('#reminder-repeat', 'daily');
            await set('#reminder-note', 'Saved locally');
            await submit();
            check(!query('dialog').open, 'Save did not close dialog');
            check(query('.personal-card h3').textContent === 'Smoke reminder', 'New card missing');
            check(query('.personal-card .reminder-details').textContent.includes('Daily'), 'Repeat label missing');
            check(query('.count').textContent === '1', 'Count wrong');
            await click('.section-heading button');
            check(query('#reminder-title').value === '' && query('#reminder-repeat').value === 'none', 'Create form not reset');
            await click('form .secondary-button');
            check(document.querySelectorAll('.personal-card').length === 1, 'Cancel created a reminder');
          } else if (phase === 'edit-delete') {
            check(query('.personal-card h3').textContent === 'Smoke reminder', 'Reminder lost after restart');
            await click('[aria-label="Edit Smoke reminder"]');
            check(query('#reminder-date').value === '2026-11-03' && query('#reminder-time').value === '09:30' && query('#reminder-repeat').value === 'daily', 'Edit fields not restored');
            await set('#reminder-title', 'Cancelled edit');
            await click('form .secondary-button');
            check(query('.personal-card h3').textContent === 'Smoke reminder', 'Cancelled edit changed reminder');
            await click('[aria-label="Edit Smoke reminder"]');
            await set('#reminder-title', 'Edited reminder');
            await set('#reminder-date', '2026-11-04');
            await set('#reminder-time', '17:45');
            await set('#reminder-repeat', 'weekly');
            await submit();
            check(query('.personal-card h3').textContent === 'Edited reminder', 'Edit not displayed');
            check(query('.personal-card .reminder-details').textContent.includes('Weekly'), 'Edit repeat not displayed');
            const stored = (await window.reminders.initialize(null, false)).reminders[0];
            check(stored.title === 'Edited reminder' && stored.date === '2026-11-04' && stored.time === '17:45' && stored.repeat === 'weekly', 'Edit not persisted');
          } else if (phase === 'verify-delete') {
            check(query('.personal-card h3').textContent === 'Edited reminder', 'Edited reminder lost after restart');
            await click('[aria-label="Delete Edited reminder"]');
            check(query('.delete-dialog').open, 'Delete confirmation missing');
            await click('.delete-dialog .secondary-button');
            check(query('.personal-card'), 'Cancel deleted reminder');
            await click('[aria-label="Delete Edited reminder"]');
            await click('.danger-button');
            check(!query('.personal-card') && query('.empty-state'), 'Delete did not restore empty state');
            check((await window.reminders.initialize(null, false)).reminders.length === 0, 'Delete not persisted');
          } else if (phase === 'verify-empty') {
            check(!query('.personal-card') && query('.empty-state'), 'Deleted reminder returned after restart');
          }
          checkDefaults();
          return phase + ' passed';
        })()`);
        console.log(result);
        if (phase === "notifications") {
          if (sent.length !== 1)
            throw Error("Due personal reminder was not delivered exactly once");
          const window = BrowserWindow.fromWebContents(contents);
          window.minimize();
          await new Promise((resolve) => setTimeout(resolve, 200));
          sent[0].emit("click");
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (window.isMinimized() || !window.isVisible())
            throw Error("Notification click did not restore the window");
          if (
            BrowserWindow.getAllWindows().filter(
              (window) =>
                !window.webContents.getURL().includes("/popup.html") &&
                window.getTitle() !== "Reminder black overlay",
            ).length !== 1
          )
            throw Error("Click created duplicate window");
          sent[0].emit("failed", {}, "Simulated OS rejection");
          const status = await contents.executeJavaScript(
            "window.reminders.status()",
          );
          if (!status.includes("Simulated OS rejection"))
            throw Error("OS failure not reported");
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (sent.length !== 1) throw Error("Occurrence repeated");
        }
        if (phase === "notify-restart") {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          if (sent.length !== 0)
            throw Error("Claimed occurrence repeated after restart");
        }
        if (phase === "verify-delete") {
          await contents.reload();
          await new Promise((resolve) =>
            contents.once("did-finish-load", resolve),
          );
          await new Promise((resolve) => setTimeout(resolve, 200));
          if (
            !(await contents.executeJavaScript(
              `!document.querySelector('.personal-card') && !!document.querySelector('.empty-state')`,
            ))
          )
            throw Error("Deleted reminder returned after reload");
        }
        clearTimeout(timeout);
        app.quit();
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  });
  require("../out/main/index.js");
}
