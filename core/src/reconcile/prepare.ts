import type { CustomerConfig } from "../customer.js";
import type { ExtractionResult, OwnLine, SupplierLine } from "../model.js";
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

/** Own-document line plus everything the matcher needs, computed once. */
export type OLine = {
  line: OwnLine;
  /** Gross × (1 − the own document's commercial discount). */
  net: number;
  name: ParsedName;
  ref: string | null;
  arithmeticOk: boolean;
};

export function prepare(
  extraction: ExtractionResult,
  matcher: NameMatcher,
  config: CustomerConfig,
): { supplier: SLine[]; own: OLine[] } {
  const ownDiscount = extraction.own.discountPct;
  const slack = config.tolerances.arithmeticTolerance;

  const supplier = extraction.supplier.lines.map((line) => ({
    line,
    net: line.lineTotal,
    name: matcher.parse(line.description, line.variety),
    refs: supplierRefKeys(line, config.referenceRules),
    arithmeticOk:
      Math.abs(line.quantity * line.unitPrice * (1 - line.discountPct) - line.lineTotal) <= slack,
  }));

  const own = extraction.own.lines.map((line) => ({
    line,
    net: round2(line.lineTotal * (1 - ownDiscount)),
    name: matcher.parse(line.product, line.size),
    ref: normalizeRef(line.supplierRef),
    arithmeticOk: Math.abs(line.quantity * line.unitPrice - line.lineTotal) <= slack,
  }));

  return { supplier, own };
}
