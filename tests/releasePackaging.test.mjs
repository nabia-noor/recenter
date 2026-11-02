import test from "node:test";
import assert from "node:assert/strict";
import verifier from "../scripts/verify-installer.cjs";

const runtime = [
  "package.json",
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
