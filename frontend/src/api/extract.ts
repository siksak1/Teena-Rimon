import type { ExtractionError, ExtractionErrorCode } from "@core/errors.js";
import type { ExtractionResult } from "@core/model.js";
import customer from "@customer-config";

/** An expected failure (unreadable PDF, unsupported supplier…): `message` is for the user. */
export class ExtractError extends Error {
  readonly code: ExtractionErrorCode;

  constructor(message: string, code: ExtractionErrorCode) {
    super(message);
    this.code = code;
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
    // Matched by name: the class lives in the lazily loaded chunk.
    if (err instanceof Error && err.name === "ExtractionError") {
      throw new ExtractError(err.message, (err as ExtractionError).code);
    }
    throw err;
  }
}
