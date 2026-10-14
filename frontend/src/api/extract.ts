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
 * parsers (and pdf.js, ~1.6 MB) are loaded on demand to keep the first load
 * small; OCR (~5 MB) only when the supplier invoice is a scan.
 * `onScanProgress` reports pages read from a scanned invoice.
 */
export async function extractInvoices(
  ownFile: File,
  supplierFile: File,
  onScanProgress?: (done: number, total: number) => void,
): Promise<ExtractionResult> {
  const [{ extractInvoices: extract }, { GlobalWorkerOptions }, { default: pdfWorker }, { browserScanSupport }] =
    await Promise.all([
      import("@core/extract.js"),
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?worker&url"),
      import("./ocr"),
    ]);
  // pdf.js parses in its own worker, served from the app's own files.
  GlobalWorkerOptions.workerSrc = pdfWorker;
  try {
    return await extract(
      {
        ownPdf: new Uint8Array(await ownFile.arrayBuffer()),
        supplierPdf: new Uint8Array(await supplierFile.arrayBuffer()),
        ownFileName: ownFile.name,
        supplierFileName: supplierFile.name,
      },
      customer,
      browserScanSupport(onScanProgress),
    );
  } catch (err) {
    throw asExtractError(err);
  }
}

/**
 * Read the two Excel reports (supplier sales, own weighings) in this tab.
 * The spreadsheet reader is loaded only when Excel mode is used.
 */
export async function extractExcelReports(ownFile: File, supplierFile: File): Promise<ExtractionResult> {
  const { extractExcel } = await import("@core/excel/extract.js");
  try {
    return await extractExcel(
      {
        ownXlsx: new Uint8Array(await ownFile.arrayBuffer()),
        supplierXlsx: new Uint8Array(await supplierFile.arrayBuffer()),
        ownFileName: ownFile.name,
        supplierFileName: supplierFile.name,
      },
      customer,
    );
  } catch (err) {
    throw asExtractError(err);
  }
}

function asExtractError(err: unknown): unknown {
  // Matched by name: the class lives in the lazily loaded chunk.
  if (err instanceof Error && err.name === "ExtractionError") {
    return new ExtractError(err.message, (err as ExtractionError).code);
  }
  return err;
}
