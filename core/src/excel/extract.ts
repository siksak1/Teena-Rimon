import type { CustomerConfig } from "../customer.js";
import { ExtractionError } from "../errors.js";
import type { ExtractionResult } from "../model.js";
import { detectExcel, EXCEL_OWN_FORMATS, EXCEL_SUPPLIER_FORMATS, missingHeaders } from "./formats.js";
import { readFirstSheet } from "./read.js";

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
 * reconciliation runs on them. Runs in the browser and in Node.
 */
export async function extractExcel(input: ExcelInput, config: CustomerConfig): Promise<ExtractionResult> {
  if (!config.excel) throw new Error(`Customer "${config.slug}" has no Excel formats configured`);
  const ownFormat = EXCEL_OWN_FORMATS[config.excel.ownFormat];
  const supplierFormat = EXCEL_SUPPLIER_FORMATS[config.excel.supplierFormat];
  if (!ownFormat) throw new Error(`Unknown Excel own format "${config.excel.ownFormat}"`);
  if (!supplierFormat) throw new Error(`Unknown Excel supplier format "${config.excel.supplierFormat}"`);

  const [ownRows, supplierRows] = await Promise.all([
    readFirstSheet(input.ownXlsx),
    readFirstSheet(input.supplierXlsx),
  ]);
  if (!ownRows) throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.ownFileName}" כקובץ אקסל (xlsx)`, "NOT_EXCEL");
  if (!supplierRows) {
    throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.supplierFileName}" כקובץ אקסל (xlsx)`, "NOT_EXCEL");
  }

  if (!detectExcel(ownFormat, ownRows) && detectExcel(ownFormat, supplierRows) && detectExcel(supplierFormat, ownRows)) {
    throw new ExtractionError(
      `נראה שהקבצים הוחלפו — הדוח של ${config.displayName} הועלה במקום דוח הספק`,
      "FILES_SWAPPED",
    );
  }
  for (const [format, rows, fileName] of [
    [ownFormat, ownRows, input.ownFileName],
    [supplierFormat, supplierRows, input.supplierFileName],
  ] as const) {
    if (detectExcel(format, rows)) continue;
    const missing = missingHeaders(format, rows).map((h) => `"${h}"`).join(", ");
    throw new ExtractionError(`בקובץ "${fileName}" (${format.label}) חסרות העמודות: ${missing}`, "MISSING_COLUMN");
  }

  const supplier = supplierFormat.parse(supplierRows);
  const own = ownFormat.parse(ownRows, config.displayName);
  if (supplier.lines.length === 0) throw new ExtractionError(`לא נמצאו שורות פריטים בדוח הספק`, "NO_LINES");
  if (own.lines.length === 0) throw new ExtractionError(`לא נמצאו שורות פריטים בדוח ${config.displayName}`, "NO_LINES");

  return {
    supplier,
    own,
    meta: { ownFileName: input.ownFileName, supplierFileName: input.supplierFileName, format: "excel" },
  };
}
