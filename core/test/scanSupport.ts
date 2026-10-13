import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createTesseract } from "../src/ocr/tesseract.js";
import type { OcrEngine, ScanSupport } from "../src/ocr/types.js";

const modules = new URL("../node_modules/", import.meta.url);
const read = (path: string) => new Uint8Array(readFileSync(new URL(path, modules)));
const model = (lang: string) => new Uint8Array(gunzipSync(read(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`)));

let engine: Promise<OcrEngine> | null = null;

/** The same decoder and OCR files the browser build bundles, read from node_modules. */
export const NODE_SCAN_SUPPORT: ScanSupport = {
  async jbig2Wasm() {
    return read("pdfjs-dist/wasm/jbig2.wasm");
  },
  ocr() {
    engine ??= createTesseract({
      wasm: read("tesseract-wasm/dist/tesseract-core.wasm"),
      models: { eng: model("eng"), heb: model("heb") },
    });
    return engine;
  },
};
