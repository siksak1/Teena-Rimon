import { DEFAULT_DICTIONARY, type NameDictionary } from "./dictionary.js";

export type ParsedName = {
  family: string | null;
  color: string | null;
  cultivar: string | null;
  size: string | null;
  grade: string | null;
  /** Tokens the dictionary does not know. */
  unknown: string[];
};

export type NameComparison = {
  /** 0..1; 0 whenever the families differ. */
  score: number;
  sameFamily: boolean;
  /** Hebrew descriptions of conflicting attributes, e.g. "זן: שלי ≠ מאיה". */
  conflicts: string[];
};

type Attribute = "color" | "cultivar" | "size" | "grade";

const FAMILY_WEIGHT = 0.5;
const ATTRIBUTE_WEIGHTS: Record<Attribute, number> = {
  color: 0.15,
  cultivar: 0.15,
  size: 0.1,
  grade: 0.1,
};
const ATTRIBUTE_LABELS: Record<Attribute, string> = {
  color: "צבע",
  cultivar: "זן",
  size: "גודל",
  grade: "איכות",
};

/**
 * Matches product names by meaning rather than spelling: each name is parsed
 * into family / colour / cultivar / size / grade with a dictionary, and the
 * attributes are compared. Deliberately simple — swap the implementation
 * (fuzzy matching, AI-suggested aliases, …) without touching the engine.
 */
export class NameMatcher {
  private readonly phrases: { phrase: string; apply: (p: ParsedName) => void }[];
  private readonly families: string[];

  constructor(dictionary: NameDictionary = DEFAULT_DICTIONARY) {
    const d = dictionary;
    this.families = d.families;
    const entries: { phrase: string; apply: (p: ParsedName) => void }[] = [
      ...d.noise.map((phrase) => ({ phrase, apply: () => {} })),
      ...Object.entries(d.grades).map(([phrase, grade]) => ({
        phrase,
        apply: (p: ParsedName) => void (p.grade = grade),
      })),
      ...Object.entries(d.cultivars).map(([phrase, c]) => ({
        phrase,
        apply: (p: ParsedName) => {
          p.cultivar = phrase;
          p.family ??= c.family;
          if (c.color) p.color ??= c.color;
        },
      })),
      ...Object.entries(d.familyAliases).map(([phrase, family]) => ({
        phrase,
        apply: (p: ParsedName) => void (p.family = family),
      })),
      ...d.families.map((family) => ({
        phrase: family,
        apply: (p: ParsedName) => void (p.family = family),
      })),
      ...Object.entries(d.colors).map(([phrase, color]) => ({
        phrase,
        apply: (p: ParsedName) => void (p.color = color),
      })),
      ...Object.entries(d.sizes).map(([phrase, size]) => ({
        phrase,
        apply: (p: ParsedName) => void (p.size = size),
      })),
    ];
    // Longest phrases first so "עץ השדה" wins over "עץ", "ללא מיתוג" over "מיתוג".
    this.phrases = entries.sort((a, b) => wordCount(b.phrase) - wordCount(a.phrase));
  }

  /** Parse a name spread over several columns (description, variety, size…). */
  parse(...columns: (string | null | undefined)[]): ParsedName {
    const parsed: ParsedName = {
      family: null,
      color: null,
      cultivar: null,
      size: null,
      grade: null,
      unknown: [],
    };
    let text = ` ${tokenize(columns.filter(Boolean).join(" "))} `;

    // "גודל 6.5" (Shivuk) ↔ "65" (Teena-Rimon): sizes below 10 are scaled ×10.
    text = text.replace(/ גודל (\d+(?:\.\d+)?) /g, (_m, n: string) => {
      const value = Number(n);
      parsed.size = String(value < 10 ? Math.round(value * 10) : value);
      return " ";
    });

    for (const { phrase, apply } of this.phrases) {
      const needle = ` ${phrase.toLowerCase()} `;
      if (!text.includes(needle)) continue;
      apply(parsed);
      text = text.split(needle).join(" ");
    }

    for (const token of text.split(" ").filter(Boolean)) {
      if (/^\d+(?:\.\d+)?$/.test(token)) parsed.size ??= token;
      else if (token !== "גודל") parsed.unknown.push(token);
    }

    // Abbreviations such as "מ קטמנדו": a short token that starts exactly one family.
    if (!parsed.family) {
      for (const token of parsed.unknown) {
        const hits = this.families.filter((f) => f.startsWith(token));
        if (hits.length === 1) {
          parsed.family = hits[0];
          parsed.unknown = parsed.unknown.filter((t) => t !== token);
          break;
        }
      }
    }
    return parsed;
  }

  compare(a: ParsedName, b: ParsedName): NameComparison {
    if (!a.family || a.family !== b.family) {
      return { score: 0, sameFamily: false, conflicts: [] };
    }
    let score = FAMILY_WEIGHT;
    const conflicts: string[] = [];
    for (const attr of Object.keys(ATTRIBUTE_WEIGHTS) as Attribute[]) {
      const weight = ATTRIBUTE_WEIGHTS[attr];
      const x = a[attr];
      const y = b[attr];
      if (x && y) {
        if (x === y) score += weight;
        else conflicts.push(`${ATTRIBUTE_LABELS[attr]}: ${x} ≠ ${y}`);
      } else {
        // Missing on one side is not a contradiction.
        score += weight / 2;
      }
    }
    return { score: Math.round(score * 1000) / 1000, sameFamily: true, conflicts };
  }
}

/** Lower-case (dictionary phrases are compared lower-cased too), split glued Latin suffixes ("סברסXL"), drop punctuation. */
function tokenize(value: string): string {
  return value
    .replace(/([֐-׿])([A-Za-z])/g, "$1 $2")
    .replace(/[()\-–,/|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function wordCount(value: string): number {
  return value.trim().split(/\s+/).length;
}
