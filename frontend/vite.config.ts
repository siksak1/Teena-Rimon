import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { parseCustomerConfig } from "../core/src/customer.ts";

// The product version lives in the root package.json; the commit pins the exact build.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

function gitCommit(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD").toString().trim();
    // Only the build's inputs count; untracked editor/tool files elsewhere don't.
    const dirty = execSync("git status --porcelain -- core frontend customers package.json").toString().trim() !== "";
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

const coreModules = (path: string) => fileURLToPath(new URL(`../core/node_modules/${path}`, import.meta.url));

/**
 * Binary files needed only for scanned invoices — pdf.js's CCITT/JBIG2
 * decoder, Tesseract and its models — as `virtual:binary/<name>` modules that
 * export the file as base64. The CSP lets the page fetch nothing but
 * analytics, so these can't be downloaded with fetch(); they load like any
 * other script chunk of the app, and only when a scan is uploaded.
 */
function bundledBinaries(): Plugin {
  // Names without extensions: Vite's own plugins claim ids ending in ".wasm".
  const files: Record<string, string> = {
    "jbig2": coreModules("pdfjs-dist/wasm/jbig2.wasm"),
    "tesseract-core": coreModules("tesseract-wasm/dist/tesseract-core.wasm"),
    "eng-model": coreModules("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
    "heb-model": coreModules("@tesseract.js-data/heb/4.0.0_best_int/heb.traineddata.gz"),
  };
  const prefix = "virtual:binary/";
  return {
    name: "bundled-binaries",
    enforce: "pre",
    resolveId: (id) => (id.startsWith(prefix) ? `\0${id}` : undefined),
    load(id) {
      if (!id.startsWith(`\0${prefix}`)) return;
      const file = files[id.slice(prefix.length + 1)];
      if (!file) throw new Error(`Unknown bundled binary ${id}`);
      return `export default ${JSON.stringify(readFileSync(file).toString("base64"))};`;
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [react(), bundledBinaries()],
  worker: {
    // The OCR worker loads Tesseract and its models as separate chunks.
    format: "es",
    plugins: () => [bundledBinaries()],
  },
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
      // Installed with the core; the frontend sets up their workers itself.
      "pdfjs-dist": coreModules("pdfjs-dist"),
      "tesseract-wasm": coreModules("tesseract-wasm"),
    },
  },
  optimizeDeps: {
    // Served as they are: pre-bundling would turn pdf.js's `?worker&url`
    // import into a module and could load pdf.js twice (the core's copy and
    // the one whose worker the frontend sets up).
    exclude: ["pdfjs-dist", "tesseract-wasm"],
  },
  server: {
    host: "0.0.0.0",
    port: 43123,
    strictPort: true,
    fs: { allow: [".."] },
  },
  build: {
    // pdf.js (~1.6 MB) is only loaded on demand when parsing in the browser,
    // and the OCR models (up to ~4 MB as base64) only for scanned invoices.
    chunkSizeWarningLimit: 4200,
  },
  preview: {
    host: "0.0.0.0",
    port: 43123,
  },
}));
