type Bounds = { x: number; y: number; width: number; height: number };
type Display = { id: number; bounds: Bounds };
type DisplayEvent =
  "display-added" | "display-removed" | "display-metrics-changed";
type Displays = {
  getAllDisplays(): readonly Display[];
  on(event: DisplayEvent, listener: () => void): unknown;
  removeListener(event: DisplayEvent, listener: () => void): unknown;
};
type OverlayWindow = {
  isDestroyed(): boolean;
  setBounds(bounds: Bounds): void;
  showInactive(): void;
  destroy(): void;
  on(event: "closed", listener: () => void): unknown;
};

// Window creation is supplied by Electron; display/cleanup behavior is testable
// without changing OS monitor settings or creating real windows in unit tests.
export class BlackOverlay {
  private windows = new Map<number, OverlayWindow>();
  private key: string | null = null;
  private displays: Displays;
  private create: (bounds: Bounds) => OverlayWindow;
  private raisePopup: () => void;
  private report: (error: unknown) => void;
  private events: DisplayEvent[] = [
    "display-added",
    "display-removed",
    "display-metrics-changed",
  ];
  constructor(
    displays: Displays,
    create: (bounds: Bounds) => OverlayWindow,
    raisePopup: () => void,
    report = (_error: unknown) => {},
  ) {
    this.displays = displays;
    this.create = create;
    this.raisePopup = raisePopup;
    this.report = report;
  }
  private refresh = () => {
    if (!this.key) return;
    try {
      const displays = this.displays.getAllDisplays();
      const ids = new Set(displays.map((display) => display.id));
      for (const [id, window] of this.windows) {
        if (!ids.has(id)) {
          this.windows.delete(id);
          if (!window.isDestroyed()) window.destroy();
        }
      }
      for (const display of displays) {
        let window = this.windows.get(display.id);
        if (!window || window.isDestroyed()) {
          window = this.create(display.bounds);
          this.windows.set(display.id, window);
          const created = window;
          window.on("closed", () => {
            if (this.windows.get(display.id) === created)
              this.windows.delete(display.id);
          });
        }
        window.setBounds(display.bounds);
        window.showInactive();
      }
      this.raisePopup();
    } catch (error) {
      // Never leave a partial black cover after an overlay creation failure.
      this.clear();
      this.report(error);
    }
  };
  show(key: string) {
    if (
      this.key === key &&
      this.windows.size === this.displays.getAllDisplays().length &&
      [...this.windows.values()].every((window) => !window.isDestroyed())
    )
      return;
    if (this.key !== key) {
      this.clear();
      this.key = key;
      for (const event of this.events) this.displays.on(event, this.refresh);
    }
    this.refresh();
  }
  clear() {
    this.key = null;
    for (const event of this.events)
      this.displays.removeListener(event, this.refresh);
    const windows = [...this.windows.values()];
    this.windows.clear();
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
  }
}
