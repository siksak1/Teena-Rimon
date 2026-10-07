import { daysBetween, withinDateTolerance } from "./dates.js";
import type { NameMatcher } from "./names/NameMatcher.js";
import type { SLine, TLine } from "./prepare.js";

export type Candidate = { s: SLine[]; t: TLine[]; score: number };

/** Largest number of rows on the "many" side of a group (1:k or k:1). */
const MAX_GROUP_SIZE = 4;
/** A pair is rejected only when BOTH weight and price differ by more than this. */
const REJECT_RELATIVE_DIFF = 0.05;
/** Multi-row groups must add up to the same weight within this many kg. */
const SUM_TOLERANCE_KG = 1;
/** Safety net for the exhaustive search; beyond it the best found so far is used. */
const SEARCH_NODE_LIMIT = 200_000;

const WEIGHTS = { name: 0.2, quantity: 0.35, price: 0.25, packages: 0.1, date: 0.1 };

/**
 * Match supplier rows to Teena-Rimon rows inside one scope. Groups are
 * 1:1, 1:k or k:1 and never cross product families. The chosen set covers
 * as many rows as possible, then maximises the total score.
 */
export function matchGroups(
  supplier: SLine[],
  tr: TLine[],
  matcher: NameMatcher,
): { groups: Candidate[]; leftoverSupplier: SLine[]; leftoverTr: TLine[] } {
  const groups: Candidate[] = [];
  const families = new Set(supplier.map((s) => s.name.family).filter((f): f is string => !!f));

  for (const family of families) {
    const s = supplier.filter((x) => x.name.family === family);
    const t = tr.filter((x) => x.name.family === family);
    if (t.length === 0) continue;
    groups.push(...selectGroups(s, t, candidatesFor(s, t, matcher)));
  }

  const usedS = new Set(groups.flatMap((g) => g.s));
  const usedT = new Set(groups.flatMap((g) => g.t));
  return {
    groups,
    leftoverSupplier: supplier.filter((x) => !usedS.has(x)),
    leftoverTr: tr.filter((x) => !usedT.has(x)),
  };
}

function candidatesFor(s: SLine[], t: TLine[], matcher: NameMatcher): Candidate[] {
  const out: Candidate[] = [];
  const add = (sGroup: SLine[], tGroup: TLine[]) => {
    if (!sGroup.every((a) => tGroup.every((b) => withinDateTolerance(a.line.date, b.line.date)))) return;
    const multi = sGroup.length > 1 || tGroup.length > 1;
    if (multi ? !sumsAgree(sGroup, tGroup) : rejectPair(sGroup[0], tGroup[0])) return;
    out.push({ s: sGroup, t: tGroup, score: scoreGroup(sGroup, tGroup, matcher) });
  };

  for (const a of s) for (const b of t) add([a], [b]);
  for (const a of s) for (const subset of subsets(t, 2, MAX_GROUP_SIZE)) add([a], subset);
  for (const b of t) for (const subset of subsets(s, 2, MAX_GROUP_SIZE)) add(subset, [b]);
  return out.sort((x, y) => y.score - x.score);
}

/** Same item even with big gaps — unless weight AND price are both off by >5%. */
function rejectPair(s: SLine, t: TLine): boolean {
  return (
    relDiff(s.line.quantity, t.line.quantity) > REJECT_RELATIVE_DIFF &&
    relDiff(s.line.unitPrice, t.line.unitPrice) > REJECT_RELATIVE_DIFF
  );
}

/** Multi-row groups need matching weight sums, plus equal packages or equal prices. */
function sumsAgree(s: SLine[], t: TLine[]): boolean {
  if (Math.abs(sumOf(s, (x) => x.line.quantity) - sumOf(t, (x) => x.line.quantity)) > SUM_TOLERANCE_KG) {
    return false;
  }
  const sPk = packagesSum(s);
  const tPk = packagesSum(t);
  if (sPk != null && tPk != null && sPk === tPk) return true;
  const prices = new Set([...s.map((x) => x.line.unitPrice), ...t.map((x) => x.line.unitPrice)]);
  return prices.size === 1;
}

function scoreGroup(s: SLine[], t: TLine[], matcher: NameMatcher): number {
  let nameTotal = 0;
  for (const a of s) for (const b of t) nameTotal += matcher.compare(a.name, b.name).score;
  const name = nameTotal / (s.length * t.length);

  const quantity = closeness(relDiff(sumOf(s, (x) => x.line.quantity), sumOf(t, (x) => x.line.quantity)));
  const price = closeness(relDiff(weightedPrice(s), weightedPrice(t)));

  const sPk = packagesSum(s);
  const tPk = packagesSum(t);
  const packages = sPk == null || tPk == null ? 0.5 : sPk === tPk ? 1 : 0;

  let worstDays = 0;
  let unknownDate = false;
  for (const a of s) {
    for (const b of t) {
      const d = daysBetween(a.line.date, b.line.date);
      if (d == null) unknownDate = true;
      else worstDays = Math.max(worstDays, Math.abs(d));
    }
  }
  const date = unknownDate ? 0.5 : [1, 0.6, 0.3][worstDays] ?? 0;

  return (
    WEIGHTS.name * name +
    WEIGHTS.quantity * quantity +
    WEIGHTS.price * price +
    WEIGHTS.packages * packages +
    WEIGHTS.date * date
  );
}

/**
 * Pick non-overlapping groups: maximise rows covered, then total score.
 * Exhaustive branch-and-bound over the supplier rows (families inside a
 * document are small); the objective weights coverage far above score.
 */
function selectGroups(s: SLine[], t: TLine[], candidates: Candidate[]): Candidate[] {
  const sIndex = new Map(s.map((x, i) => [x, i]));
  const tIndex = new Map(t.map((x, i) => [x, i]));
  // Each candidate is tried when the search reaches its first supplier row.
  const byFirstRow: Candidate[][] = s.map(() => []);
  for (const c of candidates) byFirstRow[Math.min(...c.s.map((x) => sIndex.get(x)!))].push(c);

  const value = (c: Candidate) => (c.s.length + c.t.length) * 10 + c.score;
  const usedS = new Array<boolean>(s.length).fill(false);
  const usedT = new Array<boolean>(t.length).fill(false);
  const chosen: Candidate[] = [];
  let best: Candidate[] = [];
  let bestValue = -1;
  let nodes = 0;

  const search = (i: number, current: number, freeT: number) => {
    if (++nodes > SEARCH_NODE_LIMIT) return;
    while (i < s.length && usedS[i]) i++;
    if (i === s.length) {
      if (current > bestValue) {
        bestValue = current;
        best = [...chosen];
      }
      return;
    }
    const remainingS = usedS.slice(i).filter((u) => !u).length;
    if (current + (remainingS + freeT) * 10 + remainingS <= bestValue) return;

    for (const c of byFirstRow[i]) {
      const sIdx = c.s.map((x) => sIndex.get(x)!);
      const tIdx = c.t.map((x) => tIndex.get(x)!);
      if (sIdx.some((k) => usedS[k]) || tIdx.some((k) => usedT[k])) continue;
      sIdx.forEach((k) => (usedS[k] = true));
      tIdx.forEach((k) => (usedT[k] = true));
      chosen.push(c);
      search(i + 1, current + value(c), freeT - tIdx.length);
      chosen.pop();
      sIdx.forEach((k) => (usedS[k] = false));
      tIdx.forEach((k) => (usedT[k] = false));
    }
    // Leave supplier row i unmatched.
    usedS[i] = true;
    search(i + 1, current, freeT);
    usedS[i] = false;
  };

  search(0, 0, t.length);
  return best;
}

function* subsets<T>(items: T[], min: number, max: number, start = 0, acc: T[] = []): Generator<T[]> {
  if (acc.length >= min) yield [...acc];
  if (acc.length === max) return;
  for (let i = start; i < items.length; i++) {
    acc.push(items[i]);
    yield* subsets(items, min, max, i + 1, acc);
    acc.pop();
  }
}

export function relDiff(a: number, b: number): number {
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base === 0 ? 0 : Math.abs(a - b) / base;
}

/** 1 at equality, falling linearly to 0 at the 5% rejection threshold. */
function closeness(rel: number): number {
  return Math.max(0, 1 - rel / REJECT_RELATIVE_DIFF);
}

function sumOf<T>(items: T[], f: (x: T) => number): number {
  return items.reduce((acc, x) => acc + f(x), 0);
}

function packagesSum(items: (SLine | TLine)[]): number | null {
  if (items.some((x) => x.line.packages == null)) return null;
  return sumOf(items, (x) => x.line.packages ?? 0);
}

function weightedPrice(items: (SLine | TLine)[]): number {
  const kg = sumOf(items, (x) => x.line.quantity);
  return kg ? sumOf(items, (x) => x.line.quantity * x.line.unitPrice) / kg : 0;
}
