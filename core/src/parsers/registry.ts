import type { PdfDocument } from "../pdf/layout.js";
import { dHaiParser, menashriParser } from "./agroline.js";
import { carmelParser } from "./carmel.js";
import { galilParser } from "./galil.js";
import { granotParser } from "./granot.js";
import { haklaimParser } from "./haklaim.js";
import { hasorParser } from "./hasor.js";
import { shivukHahofParser } from "./shivukHahof.js";
import type { SupplierParser } from "./types.js";

/** Add a parser here to support a new supplier format. */
export const SUPPLIER_PARSERS: SupplierParser[] = [
  granotParser,
  shivukHahofParser,
  dHaiParser,
  menashriParser,
  haklaimParser,
  galilParser,
  carmelParser,
  hasorParser,
];

/** Suppliers we recognise but cannot parse, with the reason shown to the user. */
export const UNSUPPORTED_SUPPLIERS = [
  {
    vatId: "513221630",
    name: "הר-קור",
    reason: "החשבונית סרוקה (תמונה) ואין בה טקסט קריא — יש לבקש מהספק PDF דיגיטלי",
  },
];

export function detectSupplier(doc: PdfDocument): SupplierParser | null {
  return SUPPLIER_PARSERS.find((p) => p.detect(doc)) ?? null;
}
