import type { CustomerConfig } from "../customer.js";
import type { ExtractionResult, GapFlag, MatchGroup, ReconciliationResult } from "../model.js";
import { round2 } from "../pdf/text.js";
import { describeGroup } from "./diffs.js";
import { pairDocuments } from "./docPairing.js";
import { matchGroups, type Candidate } from "./groupMatching.js";
import { DEFAULT_DICTIONARY, extendDictionary } from "./names/dictionary.js";
import { NameMatcher } from "./names/NameMatcher.js";
import { prepare } from "./prepare.js";

/** Gaps that may cancel each other out across the invoice. */
const OFFSETTABLE: GapFlag[] = ["quantity", "price", "packages"];

/** The shared product dictionary plus the customer's own entries. */
export function matcherFor(config: CustomerConfig): NameMatcher {
  return new NameMatcher(extendDictionary(DEFAULT_DICTIONARY, config.dictionary));
}

/**
 * Deterministic reconciliation of a supplier invoice against the wholesaler's
 * own document. Pure function — runs in the browser or in Node.
 */
export function reconcile(
  extraction: ExtractionResult,
  config: CustomerConfig,
  matcher: NameMatcher = matcherFor(config),
): ReconciliationResult {
  const tol = config.tolerances;
  const { supplier, own } = prepare(extraction, matcher, config);
  const ownDiscountPct = extraction.own.discountPct;

  // 1. Pair delivery documents, 2. match rows inside each pair.
  const { scopes, unpairedSupplier, unpairedOwn } = pairDocuments(supplier, own, tol);
  const candidates: Candidate[] = [];
  const leftoverS = [...unpairedSupplier];
  const leftoverT = [...unpairedOwn];
  for (const scope of scopes) {
    const r = matchGroups(scope.supplier, scope.own, matcher, tol, { absorbLeftovers: true });
    candidates.push(...r.groups);
    leftoverS.push(...r.leftoverSupplier);
    leftoverT.push(...r.leftoverOwn);
  }

  // 3. Leftover pass: rows still unmatched, across documents (within the date window; unrelated names need equal numbers).
  const last = matchGroups(leftoverS, leftoverT, matcher, tol, { strictUnrelatedNames: true });
  candidates.push(...last.groups);

  const groups = candidates
    .map((c) => describeGroup("", c, ownDiscountPct, matcher, config.displayName))
    .sort(bySeverity)
    .map((g, i) => ({ ...g, id: `G${i + 1}` }));

  // 4. Invoice totals and offsetting.
  const supplierNet = round2(supplier.reduce((a, x) => a + x.line.lineTotal, 0));
  const ownGross = round2(own.reduce((a, x) => a + x.line.lineTotal, 0));
  const discount = extraction.own.commercialDiscount || ownGross * ownDiscountPct;
  const ownNet = round2(ownGross - discount);
  const diff = round2(ownNet - supplierNet);
  const applies = config.offsetting === "invoice-wide" && Math.abs(diff) <= tol.offsetToleranceNis;
  const offsetGroups = applies
    ? groups.filter((g) => g.netDiff !== 0 && g.flags.length > 0 && g.flags.every((f) => OFFSETTABLE.includes(f)))
    : [];

  const matchedNames = groups.flatMap((g) => [
    ...g.supplierLines.map((l) => matcher.parse(l.description, l.variety)),
    ...g.ownLines.map((l) => matcher.parse(l.product, l.size)),
  ]);

  return {
    groups,
    supplierOnly: last.leftoverSupplier.map((x) => x.line).sort(byId),
    ownOnly: last.leftoverOwn.map((x) => x.line).sort(byId),
    offset: { applies, groups: offsetGroups },
    totals: { supplierNet, ownGross, ownDiscountPct, ownNet, diff },
    warnings: [...extraction.supplier.warnings, ...extraction.own.warnings],
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
