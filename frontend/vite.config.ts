import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Shared parsing + reconciliation engine (also used by the backend).
    alias: { "@core": fileURLToPath(new URL("../core/src", import.meta.url)) },
  },
  server: {
    host: "0.0.0.0",
    port: 43123,
    // Fail instead of drifting to 43124, which is the API's port.
    strictPort: true,
    fs: { allow: [".."] },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:43124",
        changeOrigin: true,
      },
    },
  },
  build: {
    // pdf.js (~1.6 MB) is only loaded on demand when parsing in the browser.
    chunkSizeWarningLimit: 1800,
  },
  preview: {
    host: "0.0.0.0",
    port: 43123,
  },
});
