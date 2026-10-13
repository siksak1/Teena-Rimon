import type { OcrEngine, OcrLine, ScanSupport } from "@core/ocr/types.js";
import { fromBase64 } from "./binary";
import type { OcrRequest, OcrResponse } from "./ocrWorker";

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (lines: OcrLine[]) => void; reject: (err: Error) => void }>();

/** One OCR worker for the page's lifetime: the models stay loaded between comparisons. */
function ocrWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./ocrWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<OcrResponse>) => {
    const call = pending.get(data.id);
    pending.delete(data.id);
    if ("error" in data) call?.reject(new Error(data.error));
    else call?.resolve(data.lines);
  };
  worker.onerror = (e) => {
    for (const call of pending.values()) call.reject(new Error(e.message || "OCR worker failed"));
    pending.clear();
    worker = null;
  };
  return worker;
}

const engine: OcrEngine = {
  readLines(image, options) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const request: OcrRequest = { id, image, options };
      // Each crop is a fresh buffer: hand it over instead of copying it.
      ocrWorker().postMessage(request, [image.data.buffer]);
    });
  },
};

/** Scanned-invoice support for the browser; everything loads on first use. */
export function browserScanSupport(onProgress?: (done: number, total: number) => void): ScanSupport {
  return {
    async jbig2Wasm() {
      return fromBase64((await import("virtual:binary/jbig2")).default);
    },
    async ocr() {
      return engine;
    },
    onProgress,
  };
}
