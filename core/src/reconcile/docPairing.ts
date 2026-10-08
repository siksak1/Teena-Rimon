import { DATE_TOLERANCE_DAYS, daysBetween, withinDateTolerance } from "./dates.js";
import type { SLine, TLine } from "./prepare.js";

/** A set of supplier rows and Teena-Rimon rows that describe the same delivery. */
export type Scope = { supplier: SLine[]; tr: TLine[] };

/** Minimum content similarity to pair documents whose references differ. */
const CONTENT_THRESHOLD = 0.5;
/**
 * Ranking bonus per day of date closeness: suppliers that ship the same goods
 * every day (Carmel's bananas) have near-identical content, so the date has
 * to decide. Small enough that a clearly better content match still wins.
 */
const SAME_DAY_BONUS_PER_DAY = 0.1;

/**
 * Pair supplier delivery documents with Teena-Rimon documents.
 *  A. by reference (book ref or SH digits) — the reliable path;
 *  B. remaining documents within ±2 days by content (same products, similar
 *     weights). Pass B covers clerks typing the wrong reference.
 * Unpaired documents are returned as-is and handled by the leftover pass.
 */
export function pairDocuments(
  supplier: SLine[],
  tr: TLine[],
): { scopes: Scope[]; unpairedSupplier: SLine[]; unpairedTr: TLine[] } {
  const sDocs = groupBy(supplier, (s) => s.line.docNumber ?? `date:${s.line.date}`);
  const tDocs = groupBy(tr, (t) => t.line.trDocNumber || `date:${t.line.date}`);
  const scopes: Scope[] = [];
  const pairedT = new Set<TLine[]>();
  const pairedS = new Set<SLine[]>();

  // Pass A — reference match. One supplier doc may cover several TR docs.
  for (const sDoc of sDocs) {
    const keys = new Set(sDoc.flatMap((s) => s.refs));
    const matches = tDocs.filter((tDoc) => !pairedT.has(tDoc) && tDoc.some((t) => t.ref && keys.has(t.ref)));
    if (matches.length === 0) continue;
    matches.forEach((m) => pairedT.add(m));
    pairedS.add(sDoc);
    scopes.push({ supplier: sDoc, tr: matches.flat() });
  }

  // Pass B — content match for what is left.
  const candidates: { sDoc: SLine[]; tDoc: TLine[]; rank: number }[] = [];
  for (const sDoc of sDocs) {
    if (pairedS.has(sDoc)) continue;
    for (const tDoc of tDocs) {
      if (pairedT.has(tDoc)) continue;
      if (!withinDateTolerance(sDoc[0].line.date, tDoc[0].line.date)) continue;
      const score = contentSimilarity(sDoc, tDoc);
      if (score < CONTENT_THRESHOLD) continue;
      const days = Math.abs(daysBetween(sDoc[0].line.date, tDoc[0].line.date) ?? DATE_TOLERANCE_DAYS);
      candidates.push({ sDoc, tDoc, rank: score + SAME_DAY_BONUS_PER_DAY * (DATE_TOLERANCE_DAYS - days) });
    }
  }
  candidates.sort((a, b) => b.rank - a.rank);
  for (const { sDoc, tDoc } of candidates) {
    if (pairedS.has(sDoc) || pairedT.has(tDoc)) continue;
    pairedS.add(sDoc);
    pairedT.add(tDoc);
    scopes.push({ supplier: sDoc, tr: tDoc });
  }

  return {
    scopes,
    unpairedSupplier: sDocs.filter((d) => !pairedS.has(d)).flat(),
    unpairedTr: tDocs.filter((d) => !pairedT.has(d)).flat(),
  };
}

/** Share of weight that lands on the same product family on both sides (0..1). */
function contentSimilarity(sDoc: SLine[], tDoc: TLine[]): number {
  const sKg = kgByFamily(sDoc.map((s) => [s.name.family, s.line.quantity]));
  const tKg = kgByFamily(tDoc.map((t) => [t.name.family, t.line.quantity]));
  let overlap = 0;
  for (const [family, kg] of sKg) overlap += Math.min(kg, tKg.get(family) ?? 0);
  const total = Math.max(sum([...sKg.values()]), sum([...tKg.values()]));
  return total ? overlap / total : 0;
}

function kgByFamily(entries: [string | null, number][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [family, kg] of entries) {
    if (family) out.set(family, (out.get(family) ?? 0) + kg);
  }
  return out;
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return [...map.values()];
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
