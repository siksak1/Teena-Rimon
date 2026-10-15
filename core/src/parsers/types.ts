import type { OwnInvoice, SupplierInvoice } from "../model.js";
import type { GrayImage, OcrEngine } from "../ocr/types.js";
import type { PdfDocument } from "../pdf/layout.js";

/** One implementation per supplier invoice format. */
export type SupplierParser = TextSupplierParser | ScannedSupplierParser;

/** A supplier whose invoices are digital PDFs, read from their text. */
export interface TextSupplierParser {
  id: string;
  displayName: string;
  scanned?: false;
  /**
   * A generic parser, tried only after every supplier-specific one, when the
   * customer's config allows it (`genericFallback`).
   */
  fallback?: true;
  /** Cheap check on the document text (VAT number / company name). */
  detect(doc: PdfDocument): boolean;
  parse(doc: PdfDocument): SupplierInvoice;
}

/** A supplier who sends scanned invoices, read from the page images by OCR. */
export interface ScannedSupplierParser {
  id: string;
  displayName: string;
  scanned: true;
  /**
   * Printed on the invoice. Found in the text layer when the scanner added
   * one (too garbled to parse, but a VAT number survives), else by OCR of the
   * top of the first page.
   */
  vatId: string;
  /** `pages` are upright; `onPage` reports progress. */
  parseScan(pages: GrayImage[], ocr: OcrEngine, onPage?: (done: number) => void): Promise<SupplierInvoice>;
}

/** One implementation per format of the wholesaler's own document. */
export interface OwnDocumentParser {
  id: string;
  detect(doc: PdfDocument): boolean;
  /** `customerName` labels the parser's warnings and errors. */
  parse(doc: PdfDocument, customerName: string): OwnInvoice;
}
