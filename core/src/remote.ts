import type { SupplierInvoice } from "./model.js";
import type { SupplierProfile } from "./parsers/profile.js";
import type { PdfDocument } from "./pdf/layout.js";

/**
 * The rows a parser saw in the supplier invoice (text and position), sent
 * with the PDF when it goes to the AI: the AI writes the supplier's layout
 * profile in these exact labels, and the backend checks that the profile
 * reads the same lines from these rows before it keeps it.
 */
export type RowsPayload = { page: number; y: number; cells: { text: string; xMin: number; xMax: number }[] }[];

export type AiRequest = {
  pdf: Uint8Array;
  fileName: string;
  /** A scan: `rows` were read by OCR in the browser. */
  scanned: boolean;
  rows: RowsPayload;
  /** The supplier's VAT number, as the wholesaler's own document names it. */
  vatHint: string | null;
};

/**
 * What the app may ask of the backend, only after every reader in the browser
 * has refused the supplier invoice (`config.aiFallback`). Injected, so the
 * core stays free of network code and the tests can stub it.
 */
export interface RemoteSupport {
  /** Learned layouts (`profile.ts`) of suppliers by VAT number; none for unknown ones. */
  profiles(vatIds: string[]): Promise<SupplierProfile[]>;
  /**
   * Last resort: read the invoice with the AI. Resolves to an invoice the
   * backend has checked (row arithmetic and printed total); rows it could not
   * confirm carry `ocrUncertain`. Rejects with an `ExtractionError`
   * (`AI_BLOCKED`, `AI_TIMEOUT`, `AI_REJECTED`, `AI_UNAVAILABLE`,
   * `AI_RATE_LIMITED`, `AI_UNREADABLE`) whose message says why.
   */
  readWithAi(request: AiRequest): Promise<SupplierInvoice>;
  /** Called before the invoice is sent, for a progress message. */
  onAiStart?(): void;
}

export function rowsPayload(doc: PdfDocument): RowsPayload {
  return doc.rows.map((r) => ({
    page: r.page,
    y: Math.round(r.y * 10) / 10,
    cells: r.cells.map((c) => ({ text: c.text, xMin: Math.round(c.xMin * 10) / 10, xMax: Math.round(c.xMax * 10) / 10 })),
  }));
}

/** Rebuild a document from rows sent by the browser (the backend reads the AI's profile with it). */
export function documentFromRows(rows: RowsPayload, repairedByOcr: boolean): PdfDocument {
  const pages: PdfDocument["pages"] = [];
  const all = rows.map((r) => {
    const cells = r.cells.map((c) => ({ ...c, x: (c.xMin + c.xMax) / 2 }));
    return { page: r.page, y: r.y, cells, text: cells.map((c) => c.text).join("  ") };
  });
  for (const row of all) (pages[row.page - 1] ??= []).push(row);
  const doc: PdfDocument = { pages: pages.filter(Boolean), rows: all, text: all.map((r) => r.text).join("\n") };
  if (repairedByOcr) doc.repairedByOcr = true;
  return doc;
}
