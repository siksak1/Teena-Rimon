// tesseract-wasm ships typings its package.json "exports" doesn't expose;
// this declares the part of its API the OCR engine uses.
declare module "tesseract-wasm" {
  export type IntRect = { left: number; top: number; right: number; bottom: number };
  export type TextItem = { rect: IntRect; flags: number; confidence: number; text: string };

  export interface OCREngine {
    destroy(): void;
    setVariable(name: string, value: string): void;
    loadModel(model: Uint8Array | ArrayBuffer): void;
    loadImage(image: ImageData): void;
    getTextBoxes(unit: "line" | "word"): TextItem[];
  }

  export function createOCREngine(options?: { wasmBinary?: Uint8Array | ArrayBuffer }): Promise<OCREngine>;
  export function supportsFastBuild(): boolean;
}
