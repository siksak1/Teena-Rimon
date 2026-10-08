import type { ReferenceRule } from "../customer.js";
import type { SupplierLine } from "../model.js";

/**
 * The wholesaler's "אסמכתא" holds either the supplier's booklet number or the
 * digits of the supplier's delivery document:
 *   "SH2610231" → "2610231", "2SH2605495" → "2605495", "SH26000547" → "26000547".
 * A "<branch>/<number>" document keeps only the number: "21/265134" → "265134".
 */
export function normalizeRef(value: string | null | undefined): string | null {
  if (!value) return null;
  const upper = value.slice(value.lastIndexOf("/") + 1).toUpperCase();
  const afterSh = upper.includes("SH") ? upper.slice(upper.lastIndexOf("SH") + 2) : upper;
  const digits = afterSh.replace(/\D/g, "").replace(/^0+/, "");
  return digits || null;
}

/** All keys under which the wholesaler may have recorded this supplier row's document. */
export function supplierRefKeys(line: SupplierLine, rules: ReferenceRule[]): string[] {
  return rules.map((rule) => normalizeRef(line[rule])).filter((k): k is string => Boolean(k));
}
