import type { PdfDocument } from "../pdf/layout.js";
import { granotParser } from "./granot.js";
import { shivukHahofParser } from "./shivukHahof.js";
import type { SupplierParser } from "./types.js";

/** Add a parser here to support a new supplier format. */
export const SUPPLIER_PARSERS: SupplierParser[] = [granotParser, shivukHahofParser];

export function detectSupplier(doc: PdfDocument): SupplierParser | null {
  return SUPPLIER_PARSERS.find((p) => p.detect(doc)) ?? null;
}
