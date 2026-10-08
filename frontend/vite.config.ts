import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The product version lives in the root package.json; the commit pins the exact build.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function gitCommit(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    const dirty = execSync("git status --porcelain").toString().trim() !== "";
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: the same build is served under any secret customer path.
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(gitCommit()),
  },
  resolve: {
    alias: {
      // Shared parsing + reconciliation engine.
      "@core": fileURLToPath(new URL("../core/src", import.meta.url)),
      // The customer this build is for; only its config is bundled.
      "@customer-config": fileURLToPath(new URL("../customers/teena-rimon/config.json", import.meta.url)),
    },
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
