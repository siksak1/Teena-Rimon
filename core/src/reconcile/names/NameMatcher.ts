import { hasHebrew } from "../../pdf/text.js";
import { DEFAULT_DICTIONARY, type NameDictionary } from "./dictionary.js";

export type ParsedName = {
  family: string | null;
  /**
   * "dictionary" when the family is a known product; "stem" when it was
   * guessed from the first unknown word (so new products still compare).
   */
  familySource: "dictionary" | "stem" | null;
  color: string | null;
  cultivar: string | null;
  size: string | null;
  grade: string | null;
  /** Tokens the dictionary does not know. */
  unknown: string[];
};

export type NameComparison = {
  /** 0..1; 0 for a known-family conflict, neutral when the names cannot be related. */
  score: number;
  sameFamily: boolean;
  /** False only when both families are known products and they differ. */
  compatible: boolean;
  /** Hebrew descriptions of conflicting attributes, e.g. "זן: שלי ≠ מאיה". */
  conflicts: string[];
};

type Attribute = "color" | "cultivar" | "size" | "grade";

const FAMILY_WEIGHT = 0.5;
/** Score when the names cannot be related either way (a new product, a typo…). */
const UNRELATED_SCORE = 0.25;
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
 * attributes are compared. A product missing from the dictionary falls back
 * to the stem of its first word ("עגבניות" / "עגבניה" → "עגבנ"), so names stay
 * a soft signal: only two different known families rule a match out.
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
          p.cultivar = c.as ?? phrase;
          p.family ??= c.family;
          p.familySource = "dictionary";
          if (c.color) p.color ??= c.color;
        },
      })),
      ...Object.entries(d.familyAliases).map(([phrase, family]) => ({
        phrase,
        apply: (p: ParsedName) => setFamily(p, family),
      })),
      ...d.families.map((family) => ({
        phrase: family,
        apply: (p: ParsedName) => setFamily(p, family),
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
      familySource: null,
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
          setFamily(parsed, hits[0]);
          parsed.unknown = parsed.unknown.filter((t) => t !== token);
          break;
        }
      }
    }

    // Not in the dictionary: use the stem of the first Hebrew word.
    if (!parsed.family) {
      const token = parsed.unknown.find((t) => hasHebrew(t));
      if (token) {
        parsed.family = stem(token);
        parsed.familySource = "stem";
        parsed.unknown = parsed.unknown.filter((t) => t !== token);
      }
    }
    return parsed;
  }

  compare(a: ParsedName, b: ParsedName): NameComparison {
    if (!a.family || a.family !== b.family) {
      const conflict = a.familySource === "dictionary" && b.familySource === "dictionary";
      return conflict
        ? { score: 0, sameFamily: false, compatible: false, conflicts: [] }
        : { score: UNRELATED_SCORE, sameFamily: false, compatible: true, conflicts: [] };
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
    return { score: Math.round(score * 1000) / 1000, sameFamily: true, compatible: true, conflicts };
  }
}

function setFamily(p: ParsedName, family: string): void {
  p.family = family;
  p.familySource = "dictionary";
}

/**
 * Crude Hebrew stem: drop quotes, then the plural ("ות"/"ים") and the
 * feminine / adjective endings ("ה", "י") — "עגבניות", "עגבניה" → "עגבנ".
 */
function stem(word: string): string {
  const s = word.replace(/['"׳״]/g, "").replace(/(ות|ים)$/, "").replace(/ה$/, "").replace(/י$/, "");
  return s.length >= 2 ? s : word;
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
