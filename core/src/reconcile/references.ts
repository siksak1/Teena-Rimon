/**
 * Teena-Rimon's "אסמכתא" holds either the supplier's booklet number or the
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

/** All keys under which Teena-Rimon may have recorded a supplier document. */
export function supplierRefKeys(docNumber: string | null, bookRef: string | null): string[] {
  return [normalizeRef(docNumber), normalizeRef(bookRef)].filter((k): k is string => Boolean(k));
}
