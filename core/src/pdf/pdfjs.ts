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

/** A rendered page in greyscale, with the scale from PDF points to pixels. */
export type RenderedPage = { image: import("../ocr/types.js").GrayImage; scale: number; heightPt: number };

/**
 * Render pages to greyscale pixels. Glyphs are drawn from the embedded font
 * programs, so text whose characters are unmapped still appears as ink. Uses
 * pdf.js's own canvas: the DOM in the browser, @napi-rs/canvas in Node.
 */
export async function renderPages(data: Uint8Array, pages: number[], scale: number): Promise<Map<number, RenderedPage>> {
  const { pdf, close } = await openPdf(data);
  try {
    const out = new Map<number, RenderedPage>();
    const factory = pdf.canvasFactory as {
      create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D };
      destroy(c: unknown): void;
    };
    for (const p of pages) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      const target = factory.create(width, height);
      const ctx = target.context;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      await page.render({ canvasContext: ctx, viewport, canvas: target.canvas as HTMLCanvasElement }).promise;
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const gray = new Uint8Array(width * height);
      for (let i = 0; i < gray.length; i++) {
        const o = i * 4;
        gray[i] = (rgba[o] * 299 + rgba[o + 1] * 587 + rgba[o + 2] * 114) / 1000;
      }
      factory.destroy(target);
      out.set(p, { image: { width, height, data: gray }, scale, heightPt: page.getViewport({ scale: 1 }).height });
    }
    return out;
  } finally {
    await close();
  }
}
