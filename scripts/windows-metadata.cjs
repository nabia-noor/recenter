// electron-builder leaves Electron's original vendor in the EXE when author is
// absent. Clear that inherited attribution before resource editing and signing.
// resedit is already used and installed by electron-builder; no dependency added.
const fs = require("node:fs/promises");
const path = require("node:path");
const { NtExecutable, NtExecutableResource, Resource } = require("resedit");

module.exports = async (context) => {
  if (context.electronPlatformName !== "win32") return;
  const file = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  const executable = NtExecutable.from(await fs.readFile(file));
  const resource = NtExecutableResource.from(executable);
  for (const version of Resource.VersionInfo.fromEntries(resource.entries)) {
    for (const language of version.getAllLanguagesForStringValues()) {
      version.setStringValue(
        language,
        "CompanyName",
        context.packager.appInfo.companyName ?? "",
      );
    }
    version.outputToResourceEntries(resource.entries);
  }
  resource.outputResource(executable);
  await fs.writeFile(file, Buffer.from(executable.generate()));
};
