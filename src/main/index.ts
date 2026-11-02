import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  powerMonitor,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ReminderStore } from "./reminderStore.ts";
import { ReminderScheduler } from "./scheduler.ts";
import { ReminderPopup } from "./reminderPopup.ts";
import { APP_ID, APP_NAME, configureAppIdentity } from "./appIdentity.ts";

// Must precede the single-instance lock and Chromium session initialization.
configureAppIdentity(app);

let mainWindow: BrowserWindow | null = null;
let scheduler: ReminderScheduler | undefined;
let popup: ReminderPopup | undefined;
let notificationStatus =
  "Desktop notifications are available. Keep the app running; OS notification settings apply.";
const activeNotifications = new Set<Notification>();
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
function foreground() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show();
  mainWindow?.focus();
}
app.on("second-instance", () => {
  if (app.isReady()) foreground();
});
if (process.platform === "win32")
  app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);

function createWindow(): void {
  const window = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 760,
    minHeight: 560,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    fullscreen: false,
    title: APP_NAME,
    icon: app.isPackaged
      ? join(process.resourcesPath, "icon.png")
      : join(__dirname, "../../build/icon.png"),
    backgroundColor: "#f7f8fa",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
    if (process.platform !== "darwin") app.quit();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  window.center();
  window.once("ready-to-show", () => window.show());

  // Vite serves the renderer during development; builds use the local HTML file.
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  if (!lock) return;
  let store: ReminderStore | undefined;
  let storeError = "";
  try {
    store = new ReminderStore(
      join(app.getPath("userData"), "personal-reminders.json"),
    );
  } catch (error) {
    storeError = `Saved reminder file could not be read. It has not been overwritten. ${String(error)}`;
  }
  const report = (message: string) => {
    notificationStatus = message;
    console.error(message);
  };
  if (!Notification.isSupported())
    notificationStatus =
      "Native notifications are unavailable on this system. Reminder popups remain active.";
  const rendererURL = !app.isPackaged && process.env.ELECTRON_RENDERER_URL;
  const expectedURL = rendererURL
    ? new URL(rendererURL).origin
    : pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  const source = rendererURL ? new URL(rendererURL).origin : "file:renderer";
  let initialized = false;
  function trusted(event: Electron.IpcMainInvokeEvent, retryOpen = false) {
    const frame = event.senderFrame;
    if (
      !mainWindow ||
      event.sender !== mainWindow.webContents ||
      frame !== event.sender.mainFrame ||
      !frame ||
      (rendererURL
        ? new URL(frame.url).origin !== expectedURL
        : frame.url !== expectedURL)
    )
      throw Error("Untrusted reminder request");
    if (!store && retryOpen) {
      try {
        store = new ReminderStore(
          join(app.getPath("userData"), "personal-reminders.json"),
        );
        storeError = "";
      } catch (error) {
        storeError = `Saved reminder file could not be read. It has not been overwritten. ${String(error)}`;
        console.error(storeError);
      }
    }
    if (!store) throw Error(storeError);
    return store;
  }
  const state = () => ({
    reminders: store!.snapshot().reminders,
    notificationStatus,
  });
  ipcMain.handle(
    "reminders:initialize",
    (event, legacy: unknown, unavailable: unknown) => {
      const current = trusted(event, true);
      current.importLegacy(source, legacy, unavailable === true);
      initialized = true;
      startScheduler();
      return state();
    },
  );
  ipcMain.handle("reminders:save", (event, reminder: unknown) => {
    const current = trusted(event);
    if (!initialized) throw Error("Load reminders first");
    current.upsert(reminder);
    return state();
  });
  ipcMain.handle("reminders:remove", (event, id: unknown) => {
    const current = trusted(event);
    if (!initialized) throw Error("Load reminders first");
    current.remove(id);
    return state();
  });
  ipcMain.handle("reminders:status", (event) => {
    trusted(event);
    return notificationStatus;
  });
  function startScheduler() {
    if (!store || scheduler) return;
    popup = new ReminderPopup(store, rendererURL || undefined, report);
    scheduler = new ReminderScheduler(
      store,
      (reminder) => {
        popup?.present();
        if (!Notification.isSupported()) return;
        const notification = new Notification({
          title: reminder.title,
          body: reminder.note || "Your reminder is due.",
          timeoutType: "default",
        });
        activeNotifications.add(notification);
        notification.on("click", foreground);
        notification.on("close", () =>
          activeNotifications.delete(notification),
        );
        notification.on("failed", (_event, error) => {
          activeNotifications.delete(notification);
          report(
            `Desktop notification failed: ${error}. Check OS notification permissions and Do not disturb settings. This occurrence will not be retried.`,
          );
        });
        notification.show();
      },
      () => true,
      report,
      undefined,
      () => popup?.present(),
    );
    scheduler.start();
    powerMonitor.on("resume", () => scheduler?.tick());
  }
  startScheduler();
  createWindow();
  if (process.platform === "win32") Notification.handleActivation(foreground);

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  });
});

app.on("before-quit", () => {
  scheduler?.stop();
  popup?.shutdown();
  for (const notification of activeNotifications) notification.close();
  activeNotifications.clear();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
