import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: the same build is served under any secret customer path.
  base: "./",
  resolve: {
    // Shared parsing + reconciliation engine.
    alias: { "@core": fileURLToPath(new URL("../core/src", import.meta.url)) },
  },
  server: {
    host: "0.0.0.0",
    port: 43123,
    strictPort: true,
    fs: { allow: [".."] },
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
