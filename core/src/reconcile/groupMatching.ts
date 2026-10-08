import type { Tolerances } from "../customer.js";
import { daysBetween, withinDays } from "./dates.js";
import type { NameMatcher } from "./names/NameMatcher.js";
import type { SLine, OLine } from "./prepare.js";

export type Candidate = { s: SLine[]; t: OLine[]; score: number };

/** Safety net for the exhaustive search; beyond it the best found so far is used. */
const SEARCH_NODE_LIMIT = 200_000;

const WEIGHTS = { name: 0.2, quantity: 0.35, price: 0.25, packages: 0.1, date: 0.1 };

export type MatchOptions = {
  /**
   * Across documents there is no reference to lean on: a pair whose names
   * cannot be related must then agree on both weight and price (within
   * `rejectRelativeDiff`).
   */
  strictUnrelatedNames?: boolean;
  /**
   * Inside one paired delivery, attach leftover rows to a same-family group
   * when that brings the group's weights closer (splits too large or too
   * uneven for the exact search), and pair leftovers of one family.
   */
  absorbLeftovers?: boolean;
};

/**
 * Match supplier rows to own-document rows inside one scope. Names are a soft
 * signal: any pair is a candidate unless both names are known, different
 * products. Groups are 1:1, or 1:k / k:1 within one product family. The
 * chosen set covers as many rows as possible, then maximises the total score.
 */
export function matchGroups(
  supplier: SLine[],
  own: OLine[],
  matcher: NameMatcher,
  tolerances: Tolerances,
  options: MatchOptions = {},
): { groups: Candidate[]; leftoverSupplier: SLine[]; leftoverOwn: OLine[] } {
  const groups: Candidate[] = [];
  for (const component of components(candidatesFor(supplier, own, matcher, tolerances, options))) {
    groups.push(...selectGroups(component.s, component.t, component.candidates));
  }
  if (options.absorbLeftovers) absorbLeftovers(groups, supplier, own, matcher, tolerances);

  const usedS = new Set(groups.flatMap((g) => g.s));
  const usedT = new Set(groups.flatMap((g) => g.t));
  return {
    groups,
    leftoverSupplier: supplier.filter((x) => !usedS.has(x)),
    leftoverOwn: own.filter((x) => !usedT.has(x)),
  };
}

function candidatesFor(
  s: SLine[],
  t: OLine[],
  matcher: NameMatcher,
  tol: Tolerances,
  options: MatchOptions,
): Candidate[] {
  const out: Candidate[] = [];
  const add = (sGroup: SLine[], tGroup: OLine[]) => {
    if (!sGroup.every((a) => tGroup.every((b) => withinDays(a.line.date, b.line.date, tol.dateWindowDays)))) return;
    const multi = sGroup.length > 1 || tGroup.length > 1;
    if (multi ? !sumsAgree(sGroup, tGroup, tol) : rejectPair(sGroup[0], tGroup[0], tol)) return;
    out.push({ s: sGroup, t: tGroup, score: scoreGroup(sGroup, tGroup, matcher, tol) });
  };

  for (const a of s) {
    for (const b of t) {
      const name = matcher.compare(a.name, b.name);
      if (!name.compatible) continue;
      if (options.strictUnrelatedNames && !name.sameFamily && !numbersAgree(a, b, tol)) continue;
      add([a], [b]);
    }
  }
  // Splits only within one family: summing unrelated rows finds coincidences.
  const sameFamily = (x: SLine | OLine, y: SLine | OLine) => matcher.compare(x.name, y.name).sameFamily;
  for (const a of s) {
    for (const subset of subsets(t.filter((b) => sameFamily(a, b)), 2, tol.maxGroupSize)) add([a], subset);
  }
  for (const b of t) {
    for (const subset of subsets(s.filter((a) => sameFamily(a, b)), 2, tol.maxGroupSize)) add(subset, [b]);
  }
  return out.sort((x, y) => y.score - x.score);
}

/**
 * Split candidates into independent sets (no shared rows between sets), so
 * the exhaustive search runs on small problems.
 */
function components(candidates: Candidate[]): { s: SLine[]; t: OLine[]; candidates: Candidate[] }[] {
  const parent = new Map<SLine | OLine, SLine | OLine>();
  const find = (x: SLine | OLine): SLine | OLine => {
    const p = parent.get(x) ?? x;
    if (p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  for (const c of candidates) {
    const [first, ...rest] = [...c.s, ...c.t];
    for (const x of rest) parent.set(find(x), find(first));
  }
  const byRoot = new Map<SLine | OLine, { s: Set<SLine>; t: Set<OLine>; candidates: Candidate[] }>();
  for (const c of candidates) {
    const root = find(c.s[0]);
    let entry = byRoot.get(root);
    if (!entry) byRoot.set(root, (entry = { s: new Set(), t: new Set(), candidates: [] }));
    c.s.forEach((x) => entry.s.add(x));
    c.t.forEach((x) => entry.t.add(x));
    entry.candidates.push(c);
  }
  return [...byRoot.values()].map((e) => ({ s: [...e.s], t: [...e.t], candidates: e.candidates }));
}

/**
 * Greedy clean-up after the exact search, largest rows first:
 *  - a leftover row joins the group (best name score first) whose weight
 *    gap it reduces the most — never one it would worsen, so a genuinely
 *    extra row stays unmatched. It must be the same family as the other
 *    side, or as the rows already on its own side ("more of the same");
 *  - otherwise, if the other side has leftovers of the same family, the two
 *    best-named rows open a new group.
 * Mutates `groups`.
 */
function absorbLeftovers(
  groups: Candidate[],
  supplier: SLine[],
  own: OLine[],
  matcher: NameMatcher,
  tol: Tolerances,
): void {
  const used = new Set<SLine | OLine>(groups.flatMap((g) => [...g.s, ...g.t]));
  const nameScore = (x: SLine | OLine, others: (SLine | OLine)[]) => {
    const scores = others.map((o) => matcher.compare(x.name, o.name));
    if (scores.length === 0 || !scores.every((c) => c.sameFamily)) return -1;
    return Math.max(...scores.map((c) => c.score));
  };
  const datesOk = (x: SLine | OLine, others: (SLine | OLine)[]) =>
    others.every((o) => withinDays(x.line.date, o.line.date, tol.dateWindowDays));
  const kg = (rows: (SLine | OLine)[]) => sumOf(rows, (r) => r.line.quantity);

  let changed = true;
  while (changed) {
    changed = false;
    const leftovers = [
      ...supplier.filter((x) => !used.has(x)).map((x) => ({ row: x as SLine | OLine, side: "s" as const })),
      ...own.filter((x) => !used.has(x)).map((x) => ({ row: x as SLine | OLine, side: "t" as const })),
    ].sort((a, b) => b.row.line.quantity - a.row.line.quantity);

    for (const { row, side } of leftovers) {
      // 1. Join an existing group.
      let best: { group: Candidate; name: number; gain: number } | null = null;
      for (const group of groups) {
        const other = side === "s" ? group.t : group.s;
        const own = side === "s" ? group.s : group.t;
        const name = Math.max(nameScore(row, other), nameScore(row, own) >= 0 ? 0 : -1);
        if (name < 0 || !datesOk(row, other)) continue;
        const before = Math.abs(kg(group.s) - kg(group.t));
        const sKg = kg(group.s) + (side === "s" ? row.line.quantity : 0);
        const tKg = kg(group.t) + (side === "t" ? row.line.quantity : 0);
        const gain = before - Math.abs(sKg - tKg);
        if (gain <= 0) continue;
        if (!best || name > best.name + 1e-9 || (Math.abs(name - best.name) <= 1e-9 && gain > best.gain)) {
          best = { group, name, gain };
        }
      }
      if (best) {
        if (side === "s") best.group.s.push(row as SLine);
        else best.group.t.push(row as OLine);
        best.group.score = scoreGroup(best.group.s, best.group.t, matcher, tol);
        used.add(row);
        changed = true;
        break;
      }

      // 2. Open a group with the best-named leftover on the other side.
      const pool = (side === "s" ? own : supplier).filter((x) => !used.has(x) && datesOk(row, [x]));
      const partner = pool
        .map((x) => ({ x, name: nameScore(row, [x]) }))
        .filter((c) => c.name >= 0)
        .sort((a, b) => b.name - a.name)[0];
      if (partner) {
        const sRows = [side === "s" ? row : partner.x] as SLine[];
        const tRows = [side === "t" ? row : partner.x] as OLine[];
        groups.push({ s: sRows, t: tRows, score: scoreGroup(sRows, tRows, matcher, tol) });
        used.add(row);
        used.add(partner.x);
        changed = true;
        break;
      }
    }
  }
}

/** Weight and price both within the rejection threshold. */
function numbersAgree(s: SLine, t: OLine, tol: Tolerances): boolean {
  return (
    relDiff(s.line.quantity, t.line.quantity) <= tol.rejectRelativeDiff &&
    relDiff(s.line.unitPrice, t.line.unitPrice) <= tol.rejectRelativeDiff
  );
}

/** Same item even with big gaps — unless weight AND price are both beyond the threshold. */
function rejectPair(s: SLine, t: OLine, tol: Tolerances): boolean {
  return (
    relDiff(s.line.quantity, t.line.quantity) > tol.rejectRelativeDiff &&
    relDiff(s.line.unitPrice, t.line.unitPrice) > tol.rejectRelativeDiff
  );
}

/** Multi-row groups need matching weight sums, plus equal packages or equal prices. */
function sumsAgree(s: SLine[], t: OLine[], tol: Tolerances): boolean {
  if (Math.abs(sumOf(s, (x) => x.line.quantity) - sumOf(t, (x) => x.line.quantity)) > tol.sumToleranceKg) {
    return false;
  }
  const sPk = packagesSum(s);
  const tPk = packagesSum(t);
  if (sPk != null && tPk != null && sPk === tPk) return true;
  const prices = new Set([...s.map((x) => x.line.unitPrice), ...t.map((x) => x.line.unitPrice)]);
  return prices.size === 1;
}

function scoreGroup(s: SLine[], t: OLine[], matcher: NameMatcher, tol: Tolerances): number {
  let nameTotal = 0;
  for (const a of s) for (const b of t) nameTotal += matcher.compare(a.name, b.name).score;
  const name = nameTotal / (s.length * t.length);

  const quantity = closeness(relDiff(sumOf(s, (x) => x.line.quantity), sumOf(t, (x) => x.line.quantity)), tol);
  const price = closeness(relDiff(weightedPrice(s), weightedPrice(t)), tol);

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
function selectGroups(s: SLine[], t: OLine[], candidates: Candidate[]): Candidate[] {
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

/** 1 at equality, falling linearly to 0 at the rejection threshold. */
function closeness(rel: number, tol: Tolerances): number {
  return Math.max(0, 1 - rel / tol.rejectRelativeDiff);
}

function sumOf<T>(items: T[], f: (x: T) => number): number {
  return items.reduce((acc, x) => acc + f(x), 0);
}

function packagesSum(items: (SLine | OLine)[]): number | null {
  if (items.some((x) => x.line.packages == null)) return null;
  return sumOf(items, (x) => x.line.packages ?? 0);
}

function weightedPrice(items: (SLine | OLine)[]): number {
  const kg = sumOf(items, (x) => x.line.quantity);
  return kg ? sumOf(items, (x) => x.line.quantity * x.line.unitPrice) / kg : 0;
}
