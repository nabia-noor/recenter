import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import verifier from "../scripts/verify-installer.cjs";

const runtime = [
  "package.json",
  "LICENSE",
  "out/main/index.js",
  "out/preload/index.js",
  "out/renderer/index.html",
  "out/renderer/popup.html",
  "out/renderer/assets/main.js",
  "out/renderer/assets/main.css",
  "out/renderer/assets/icon.png",
];

test("release payload keeps both windows, the preload, and renderer assets", () => {
  assert.deepEqual(verifier.validateRuntimeFiles(runtime), runtime);
  assert.deepEqual(
    verifier.validateRuntimeFiles(
      runtime.map((name) => name.replaceAll("/", "\\")),
    ),
    runtime,
  );
});
test("release payload rejects the stale preview even inside a renderer folder", () => {
  for (const preview of [
    "out/popup-preview.png",
    "out/renderer/popup-preview.png",
  ])
    assert.throws(
      () => verifier.validateRuntimeFiles([...runtime, preview]),
      /Preview screenshot/,
    );
});
test("release payload rejects local profiles, reminder backups, credentials, and databases", () => {
  for (const file of [
    "release/profile/personal-reminders.json",
    "out/renderer/.env.local",
    "out/main/personal-reminders.json.legacy-backup",
    "out/main/local.sqlite",
    "out/main/signing.pfx",
    "out/main/debug.log",
    "out/renderer/state.json.bak",
    "out/renderer/cache.sqlite-wal",
    "out/notes.txt",
  ])
    assert.throws(
      () => verifier.validateRuntimeFiles([...runtime, file]),
      /Unexpected packaged|Local data or credentials/,
    );
});
test("release payload cannot silently omit a required app entry", () => {
  assert.throws(
    () =>
      verifier.validateRuntimeFiles(
        runtime.filter((file) => file !== "out/renderer/popup.html"),
      ),
    /Missing runtime entry/,
  );
});

const mitLicense = readFileSync(new URL("../LICENSE", import.meta.url), "utf8");
const project = { name: "recenter", version: "0.1.0", license: "MIT" };
test("release payload requires the project LICENSE file", () => {
  assert.throws(
    () =>
      verifier.validateRuntimeFiles(
        runtime.filter((file) => file !== "LICENSE"),
      ),
    /Missing runtime entry: LICENSE/,
  );
});
test("release includes the exact project MIT text, confirmed owner, and package metadata", () => {
  assert.doesNotThrow(() =>
    verifier.validateReleaseLicense(mitLicense, project, project, mitLicense),
  );
});
test("release rejects missing MIT metadata, a different version, and altered license text", () => {
  for (const metadata of [
    { ...project, license: undefined },
    { ...project, version: "0.2.0" },
    { ...project, name: "other-app" },
  ]) {
    assert.throws(() =>
      verifier.validateReleaseLicense(
        mitLicense,
        metadata,
        project,
        mitLicense,
      ),
    );
  }
  assert.throws(
    () =>
      verifier.validateReleaseLicense(
        mitLicense.replace("Nabia Noor", "Other Owner"),
        project,
        project,
        mitLicense,
      ),
    /LICENSE differs/,
  );
  assert.throws(
    () => verifier.validateReleaseLicense("", project, project, mitLicense),
    /LICENSE differs/,
  );
});
