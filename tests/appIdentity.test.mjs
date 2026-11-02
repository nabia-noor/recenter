import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_NAME,
  APP_ID,
  configureAppIdentity,
} from "../src/main/appIdentity.ts";

function fixture(name, custom = false, separateSession = false) {
  const root = mkdtempSync(join(tmpdir(), "recenter-identity-"));
  const paths = {
    appData: root,
    userData: join(root, custom ? "isolated-test" : name),
    sessionData: join(
      root,
      separateSession ? "separate-session" : custom ? "isolated-test" : name,
    ),
  };
  const app = {
    getName: () => name,
    setName: (value) => {
      name = value;
    },
    getPath: (key) => paths[key],
    setPath: (key, value) => {
      paths[key] = value;
    },
  };
  return {
    root,
    paths,
    app,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("rename keeps the legacy JSON and Chromium profile in place before startup", () => {
  for (const name of ["recenter", "Recenter"]) {
    const f = fixture(name);
    try {
      configureAppIdentity(f.app);
      assert.equal(f.app.getName(), APP_NAME);
      assert.equal(f.paths.userData, join(f.root, "reminders"));
      assert.equal(f.paths.sessionData, f.paths.userData);
      configureAppIdentity(f.app);
      assert.equal(f.paths.userData, join(f.root, "reminders"));
      assert.equal(APP_ID, "com.reminders.desktop");
    } finally {
      f.cleanup();
    }
  }
});

test("rename respects isolated profiles and explicitly separate session storage", () => {
  for (const [custom, separate] of [
    [true, false],
    [false, true],
  ]) {
    const f = fixture("Recenter", custom, separate);
    const before = { ...f.paths };
    try {
      configureAppIdentity(f.app);
      if (custom) assert.equal(f.paths.userData, before.userData);
      assert.equal(f.paths.sessionData, before.sessionData);
      assert.equal(f.app.getName(), APP_NAME);
    } finally {
      f.cleanup();
    }
  }
});
