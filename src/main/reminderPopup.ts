import {
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainInvokeEvent,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ReminderStore } from "./reminderStore.ts";
import { HoldGuard } from "./holdGuard.ts";
import { BlackOverlay } from "./blackOverlay.ts";

export class ReminderPopup {
  private window: BrowserWindow | null = null;
  private key: string | null = null;
  private hold = new HoldGuard();
  private quitting = false;
  private store: ReminderStore;
  private expectedURL: string;
  private report: (message: string) => void;
  private overlay: BlackOverlay;
  constructor(
    store: ReminderStore,
    rendererURL: string | undefined,
    report: (message: string) => void,
  ) {
    this.store = store;
    this.report = report;
    this.overlay = new BlackOverlay(
      screen,
      (bounds) => {
        const overlay = new BrowserWindow({
          ...bounds,
          frame: false,
          show: false,
          backgroundColor: "#000000",
          transparent: false,
          opacity: 1,
          focusable: false,
          skipTaskbar: true,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          hasShadow: false,
          roundedCorners: false,
          enableLargerThanScreen: true,
          title: "Reminder black overlay",
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
          },
        });
        overlay.setAlwaysOnTop(true, "floating");
        overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        overlay.webContents.on("will-navigate", (event) =>
          event.preventDefault(),
        );
        overlay.webContents.on("render-process-gone", () => {
          if (!overlay.isDestroyed()) overlay.destroy();
        });
        const html =
          '<!doctype html><html><head><title>Reminder black overlay</title><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"></head><body style="margin:0;background:#000;width:100vw;height:100vh;overflow:hidden"></body></html>';
        void overlay
          .loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html))
          .catch((error) => {
            if (!overlay.isDestroyed()) {
              this.report(`Black overlay failed to load: ${String(error)}`);
              this.overlay.clear();
            }
          });
        return overlay;
      },
      () => {
        if (
          this.window &&
          !this.window.isDestroyed() &&
          this.window.isVisible()
        )
          this.window.moveTop();
      },
      (error) => this.report(`Black overlay failed: ${String(error)}`),
    );
    this.expectedURL = rendererURL
      ? new URL("/popup.html", rendererURL).href
      : pathToFileURL(join(__dirname, "../renderer/popup.html")).href;
    const trusted = (event: IpcMainInvokeEvent) => {
      if (
        !this.window ||
        this.window.isDestroyed() ||
        event.sender !== this.window.webContents ||
        !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame.url !== this.expectedURL
      )
        throw Error("Untrusted popup request");
    };
    ipcMain.handle("reminder-popup:get", (event) => {
      trusted(event);
      return {
        item: this.store.pendingPopups()[0] ?? null,
        count: this.store.pendingPopups().length,
      };
    });
    ipcMain.handle("reminder-popup:begin", (event, key: unknown) => {
      trusted(event);
      if (!this.validKey(key) || !this.window?.isFocused())
        throw Error("Popup must be focused to begin holding");
      return this.hold.begin();
    });
    ipcMain.handle(
      "reminder-popup:pulse",
      (event, key: unknown, token: unknown) => {
        trusted(event);
        if (
          !this.validKey(key) ||
          typeof token !== "string" ||
          !this.window?.isFocused()
        ) {
          this.hold.cancel();
          return { token: null, elapsed: 0, dismissed: false };
        }
        const result = this.hold.pulse(token);
        if (result.dismissed) {
          // Only close after the acknowledgement has been durably written.
          const completedWindow = this.window;
          this.store.acknowledge(this.key!);
          setImmediate(() => {
            if (this.window === completedWindow) this.closeCurrent();
            this.present();
          });
        }
        return result;
      },
    );
    ipcMain.handle("reminder-popup:cancel", (event, token: unknown) => {
      trusted(event);
      if (typeof token === "string") this.hold.cancel(token);
    });
  }
  private validKey(key: unknown) {
    return (
      typeof key === "string" &&
      key === this.key &&
      key === this.store.pendingPopups()[0]?.key
    );
  }
  private closeCurrent() {
    this.overlay.clear();
    this.hold.cancel();
    this.key = null;
    const window = this.window;
    this.window = null;
    if (window && !window.isDestroyed()) window.destroy();
  }
  present() {
    if (this.quitting) return;
    const item = this.store.pendingPopups()[0];
    if (this.window && (this.window.isDestroyed() || this.key !== item?.key))
      this.closeCurrent();
    if (!item || this.window) {
      if (this.window && this.window.isVisible() && this.key)
        this.overlay.show(this.key);
      return;
    }
    this.key = item.key;
    const window = new BrowserWindow({
      width: 500,
      height: 490,
      resizable: false,
      minimizable: false,
      maximizable: false,
      frame: false,
      alwaysOnTop: true,
      show: false,
      title: "Recenter — Reminder",
      backgroundColor: "#f7f5fc",
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.window = window;
    window.center();
    window.setAlwaysOnTop(true, "screen-saver");
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("blur", () => {
      if (this.window === window) this.hold.cancel();
    });
    window.on("close", (event) => {
      if (!this.quitting) event.preventDefault();
    });
    window.on("closed", () => {
      if (this.window === window) {
        this.overlay.clear();
        this.window = null;
        this.key = null;
        this.hold.cancel();
      }
    });
    window.webContents.on("render-process-gone", () => {
      if (this.window === window) this.closeCurrent();
    });
    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) {
        this.overlay.show(item.key);
        window.show();
        window.focus();
      }
    });
    void window.loadURL(this.expectedURL).catch((error) => {
      this.report(`Reminder popup failed to load: ${String(error)}`);
      if (this.window === window) this.closeCurrent();
    });
  }
  shutdown() {
    this.quitting = true;
    this.closeCurrent();
    for (const channel of ["get", "begin", "pulse", "cancel"])
      ipcMain.removeHandler(`reminder-popup:${channel}`);
  }
}
