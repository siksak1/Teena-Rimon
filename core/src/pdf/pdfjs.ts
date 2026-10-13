import type { PDFDocumentProxy } from "pdfjs-dist";

export type OpenPdf = {
  pdf: PDFDocumentProxy;
  /** Free the document and its pdf.js worker. */
  close(): Promise<void>;
};

/**
 * WebAssembly files pdf.js needs for some images, by file name (e.g.
 * "jbig2.wasm", which decodes CCITT and JBIG2 scans). They are handed over as
 * bytes: the page's CSP lets it fetch nothing but analytics.
 */
export type PdfWasmFiles = Record<string, Uint8Array>;

/**
 * Open a PDF with pdf.js, loaded on first use so code that only needs the
 * parsers' metadata (the UI's supplier list) doesn't pull it into its bundle.
 * Images are decoded to raw pixels, never to canvases or ImageBitmaps, so a
 * scan reads the same in Node (the tests) and in the browser.
 */
export async function openPdf(data: Uint8Array, wasm: PdfWasmFiles = {}): Promise<OpenPdf> {
  const { getDocument } = await import("pdfjs-dist");

  /** pdf.js asks for its binary data here instead of fetching it. */
  class BundledBinaryData {
    async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
      const bytes = kind === "wasmUrl" ? wasm[filename] : undefined;
      if (!bytes) throw new Error(`${filename} is not bundled`);
      return bytes;
    }
  }

  const task = getDocument({
    // pdf.js may detach the buffer it is given — hand it a copy.
    data: new Uint8Array(data),
    BinaryDataFactory: BundledBinaryData,
    useWorkerFetch: false,
    wasmUrl: "bundled/",
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  });
  return { pdf: await task.promise, close: () => task.destroy() };
}
