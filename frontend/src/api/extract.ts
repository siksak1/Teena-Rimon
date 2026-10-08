import type { ExtractionResult } from "@core/model.js";
import customer from "@customer-config";

export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractError";
  }
}

/**
 * Parse both PDFs in this browser tab — invoice files never leave it. The
 * parsers (and pdf.js, ~1.6 MB) are loaded on demand to keep the first load small.
 */
export async function extractInvoices(ownFile: File, supplierFile: File): Promise<ExtractionResult> {
  const { extractInvoices: extract } = await import("@core/extract.js");
  try {
    return await extract(
      {
        ownPdf: new Uint8Array(await ownFile.arrayBuffer()),
        supplierPdf: new Uint8Array(await supplierFile.arrayBuffer()),
        ownFileName: ownFile.name,
        supplierFileName: supplierFile.name,
      },
      customer,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "ExtractionError") throw new ExtractError(err.message);
    throw err;
  }
}
