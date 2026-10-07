import type { ExtractionResult, SupplierLine, TrLine } from "../model.js";
import { round2 } from "../pdf/text.js";
import type { NameMatcher, ParsedName } from "./names/NameMatcher.js";
import { normalizeRef, supplierRefKeys } from "./references.js";

/** Supplier line plus everything the matcher needs, computed once. */
export type SLine = {
  line: SupplierLine;
  net: number;
  name: ParsedName;
  refs: string[];
  arithmeticOk: boolean;
};

export type TLine = {
  line: TrLine;
  /** Gross × (1 − Teena-Rimon commercial discount). */
  net: number;
  name: ParsedName;
  ref: string | null;
  arithmeticOk: boolean;
};

/** Rounding slack when checking quantity × price = line total. */
const ARITHMETIC_TOLERANCE = 0.05;

export function prepare(
  extraction: ExtractionResult,
  matcher: NameMatcher,
): { supplier: SLine[]; tr: TLine[] } {
  const trDiscount = extraction.teenaRimon.discountPct;

  const supplier = extraction.supplier.lines.map((line) => ({
    line,
    net: line.lineTotal,
    name: matcher.parse(line.description, line.variety),
    refs: supplierRefKeys(line.docNumber, line.bookRef),
    arithmeticOk:
      Math.abs(line.quantity * line.unitPrice * (1 - line.discountPct) - line.lineTotal) <=
      ARITHMETIC_TOLERANCE,
  }));

  const tr = extraction.teenaRimon.lines.map((line) => ({
    line,
    net: round2(line.lineTotal * (1 - trDiscount)),
    name: matcher.parse(line.product, line.size),
    ref: normalizeRef(line.supplierRef),
    arithmeticOk:
      Math.abs(line.quantity * line.unitPrice - line.lineTotal) <= ARITHMETIC_TOLERANCE,
  }));

  return { supplier, tr };
}
