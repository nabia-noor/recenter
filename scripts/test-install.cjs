// Windows-only, disposable NSIS installation of the exact production app payload.
// A unique installer appId prevents touching any existing user's installation.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { randomUUID, createHash } = require("node:crypto");
const assert = require("node:assert/strict");
const { build, Platform, Arch } = require("electron-builder");
const checkLaunch = require("../tests/packaged-launch.cjs");
const { NtExecutable, NtExecutableResource, Resource } = require("resedit");
const root = path.resolve(__dirname, "..");
const config = require("../package.json").build;

(async () => {
  if (process.platform !== "win32") throw Error("Windows is required");
  const payload = path.join(root, "release/recenter/win-unpacked");
  assert.ok(
    fs.existsSync(path.join(payload, "Recenter.exe")),
    "Run npm.cmd run dist:win first",
  );
  const metadata = NtExecutableResource.from(
    NtExecutable.from(fs.readFileSync(path.join(payload, "Recenter.exe"))),
  );
  for (const version of Resource.VersionInfo.fromEntries(metadata.entries)) {
    for (const language of version.getAllLanguagesForStringValues()) {
      const strings = version.getStringValues(language);
      assert.equal(strings.ProductName, "Recenter");
      assert.equal(strings.FileDescription, "Recenter");
      if (!require("../package.json").author)
        assert.equal(
          strings.CompanyName ?? "",
          "",
          "Inherited publisher metadata",
        );
    }
  }
  // An existing disposable installer can be retried without recompiling NSIS.
  const reuse = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (reuse) {
    assert.equal(path.dirname(reuse), path.join(root, "release/recenter"));
    assert.ok(path.basename(reuse).startsWith("install-check-"));
    assert.ok(fs.existsSync(path.join(reuse, "InstallCheck.exe")));
  }
  const directory = reuse ?? fs.mkdtempSync(path.join(root, "release/recenter/install-check-"));
  const installation = path.join(directory, "installed");
  const profile = fs.mkdtempSync(path.join(directory, "profile-"));
  const testId = `local.recenter.installcheck.${randomUUID()}`;
  const run = (file, args) => {
    const result = spawnSync(file, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      timeout: 120000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${path.basename(file)} failed`);
  };
  try {
    if (!reuse) await build({
      targets: Platform.WINDOWS.createTarget("nsis", Arch.x64),
      prepackaged: payload,
      publish: "never",
      config: {
        ...config,
        appId: testId,
        directories: { output: directory },
        nsis: {
          ...config.nsis,
          artifactName: "InstallCheck.exe",
          createDesktopShortcut: false,
          createStartMenuShortcut: false,
          runAfterFinish: false,
          uninstallDisplayName: "Recenter isolated installation check",
        },
      },
    });
    run(path.join(directory, "InstallCheck.exe"), [
      "/S",
      "/currentuser",
      `/D=${installation}`,
    ]);
    const executable = path.join(installation, "Recenter.exe");
    const hash = (file) =>
      createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    assert.equal(
      hash(path.join(installation, "resources/app.asar")),
      hash(path.join(payload, "resources/app.asar")),
      "Installed payload differs",
    );
    assert.equal(
      hash(executable),
      hash(path.join(payload, "Recenter.exe")),
      "Installed executable differs",
    );
    await checkLaunch(executable, profile, "create");
    await checkLaunch(executable, profile, "restart");
    const saved = JSON.parse(
      fs.readFileSync(path.join(profile, "personal-reminders.json"), "utf8"),
    );
    assert.equal(saved.reminders[0].title, "Installed Recenter check");
    console.log(
      `Installation and installed launch passed. Test artifacts: ${directory}`,
    );
  } finally {
    const uninstaller = path.join(installation, "Uninstall Recenter.exe");
    if (fs.existsSync(uninstaller)) {
      run(uninstaller, ["/S", "/currentuser", `_?=${installation}`]);
      console.log(
        "Disposable installation uninstalled; existing installation was not changed.",
      );
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
