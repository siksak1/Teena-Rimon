/**
 * Runs Tesseract off the main thread. Tesseract and its models are loaded
 * from the app's own script chunks on the first request; images come in and
 * text lines go out by postMessage — nothing else leaves this worker.
 */
import { createTesseract } from "@core/ocr/tesseract.js";
import type { GrayImage, OcrLine, OcrOptions } from "@core/ocr/types.js";
import { fromBase64, gunzip } from "./binary";

export type OcrRequest = { id: number; image: GrayImage; options: OcrOptions };
export type OcrResponse = { id: number; lines: OcrLine[] } | { id: number; error: string };

const scope = self as unknown as {
  onmessage: (e: MessageEvent<OcrRequest>) => void;
  postMessage(message: OcrResponse): void;
};

let engine: ReturnType<typeof createTesseract> | null = null;

async function load() {
  const { supportsFastBuild } = await import("tesseract-wasm");
  if (!supportsFastBuild()) {
    throw new Error("הדפדפן אינו תומך בקריאת חשבוניות סרוקות — יש לעדכן אותו לגרסה עדכנית");
  }
  const [wasm, eng, heb] = await Promise.all([
    import("virtual:binary/tesseract-core"),
    import("virtual:binary/eng-model"),
    import("virtual:binary/heb-model"),
  ]);
  return createTesseract({
    wasm: fromBase64(wasm.default),
    models: { eng: await gunzip(fromBase64(eng.default)), heb: await gunzip(fromBase64(heb.default)) },
  });
}

scope.onmessage = async ({ data: { id, image, options } }) => {
  try {
    engine ??= load();
    const lines = await (await engine).readLines(image, options);
    scope.postMessage({ id, lines });
  } catch (err) {
    engine = null;
    scope.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
