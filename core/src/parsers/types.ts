import type { SupplierInvoice } from "../model.js";
import type { PdfDocument } from "../pdf/layout.js";

/** One implementation per supplier invoice format. */
export interface SupplierParser {
  id: string;
  displayName: string;
  /** Cheap check on the document text (VAT number / company name). */
  detect(doc: PdfDocument): boolean;
  parse(doc: PdfDocument): SupplierInvoice;
}
