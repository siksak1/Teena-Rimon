import type { OwnInvoice, SupplierInvoice } from "../model.js";
import type { PdfDocument } from "../pdf/layout.js";

/** One implementation per supplier invoice format. */
export interface SupplierParser {
  id: string;
  displayName: string;
  /** Cheap check on the document text (VAT number / company name). */
  detect(doc: PdfDocument): boolean;
  parse(doc: PdfDocument): SupplierInvoice;
}

/** One implementation per format of the wholesaler's own document. */
export interface OwnDocumentParser {
  id: string;
  detect(doc: PdfDocument): boolean;
  /** `customerName` labels the parser's warnings and errors. */
  parse(doc: PdfDocument, customerName: string): OwnInvoice;
}
