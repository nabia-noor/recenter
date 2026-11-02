// Render the source SVG with the already-installed Electron/Chromium. No extra
// image dependency or network service is needed. ICO embeds each PNG size.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require("node:child_process").spawnSync(
    require("electron"),
    [__filename],
    {
      env,
      stdio: "inherit",
      timeout: 45000,
    },
  );
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} else {
  const { app, BrowserWindow } = require("electron");
  const profile = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "recenter-icons-"),
  );
  app.setPath("userData", profile);
  app.whenReady().then(async () => {
    try {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      await window.loadURL("data:text/html,<html></html>");
      const svg = fs.readFileSync(path.join(root, "build/icon.svg"), "utf8");
      const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
      const data = await window.webContents.executeJavaScript(`(async () => {
        const image = new Image();
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)});
        await image.decode();
        return ${JSON.stringify(sizes)}.map(size => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = size;
          canvas.getContext('2d').drawImage(image, 0, 0, size, size);
          return canvas.toDataURL('image/png').split(',')[1];
        });
      })()`);
      const images = data.map((value) => Buffer.from(value, "base64"));
      fs.writeFileSync(path.join(root, "build/icon.png"), images.pop());
      const header = Buffer.alloc(6 + images.length * 16);
      header.writeUInt16LE(1, 2);
      header.writeUInt16LE(images.length, 4);
      let offset = header.length;
      images.forEach((image, index) => {
        const entry = 6 + index * 16;
        header[entry] = header[entry + 1] =
          sizes[index] === 256 ? 0 : sizes[index];
        header.writeUInt16LE(1, entry + 4);
        header.writeUInt16LE(32, entry + 6);
        header.writeUInt32LE(image.length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += image.length;
      });
      fs.writeFileSync(
        path.join(root, "build/icon.ico"),
        Buffer.concat([header, ...images]),
      );
      console.log("Generated Recenter PNG and multi-resolution Windows ICO.");
      app.quit();
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
  });
  app.on("quit", () => {
    // Unique mkdtemp path owned solely by this build process.
    try {
      fs.rmSync(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    } catch {}
  });
}
