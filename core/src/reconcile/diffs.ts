import type { GapFlag, MatchGroup } from "../model.js";
import { round2 } from "../pdf/text.js";
import { daysBetween } from "./dates.js";
import type { Candidate } from "./groupMatching.js";
import type { NameMatcher } from "./names/NameMatcher.js";

const EPS = 0.001;
/**
 * Prices are printed in agorot. A list price recovered from an already
 * discounted one (see `unprintedDiscounts`) can be off by half an agora
 * divided by (1 − rate), so smaller price gaps are not reported.
 */
const PRICE_EPS = 0.006;

/**
 * Turn a matched candidate into a group with its gaps spelled out (Hebrew
 * notes). `ownName` is the wholesaler's name as shown in the notes.
 */
export function describeGroup(
  id: string,
  candidate: Candidate,
  ownDiscountPct: number,
  matcher: NameMatcher,
  ownName: string,
  /**
   * Net gap of the whole document when it is within `documentToleranceNis`:
   * weight and price gaps are then not reported (package counts and discount
   * rates still are).
   */
  settledDocDiff: number | null = null,
): MatchGroup {
  const { s, t } = candidate;
  const flags = new Set<GapFlag>();
  const notes: string[] = [];

  const supplierNet = round2(s.reduce((a, x) => a + x.net, 0));
  const ownNet = round2(t.reduce((a, x) => a + x.net, 0));
  const sKg = s.reduce((a, x) => a + x.line.quantity, 0);
  const tKg = t.reduce((a, x) => a + x.line.quantity, 0);
  const quantityDiff = round2(tKg - sKg);
  const sPrices = unique(s.map((x) => x.line.unitPrice));
  const tPrices = unique(t.map((x) => x.line.unitPrice));
  const priceGap = sPrices.some((a) => tPrices.some((b) => Math.abs(a - b) > PRICE_EPS));
  // The document as a whole is within a shekel or so: weight and price gaps are not reported.
  const settled = settledDocDiff != null;
  if (settled && (Math.abs(quantityDiff) > EPS || priceGap)) {
    notes.push(`הפרש זניח בתעודה כולה (${signed(settledDocDiff)} ₪) — לא מוצג כפער`);
  }
  if (!settled && Math.abs(quantityDiff) > EPS) {
    flags.add("quantity");
    // Excel reports: pineapples are counted in pieces, not weighed.
    const label = s.every((x) => x.line.unit === "יח'") ? "יחידות" : "משקל";
    notes.push(`${label}: ספק ${fmt(sKg)}, ${ownName} ${fmt(tKg)} (${signed(quantityDiff)})`);
  }

  const sPk = s.every((x) => x.line.packages != null) ? s.reduce((a, x) => a + (x.line.packages ?? 0), 0) : null;
  const tPk = t.every((x) => x.line.packages != null) ? t.reduce((a, x) => a + (x.line.packages ?? 0), 0) : null;
  const packagesDiff = sPk != null && tPk != null ? tPk - sPk : null;
  if (packagesDiff) {
    flags.add("packages");
    notes.push(`אריזות: ספק ${sPk}, ${ownName} ${tPk}`);
  }

  if (!settled && priceGap) {
    flags.add("price");
    notes.push(`מחיר: ספק ${sPrices.map(fmt).join("/")}, ${ownName} ${tPrices.map(fmt).join("/")}`);
  }

  const discounts = unique(s.map((x) => x.line.discountPct));
  if (discounts.some((d) => Math.abs(d - ownDiscountPct) > 0.0005)) {
    flags.add("discount");
    notes.push(`הנחה: בשורת הספק ${discounts.map(pct).join("/")}, אצל ${ownName} ${pct(ownDiscountPct)}`);
  }

  const conflicts = unique(s.flatMap((a) => t.flatMap((b) => matcher.compare(a.name, b.name).conflicts)));
  if (conflicts.length) {
    flags.add("name");
    notes.push(...conflicts);
  }

  // Matched on doc / date / numbers alone — informational, not a gap.
  if (s.some((a) => t.some((b) => !matcher.compare(a.name, b.name).sameFamily))) {
    const sNames = unique(s.map((x) => x.line.description));
    const tNames = unique(t.map((x) => x.line.product));
    notes.push(`שם: "${sNames.join(" / ")}" ↔ "${tNames.join(" / ")}" (לא זוהה כאותו מוצר; ההתאמה לפי מספרים)`);
  }

  const sRefs = new Set(s.flatMap((x) => x.refs));
  const tRefs = unique(t.map((x) => x.line.supplierRef));
  if (t.some((x) => !x.ref || !sRefs.has(x.ref))) {
    flags.add("doc_ref");
    const supplierDoc = unique(s.map((x) => [x.line.bookRef, x.line.docNumber].filter(Boolean).join(" / ")));
    notes.push(`אסמכתא שונה: ספק ${supplierDoc.join(", ")}, ${ownName} ${tRefs.join(", ") || "—"}`);
  }

  const badArithmetic = [...s.filter((x) => !x.arithmeticOk).map((x) => x.line.id), ...t.filter((x) => !x.arithmeticOk).map((x) => x.line.id)];
  if (badArithmetic.length) {
    flags.add("arithmetic");
    notes.push(`כמות × מחיר אינו שווה לסה"כ השורה (${badArithmetic.join(", ")})`);
  }

  return {
    id,
    supplierLines: s.map((x) => x.line),
    ownLines: t.map((x) => x.line),
    supplierNet,
    ownNet,
    netDiff: round2(ownNet - supplierNet),
    quantityDiff,
    packagesDiff,
    dateDelta: daysBetween(s[0].line.date, t[0].line.date),
    flags: [...flags],
    notes,
    score: Math.round(candidate.score * 1000) / 1000,
  };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function fmt(n: number): string {
  return String(round2(n));
}

function signed(n: number): string {
  return n > 0 ? `+${fmt(n)}` : fmt(n);
}

function pct(fraction: number): string {
  return `${round2(fraction * 100)}%`;
}
