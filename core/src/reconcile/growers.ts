/**
 * Excel reports cover many growers, and each report spells grower names its
 * own way ("דהאן פרותס" ↔ "פירות דהן ובניו בע"מ", "משק חדד שקוף" ↔ "עדי חדד"),
 * while near-identical names can be different growers ("קושמרו ברק" ≠
 * "קושמרו יוסי"). Growers are paired one-to-one, by the delivery notes they
 * share first and by name second — a name whose words all appear in the
 * other ("ערדום" ↔ "מארק ערדום") counts as a full name match. Every row then
 * carries a party id, and rows of different parties are never matched.
 */

/** Words that say nothing about who the grower is. */
const NOISE = new Set(["משק", "בעמ", "ובניו", "בניו", "פירות", "פרותס", "גידול", "ושיווק", "שיווק"]);

/** Points per delivery note both growers' rows refer to — the strongest evidence. */
const SHARED_REF_POINTS = 3;
/** A pair must score above this (a name alone: more than half its words shared). */
const MIN_SCORE = 0.5;

export type GrowerRow = { grower: string; refs: string[] };

export type GrowerParties = {
  supplierParty: (grower: string) => string;
  ownParty: (grower: string) => string;
  /** Hebrew, one per grower found in only one of the reports. */
  warnings: string[];
};

export function pairGrowers(
  supplier: GrowerRow[],
  own: GrowerRow[],
  aliases: Record<string, string>,
  ownName: string,
): GrowerParties {
  const alias = (name: string) => aliases[name] ?? name;
  const sRefs = refsByGrower(supplier);
  const tRefs = refsByGrower(own);

  const candidates: { s: string; t: string; score: number; exact: boolean }[] = [];
  for (const [s, sr] of sRefs) {
    for (const [t, tr] of tRefs) {
      const exact = normalize(alias(s)).join(" ") === normalize(alias(t)).join(" ") || alias(s) === t || alias(t) === s;
      const shared = [...sr].filter((r) => tr.has(r)).length;
      const name = exact || nameContains(alias(s), alias(t)) ? 1 : nameSimilarity(alias(s), alias(t));
      const score = name + SHARED_REF_POINTS * shared;
      if (exact || score > MIN_SCORE) candidates.push({ s, t, score, exact });
    }
  }
  candidates.sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score);

  const party = new Map<string, string>();
  for (const c of candidates) {
    if (party.has(`s:${c.s}`) || party.has(`t:${c.t}`)) continue;
    party.set(`s:${c.s}`, c.s);
    party.set(`t:${c.t}`, c.s);
  }

  const warnings = [
    ...[...sRefs.keys()].filter((g) => !party.has(`s:${g}`)).map((g) => `המגדל "${g}" מופיע רק בדוח הספק`),
    ...[...tRefs.keys()].filter((g) => !party.has(`t:${g}`)).map((g) => `המגדל "${g}" מופיע רק בדוח של ${ownName}`),
  ];
  return {
    supplierParty: (g) => party.get(`s:${g}`) ?? `supplier-only:${g}`,
    ownParty: (g) => party.get(`t:${g}`) ?? `own-only:${g}`,
    warnings,
  };
}

function refsByGrower(rows: GrowerRow[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    const refs = out.get(row.grower) ?? new Set<string>();
    row.refs.forEach((r) => refs.add(r));
    out.set(row.grower, refs);
  }
  return out;
}

/** Name words without quote marks and noise words. */
export function normalize(name: string): string[] {
  return name
    .replace(/["'׳״`]/g, "")
    .split(/[\s\-–,.]+/)
    .filter((w) => w && !NOISE.has(w));
}

/** A word without its vowel letters (א, ו, י) and with final letters unified: "דהאן" and "דהן" agree. */
function skeleton(word: string): string {
  return word
    .replace(/[אוי]/g, "")
    .replace(/ך/g, "כ")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ");
}

/** The name's words, compared without vowel letters and noise words. */
function words(name: string): Set<string> {
  return new Set(normalize(name).map(skeleton).filter(Boolean));
}

/** Share of the longer name's words that the other name also has (0..1). */
export function nameSimilarity(a: string, b: string): number {
  const sa = words(a);
  const sb = words(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  const shared = [...sa].filter((w) => sb.has(w)).length;
  return shared / Math.max(sa.size, sb.size);
}

/** Every word of one name is also in the other (whole words): "ערדום" ⊂ "מארק ערדום", but "לוי" ⊄ "לויתן". */
export function nameContains(a: string, b: string): boolean {
  const [small, large] = [words(a), words(b)].sort((x, y) => x.size - y.size);
  return small.size > 0 && [...small].every((w) => large.has(w));
}
