import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { parseCustomerConfig } from "../core/src/customer.ts";

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

/**
 * The customer this build is for: `CUSTOMER=<slug> npm run build`. Builds
 * must name it; the dev server defaults to Teena-Rimon. The config is
 * validated here, so a broken config.json fails the build, not the browser.
 */
function customerConfigPath(command: "build" | "serve"): string {
  const slug = process.env.CUSTOMER ?? (command === "serve" ? "teena-rimon" : undefined);
  if (!slug) throw new Error("Set CUSTOMER=<slug> (a folder under customers/) to build.");
  const path = fileURLToPath(new URL(`../customers/${slug}/config.json`, import.meta.url));
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`Cannot read customers/${slug}/config.json: ${(err as Error).message}`);
  }
  const config = parseCustomerConfig(raw, `customers/${slug}/config.json`);
  if (config.slug !== slug) throw new Error(`customers/${slug}/config.json has slug "${config.slug}"`);
  return path;
}

export default defineConfig(({ command }) => ({
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
      "@customer-config": customerConfigPath(command),
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
}));
