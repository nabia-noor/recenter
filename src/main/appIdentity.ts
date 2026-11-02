import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export const APP_NAME = "Recenter";
// Retain the released install/notification identity so this is an upgrade.
export const APP_ID = "com.reminders.desktop";

type IdentityApp = Pick<
  Electron.App,
  "getName" | "getPath" | "setName" | "setPath"
>;

export function configureAppIdentity(app: IdentityApp) {
  const original = app.getPath("userData");
  const session = app.getPath("sessionData");
  const expected = join(app.getPath("appData"), app.getName());
  const normalize = (path: string) =>
    process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  // Respect explicitly isolated test profiles. Keep both JSON and Chromium's
  // original localStorage in place; the rename must never copy or reset data.
  if (normalize(original) === normalize(expected)) {
    const legacy = join(app.getPath("appData"), "reminders");
    mkdirSync(legacy, { recursive: true });
    app.setPath("userData", legacy);
    if (normalize(session) === normalize(original))
      app.setPath("sessionData", legacy);
  }
  app.setName(APP_NAME);
}
