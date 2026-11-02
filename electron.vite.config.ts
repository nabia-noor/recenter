import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // Local storage is tied to the renderer origin; don't silently change ports.
    server: { port: 5174, strictPort: true },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          popup: resolve("src/renderer/popup.html"),
        },
      },
    },
  },
});
