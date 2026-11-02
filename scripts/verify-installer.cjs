// Inspect the actual NSIS installer without running it or changing user data.
// Reuse electron-builder's installed 7-Zip toolset and ASAR reader.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

function validateRuntimeFiles(entries) {
  const files = entries.map((name) =>
    name.replace(/\\/g, "/").replace(/^\/+/, ""),
  );
  for (const required of [
    "package.json",
    "LICENSE",
    "out/main/index.js",
    "out/preload/index.js",
    "out/renderer/index.html",
    "out/renderer/popup.html",
  ]) {
    assert.ok(files.includes(required), `Missing runtime entry: ${required}`);
  }
  for (const file of files) {
    assert.ok(
      !/(^|\/)popup-preview\.png$/i.test(file),
      `Preview screenshot packaged: ${file}`,
    );
    assert.ok(
      file === "package.json" ||
        file === "LICENSE" ||
        /^out\/(main|preload|renderer)\//.test(file),
      `Unexpected packaged file: ${file}`,
    );
    assert.ok(
      !/(^|\/)(?:\.env(?:\..*)?|personal-reminders\.json[^/]*|[^/]*\.(?:db(?:-[^/]*)?|sqlite3?(?:-[^/]*)?|pfx|p12|pem|key|log|bak|backup))$/i.test(
        file,
      ),
      `Local data or credentials packaged: ${file}`,
    );
  }
  return files;
}

function validateReleaseLicense(
  licenseText,
  packagedMetadata,
  projectMetadata,
  expectedLicense,
) {
  assert.equal(
    licenseText,
    expectedLicense,
    "Packaged LICENSE differs from the project's LICENSE",
  );
  assert.ok(
    licenseText.split(/\r?\n/).includes("Copyright (c) 2026 Nabia Noor"),
    "Confirmed copyright notice is missing",
  );
  assert.ok(
    licenseText.startsWith("MIT License\n") ||
      licenseText.startsWith("MIT License\r\n"),
    "Expected the MIT License",
  );
  assert.equal(projectMetadata.license, "MIT", "Project license must be MIT");
  assert.equal(packagedMetadata.license, "MIT", "Packaged license must be MIT");
  assert.equal(
    packagedMetadata.name,
    projectMetadata.name,
    "Packaged project name differs",
  );
  assert.equal(
    packagedMetadata.version,
    projectMetadata.version,
    "Packaged version differs",
  );
}

function archiveFiles(node, prefix = "") {
  const files = [];
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const file = prefix + name;
    assert.ok(!entry.link, `Unexpected archive link: ${file}`);
    if (entry.files) files.push(...archiveFiles(entry, file + "/"));
    else files.push(file);
  }
  return files;
}

async function verifyInstaller(input) {
  const root = path.resolve(__dirname, "..");
  const metadata = require("../package.json");
  const output = path.join(root, "release/recenter");
  const installer = path.resolve(
    input ?? path.join(output, `Recenter-Setup-${metadata.version}-x64.exe`),
  );
  assert.ok(fs.existsSync(installer), "Build the installer first");
  const work = fs.mkdtempSync(path.join(output, "verify-installer-"));
  const { getPath7za } = require("app-builder-lib/out/toolsets/7zip");
  const asar = require("@electron/asar");
  const digest = (file) =>
    createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const find = (directory, predicate) =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory()
        ? find(full, predicate)
        : predicate(entry.name)
          ? [full]
          : [];
    });
  try {
    const sevenZip = await getPath7za();
    const extract = (args) => {
      const result = spawnSync(sevenZip, args, {
        encoding: "utf8",
        windowsHide: true,
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      assert.equal(
        result.status,
        0,
        `Installer extraction failed: ${result.stderr || result.stdout}`,
      );
    };
    // The builder's 7za opens the embedded app-64.7z directly in the NSIS EXE.
    // Select only app.asar, avoiding extraction/execution of the application.
    const inner = path.join(work, "payload");
    extract(["x", installer, `-o${inner}`, "-y", "-ir!app.asar"]);
    const archives = find(inner, (name) => name === "app.asar");
    assert.equal(archives.length, 1, "Installer's app.asar was not found");
    const files = validateRuntimeFiles(
      archiveFiles(asar.getRawHeader(archives[0]).header),
    );
    const licenseText = asar
      .extractFile(archives[0], "LICENSE")
      .toString("utf8");
    const packagedMetadata = JSON.parse(
      asar.extractFile(archives[0], "package.json").toString("utf8"),
    );
    validateReleaseLicense(
      licenseText,
      packagedMetadata,
      metadata,
      fs.readFileSync(path.join(root, "LICENSE"), "utf8"),
    );
    const unpacked = path.join(output, "win-unpacked/resources/app.asar");
    assert.equal(
      digest(archives[0]),
      digest(unpacked),
      "Installer differs from the built app archive",
    );
    const result = {
      installer: path.basename(installer),
      runtimeFiles: files.length,
      previewAbsent: true,
      matchesUnpacked: true,
      license: packagedMetadata.license,
      version: packagedMetadata.version,
      copyright: "Copyright (c) 2026 Nabia Noor",
      licenseMatchesProject: true,
      sha256: digest(installer),
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    // Verify the absolute deletion target is the unique directory created above.
    const relative = path.relative(
      fs.realpathSync(output),
      fs.realpathSync(work),
    );
    assert.ok(
      relative &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative) &&
        path.dirname(relative) === "." &&
        path.basename(relative).startsWith("verify-installer-"),
      "Refusing to clean an unexpected verification directory",
    );
    fs.rmSync(work, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

module.exports = {
  validateRuntimeFiles,
  validateReleaseLicense,
  verifyInstaller,
};
if (require.main === module)
  verifyInstaller(process.argv[2]).catch((error) => {
    console.error(error);
    process.exit(1);
  });
