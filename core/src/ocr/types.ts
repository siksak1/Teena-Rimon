/**
 * OCR for scanned supplier invoices. The engine (Tesseract compiled to WASM)
 * is injected by the caller — a Web Worker in the browser, a direct instance
 * in the tests — so the core stays free of how its files are delivered.
 */

/** 8-bit greyscale, row-major; 0 is black, 255 is white. */
export type GrayImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type Box = { left: number; top: number; right: number; bottom: number };

/** One recognised text line, with its box in the image that was passed in. */
export type OcrLine = Box & {
  text: string;
  /** 0–1, as reported by Tesseract. */
  confidence: number;
};

/** "eng" reads digits, dates and amounts; "heb" reads product names and labels. */
export type OcrModel = "eng" | "heb";

/** `unit: "word"` returns one box per word instead of per line. */
export type OcrOptions = { model: OcrModel; whitelist?: string; unit?: "line" | "word" };

export interface OcrEngine {
  readLines(image: GrayImage, options: OcrOptions): Promise<OcrLine[]>;
}

/**
 * Everything a scanned invoice needs beyond pdf.js, loaded only when one is
 * uploaded: the CCITT/JBIG2 image decoder and the OCR engine.
 */
export type ScanSupport = {
  jbig2Wasm(): Promise<Uint8Array>;
  ocr(): Promise<OcrEngine>;
  /** Called as pages are read, for a progress message. */
  onProgress?(done: number, total: number): void;
};
