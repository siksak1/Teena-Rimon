import type { GapFlag, MatchGroup } from "../model.js";
import { round2 } from "../pdf/text.js";
import { daysBetween } from "./dates.js";
import type { Candidate } from "./groupMatching.js";
import type { NameMatcher } from "./names/NameMatcher.js";

const EPS = 0.001;

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
): MatchGroup {
  const { s, t } = candidate;
  const flags = new Set<GapFlag>();
  const notes: string[] = [];

  const supplierNet = round2(s.reduce((a, x) => a + x.net, 0));
  const ownNet = round2(t.reduce((a, x) => a + x.net, 0));
  const sKg = s.reduce((a, x) => a + x.line.quantity, 0);
  const tKg = t.reduce((a, x) => a + x.line.quantity, 0);
  const quantityDiff = round2(tKg - sKg);
  if (Math.abs(quantityDiff) > EPS) {
    flags.add("quantity");
    notes.push(`משקל: ספק ${fmt(sKg)}, ${ownName} ${fmt(tKg)} (${signed(quantityDiff)})`);
  }

  const sPk = s.every((x) => x.line.packages != null) ? s.reduce((a, x) => a + (x.line.packages ?? 0), 0) : null;
  const tPk = t.every((x) => x.line.packages != null) ? t.reduce((a, x) => a + (x.line.packages ?? 0), 0) : null;
  const packagesDiff = sPk != null && tPk != null ? tPk - sPk : null;
  if (packagesDiff) {
    flags.add("packages");
    notes.push(`אריזות: ספק ${sPk}, ${ownName} ${tPk}`);
  }

  const sPrices = unique(s.map((x) => x.line.unitPrice));
  const tPrices = unique(t.map((x) => x.line.unitPrice));
  if (sPrices.some((a) => tPrices.some((b) => Math.abs(a - b) > EPS))) {
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
