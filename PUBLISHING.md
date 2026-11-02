# Recenter release preparation

The product name, executable, installer, shortcuts, window, and branding are
Recenter. The existing version is **0.1.0**; choose the intended public release
version before distribution. No publisher, certificate, or license is invented.
The author is intentionally unset. A pre-signing Windows packaging hook clears
Electron's inherited vendor metadata rather than attributing Recenter to that
vendor. Configure the publisher details before the public release.

## Build Windows x64

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run test:desktop
npm.cmd run dist:win
npm.cmd run test:install
```

The installer is `release/recenter/Recenter-Setup-0.1.0-x64.exe`.
The unpacked application is `release/recenter/win-unpacked/Recenter.exe`.
`dist:win` automatically runs `verify:installer`. That check extracts the actual
installer and its app archive without launching it, confirms required runtime
entries, rejects `popup-preview.png`, local reminder data and credentials, and
checks the archive against the unpacked build. Run `npm.cmd run verify:installer`
again to verify an existing installer. Only its unique temporary extraction
directory is removed; existing app data and preview/source assets are untouched.

Packaging includes only `out/main`, `out/preload`, `out/renderer` and application
metadata and the root `LICENSE`, with an explicit preview exclusion. `build/`
remains versionable for the required icon assets. Interactive test screenshots are written into their
disposable profiles rather than build output.

The project `LICENSE` is explicitly bundled at the root of `resources/app.asar`.
Electron-builder retains the root package's `"license": "MIT"` metadata.
Verification requires the complete bundled license to match the source file,
including `Copyright (c) 2026 Nabia Noor`, and checks the packaged name/version.
Windows executable copyright metadata uses the same confirmed notice; publisher
and support contact details remain unset.
No installer EULA or application UI is added by bundling the license.

When replacing an existing installer, retain it and build a candidate first:

```powershell
npm.cmd run icons
npm.cmd run build
npx --no-install electron-builder --win nsis --x64 --publish never '--config.nsis.artifactName=Recenter-Setup-0.1.0-x64-candidate.exe'
npm.cmd run verify:installer -- release/recenter/Recenter-Setup-0.1.0-x64-candidate.exe
```

Run the unit, desktop (including opt-in interactions), and isolated installation
checks before promoting the candidate to the standard installer filename.
Keep a backup of the preceding verified installer. Packaging or verification
source changes need a reviewed Git commit before tagging/publishing a release;
building a candidate does not commit or push them automatically.

Run commands from the project directory using Node.js 24 LTS. The default
desktop tests are non-interactive. To additionally exercise notification wiring
and visible popup/overlay interactions on an undisturbed Windows desktop:

```powershell
$env:REMINDERS_INTERACTIVE_TESTS = '1'
try {
  npm.cmd run test:desktop
} finally {
  Remove-Item Env:REMINDERS_INTERACTIVE_TESTS -ErrorAction SilentlyContinue
}
```

Native OS toasts are stubbed even in that opt-in suite. Check actual Windows
notification delivery and physical touchscreen interaction manually using the
README instructions.
On Windows the real cursor must remain over the hold button during synthetic
hold checks; pointer capture loss resets progress by design. Keep the desktop
undisturbed and use the pointer/focus diagnostics if a visible test fails.

`test:install` builds a disposable test installer with a unique internal ID and
no shortcuts, installs it to an isolated directory, verifies the installed ASAR
matches the production payload, then tests launch, branding, creating a reminder
and persistence after restart. It uninstalls only that disposable copy. A local
Node inspector session isolates the test profile before main.js executes; no
testing IPC or Node access is added to the application renderer. Test artifacts
remain under `release/recenter/install-check-*` for inspection. The actual public
installer retains the original upgrade ID; testing that upgrade path still
requires a separate account/VM or an intentional upgrade of the user's install.
Hidden launch checks use software rendering and allow up to 60 seconds for
renderer startup. The production app's graphics settings are unchanged. An
existing disposable installer can be retried with a fresh test profile using
`npm.cmd run test:install -- release/recenter/install-check-<suffix>`; its installed
payload must still match the current production build.
The publishing script explicitly uses `--publish never`. Existing older build
artifacts are left alone; distribute only the new Recenter artifact.

`build/icon.svg` is the editable focus mark. `npm.cmd run icons` uses the existing
Electron renderer to generate `build/icon.png` and a multi-resolution
`build/icon.ico` (16–256 px). These assets are used by the executable, installer,
uninstaller and main window. No icon library or image dependency was added.
`scripts/windows-metadata.cjs` runs before signing and uses electron-builder's
existing resource library to clear the inherited company name when no author is
configured. A real author supplied later is retained. The installation test
checks product metadata and confirms both the installed executable and ASAR are
byte-for-byte identical to the production payload.

The installer supports per-user installation and choosing an install directory.
Its existing internal ID `com.reminders.desktop` is intentionally unchanged:
changing it could create a separate installation and lose upgrade continuity.
It is not a displayed application name. Likewise the existing storage namespace,
IPC channels and localStorage key retain their old identifiers for compatibility.

## Data safety and upgrade testing

The app explicitly retains `%APPDATA%\reminders` for both `userData` and the
default Chromium `sessionData`, before taking its single-instance lock. Existing
JSON, pending/handled occurrences, settings, and legacy localStorage remain in
place; they are not copied, reset, or rewritten by renaming. Custom test profiles
and custom session paths are respected. Uninstall is configured to retain data.

Before a real user upgrade, back up the existing profile while the old app is
closed. Install Recenter, verify saved reminders and the exact tagline, then test
create/edit/delete, close/reopen, and a reminder due a minute later. Verify the
popup, overlay and five-second hold behavior. Repeat for an existing older
installation on a separate Windows test account or VM. The build/test scripts use
disposable profiles; they must not delete the user's real profile.

## Before public distribution

- The project uses the MIT License. The confirmed copyright notice is:
  `Copyright (c) 2026 Nabia Noor`.
- Publisher/author and support contact details remain pending until configured.
  Add any required privacy/support documentation before public distribution.
- Keep environment files, signing keys/certificates, local databases, reminder
  backups and profile directories out of source control. Only sanitized
  environment examples belong in the repository. `release/` includes local test
  profiles and build logs; never upload that entire directory. Attach only the
  intended release installer (and any deliberately selected release assets).
- Confirm the release version and distribution channel. No update server or
  upload target is configured by this work.
- Obtain a Windows code-signing identity and configure electron-builder's signing
  credentials securely in the release environment. Do not commit secrets.
  Unsigned builds are suitable for local testing and can show Windows security
  warnings; they must not be presented as signed or verified-publisher builds.
- Rebuild with signing, verify signatures, and test installation, launch, upgrade,
  shortcuts, notifications, multiple monitors, and uninstall on a clean Windows
  account/VM. Do not add publisher information without the owner's real details.
- This target is Windows x64. Additional architectures or macOS/Linux require
  separate packaging, platform icon assets, and platform-specific validation.

See the [Electron storage documentation](https://www.electronjs.org/docs/latest/api/app#appgetpathname)
and the installed electron-builder NSIS options for profile and installer behavior.
