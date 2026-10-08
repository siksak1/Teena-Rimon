/** Small text helpers shared by the PDF layout code and the parsers. */

const HEBREW = /[֐-׿]/;

export function hasHebrew(value: string): boolean {
  return HEBREW.test(value);
}

/**
 * pdf.js returns Hebrew strings in logical order but keeps the glyphs of
 * mirrored characters, so "ונוס (אדום)" arrives as "ונוס )אדום(".
 */
export function fixMirroring(value: string): string {
  if (!hasHebrew(value)) return value;
  return value.replace(/[()]/g, (c) => (c === "(" ? ")" : "("));
}

/** "2,398.88" / "94.00 ק'ג" / "29.00 ש\"ח" → number. */
export function parseNumber(value: string | undefined | null): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/** "12.00%" → 0.12; empty → 0. */
export function parsePercent(value: string | undefined | null): number {
  const n = parseNumber(value);
  return n == null ? 0 : n / 100;
}

/** "01/09/26" or "10/09/2026" → "2026-09-01". */
export function parseDate(value: string | undefined | null): string | null {
  const match = value?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/);
  if (!match) return null;
  const [, d, m, y] = match;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
