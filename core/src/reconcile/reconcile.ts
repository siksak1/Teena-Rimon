import type { ExtractionResult, GapFlag, MatchGroup, ReconciliationResult } from "../model.js";
import { round2 } from "../pdf/text.js";
import { describeGroup } from "./diffs.js";
import { pairDocuments } from "./docPairing.js";
import { matchGroups, type Candidate } from "./groupMatching.js";
import { NameMatcher } from "./names/NameMatcher.js";
import { prepare } from "./prepare.js";

/** Net item totals within this many shekels count as equal (rounding). */
const OFFSET_TOLERANCE = 1;
/** Gaps that may cancel each other out across the invoice. */
const OFFSETTABLE: GapFlag[] = ["quantity", "price", "packages"];

/**
 * Deterministic reconciliation of a supplier invoice against Teena-Rimon's
 * draft. Pure function — runs in the browser or in Node.
 */
export function reconcile(
  extraction: ExtractionResult,
  matcher: NameMatcher = new NameMatcher(),
): ReconciliationResult {
  const { supplier, tr } = prepare(extraction, matcher);
  const trDiscountPct = extraction.teenaRimon.discountPct;

  // 1. Pair delivery documents, 2. match rows inside each pair.
  const { scopes, unpairedSupplier, unpairedTr } = pairDocuments(supplier, tr);
  const candidates: Candidate[] = [];
  const leftoverS = [...unpairedSupplier];
  const leftoverT = [...unpairedTr];
  for (const scope of scopes) {
    const r = matchGroups(scope.supplier, scope.tr, matcher, { absorbLeftovers: true });
    candidates.push(...r.groups);
    leftoverS.push(...r.leftoverSupplier);
    leftoverT.push(...r.leftoverTr);
  }

  // 3. Leftover pass: rows still unmatched, across documents (±2 days; unrelated names need equal numbers).
  const last = matchGroups(leftoverS, leftoverT, matcher, { strictUnrelatedNames: true });
  candidates.push(...last.groups);

  const groups = candidates
    .map((c) => describeGroup("", c, trDiscountPct, matcher))
    .sort(bySeverity)
    .map((g, i) => ({ ...g, id: `G${i + 1}` }));

  // 4. Invoice totals and offsetting.
  const supplierNet = round2(supplier.reduce((a, x) => a + x.line.lineTotal, 0));
  const trGross = round2(tr.reduce((a, x) => a + x.line.lineTotal, 0));
  const discount = extraction.teenaRimon.commercialDiscount || trGross * trDiscountPct;
  const trNet = round2(trGross - discount);
  const diff = round2(trNet - supplierNet);
  const applies = Math.abs(diff) <= OFFSET_TOLERANCE;
  const offsetGroups = applies
    ? groups.filter((g) => g.netDiff !== 0 && g.flags.length > 0 && g.flags.every((f) => OFFSETTABLE.includes(f)))
    : [];

  const matchedNames = groups.flatMap((g) => [
    ...g.supplierLines.map((l) => matcher.parse(l.description, l.variety)),
    ...g.trLines.map((l) => matcher.parse(l.product, l.size)),
  ]);

  return {
    groups,
    supplierOnly: last.leftoverSupplier.map((x) => x.line).sort(byId),
    trOnly: last.leftoverTr.map((x) => x.line).sort(byId),
    offset: { applies, groups: offsetGroups },
    totals: { supplierNet, trGross, trDiscountPct, trNet, diff },
    warnings: [...extraction.supplier.warnings, ...extraction.teenaRimon.warnings],
    dictionarySuggestions: [...new Set(matchedNames.flatMap((n) => n.unknown))].sort(),
  };
}

/** Gaps first (largest money impact first), clean matches last in document order. */
function bySeverity(a: MatchGroup, b: MatchGroup): number {
  const aClean = a.flags.length === 0;
  const bClean = b.flags.length === 0;
  if (aClean !== bClean) return aClean ? 1 : -1;
  if (!aClean && Math.abs(b.netDiff) !== Math.abs(a.netDiff)) {
    return Math.abs(b.netDiff) - Math.abs(a.netDiff);
  }
  return byId(a.supplierLines[0], b.supplierLines[0]);
}

function byId(a: { id: string }, b: { id: string }): number {
  return Number(a.id.slice(1)) - Number(b.id.slice(1));
}
