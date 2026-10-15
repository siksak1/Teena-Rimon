import type { GrayImage, OcrLine, OcrModel, OcrOptions } from "./types.js";

/** The Tesseract WASM binary and the trained models, as bytes (never fetched). */
export type TesseractFiles = {
  wasm: Uint8Array;
  models: Record<OcrModel, Uint8Array>;
};

type Engine = import("tesseract-wasm").OCREngine;

/**
 * Synchronous Tesseract (tesseract-wasm), one engine per model. The browser
 * runs this inside a Web Worker; the tests call it directly.
 */
export async function createTesseract(files: TesseractFiles) {
  const { createOCREngine } = await import("tesseract-wasm");
  const engines = new Map<OcrModel, Engine>();

  async function engineFor(model: OcrModel): Promise<Engine> {
    let engine = engines.get(model);
    if (!engine) {
      engine = await createOCREngine({ wasmBinary: files.wasm });
      engine.loadModel(files.models[model]);
      // Scans are read at their own resolution; this also silences Tesseract's guess.
      engine.setVariable("user_defined_dpi", "300");
      engines.set(model, engine);
    }
    return engine;
  }

  return {
    async readLines(image: GrayImage, options: OcrOptions): Promise<OcrLine[]> {
      const engine = await engineFor(options.model);
      engine.setVariable("tessedit_char_whitelist", options.whitelist ?? "");
      engine.loadImage(toRgba(image));
      return engine.getTextBoxes(options.unit ?? "line").map(({ rect, text, confidence }) => ({
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        text: text.trim(),
        confidence,
      }));
    },

    destroy(): void {
      for (const engine of engines.values()) engine.destroy();
      engines.clear();
    },
  };
}

function toRgba({ width, height, data }: GrayImage) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    rgba[o] = rgba[o + 1] = rgba[o + 2] = data[i];
    rgba[o + 3] = 255;
  }
  return { width, height, data: rgba } as ImageData;
}
