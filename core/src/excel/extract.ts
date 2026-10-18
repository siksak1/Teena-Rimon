import type { CustomerConfig } from "../customer.js";
import { ExtractionError } from "../errors.js";
import type { ExtractionResult } from "../model.js";
import { detectPair, FIELD_LABELS, MissingColumnsError, type PairDetection, readLayout } from "./columns.js";
import { parseOwnSheet, parseSupplierSheet } from "./formats.js";
import { readDataSheet } from "./read.js";

export type ExcelInput = {
  /** The wholesaler's own report (Teena-Rimon: receiving weighings). */
  ownXlsx: Uint8Array;
  /** The supplier's sales report, covering many growers. */
  supplierXlsx: Uint8Array;
  ownFileName: string;
  supplierFileName: string;
};

/**
 * Read both Excel reports into the same model as the PDFs, so the same
 * reconciliation runs on them. Columns are found by their values, whatever
 * they are called (see `columns.ts`). Runs in the browser and in Node.
 */
export async function extractExcel(input: ExcelInput, config: CustomerConfig): Promise<ExtractionResult> {
  if (!config.excel) throw new Error(`Customer "${config.slug}" has no Excel mode configured`);

  const [ownRows, supplierRows] = await Promise.all([readDataSheet(input.ownXlsx), readDataSheet(input.supplierXlsx)]);
  if (!ownRows) throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.ownFileName}" כקובץ אקסל (xlsx)`, "NOT_EXCEL");
  if (!supplierRows) {
    throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.supplierFileName}" כקובץ אקסל (xlsx)`, "NOT_EXCEL");
  }

  const ownLayout = readLayout(ownRows);
  const supplierLayout = readLayout(supplierRows);
  let columns: PairDetection;
  try {
    columns = detectPair(ownLayout, supplierLayout);
  } catch (err) {
    if (!(err instanceof MissingColumnsError)) throw err;
    const fileName = err.side === "own" ? input.ownFileName : input.supplierFileName;
    const missing = err.fields.map((f) => FIELD_LABELS[f]).join(", ");
    throw new ExtractionError(`בקובץ "${fileName}" לא זוהו עמודות של: ${missing}`, "MISSING_COLUMN");
  }

  // The sales report describes each item further (variety, size, grade); the
  // receiving report doesn't. The other way round, the files were swapped.
  if (columns.own.extras.length > 0 && columns.supplier.extras.length === 0) {
    throw new ExtractionError(
      `נראה שהקבצים הוחלפו — הדוח של ${config.displayName} הועלה במקום דוח הספק`,
      "FILES_SWAPPED",
    );
  }

  const supplier = parseSupplierSheet(supplierLayout, columns.supplier);
  const own = parseOwnSheet(ownLayout, columns.own, config.displayName);
  if (supplier.lines.length === 0) throw new ExtractionError(`לא נמצאו שורות פריטים בדוח הספק`, "NO_LINES");
  if (own.lines.length === 0) throw new ExtractionError(`לא נמצאו שורות פריטים בדוח ${config.displayName}`, "NO_LINES");

  return {
    supplier,
    own,
    meta: {
      ownFileName: input.ownFileName,
      supplierFileName: input.supplierFileName,
      format: "excel",
      excelColumns: { own: columns.own.used, supplier: columns.supplier.used },
    },
  };
}
