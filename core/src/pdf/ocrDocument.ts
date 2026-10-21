import type { GrayImage, OcrEngine, OcrLine } from "../ocr/types.js";
import { documentFromItems, type PdfDocument, type TextItem } from "./layout.js";
import { clean, eraseRules, visualRows, type VerticalRule } from "./repair.js";
import { hasHebrew } from "./text.js";

/** A4 in points: a scan covers the whole page, so its width gives the scale. */
const A4_SHORT = 595.28;
const A4_LONG = 841.89;
/** What the `eng` pass may read: amounts, dates, percentages. */
const NUMBERS = "0123456789.,/-%:";
/** Words without Hebrew are kept only above this confidence (they are usually rule debris). */
const MIN_PLAIN_CONFIDENCE = 0.5;
/** An `eng` word this sure of itself is added even where the `heb` pass saw nothing. */
const MIN_EXTRA_CONFIDENCE = 0.75;
/** Two boxes are the same word when they overlap by at least this share of the smaller. */
const SAME_WORD = 0.5;

/**
 * Turn the pages of a scan from a supplier we have no reader for into a
 * document, so the generic parsers can try it like any digital PDF. Each page
 * is read word by word twice: `heb` for names and labels, `eng` (digits only)
 * for amounts and dates. A word with no Hebrew letters takes the `eng`
 * reading. Words become text items at their place on the page (in points), so
 * the usual row and cell grouping applies. Misread digits make the parsers'
 * arithmetic and printed-total checks fail, so they refuse rather than guess.
 */
export async function ocrDocument(
  pages: GrayImage[],
  ocr: OcrEngine,
  onPage?: (done: number, total: number) => void,
): Promise<PdfDocument> {
  const items: TextItem[][] = [];
  for (const [index, page] of pages.entries()) {
    onPage?.(index, pages.length);
    const ptPerPx = (page.width > page.height ? A4_LONG : A4_SHORT) / page.width;
    const heightPt = page.height * ptPerPx;
    const image = copy(page);
    const rules = eraseRules(image, 1 / ptPerPx);

    // The browser's engine takes ownership of the pixels it is given: one copy per call.
    const hebrew = await ocr.readLines(copy(image), { model: "heb", unit: "word" });
    const digits = await ocr.readLines(copy(image), { model: "eng", whitelist: NUMBERS, unit: "word" });
    const split = (words: OcrLine[]) =>
      words.map((w) => ({ ...w, text: clean(w.text) })).flatMap((w) => splitAtRules(w, rules));
    const words = mergeReadings(split(hebrew), split(digits));

    const pageItems: TextItem[] = [];
    for (const row of visualRows(words)) {
      const bottoms = row.map((w) => w.bottom).sort((a, b) => a - b);
      const y = heightPt - bottoms[bottoms.length >> 1] * ptPerPx;
      const size = Math.max(...row.map((w) => w.bottom - w.top)) * ptPerPx;
      for (const word of row) {
        pageItems.push({
          page: index + 1,
          x: word.left * ptPerPx,
          width: (word.right - word.left) * ptPerPx,
          y,
          str: word.text,
          size,
          ...("alt" in word && word.alt ? { alt: word.alt as string } : {}),
        });
      }
    }
    items.push(pageItems);
  }
  onPage?.(pages.length, pages.length);
  return documentFromItems(items);
}

/** Hebrew words from the `heb` pass; numbers from the `eng` pass where it read the same box. */
export function mergeReadings(hebrew: OcrLine[], digits: OcrLine[]): (OcrLine & { alt?: string })[] {
  const numbers = digits.filter((w) => /\d/.test(w.text));
  const used = new Set<OcrLine>();
  const out: (OcrLine & { alt?: string })[] = [];
  for (const word of hebrew) {
    if (!word.text) continue;
    if (hasHebrew(word.text)) {
      out.push(word);
      continue;
    }
    const twin = numbers.find((n) => !used.has(n) && overlap(n, word) >= SAME_WORD);
    if (twin) {
      used.add(twin);
      const alt = /\d/.test(word.text) && word.text !== twin.text ? word.text : undefined;
      out.push({ ...word, text: twin.text, confidence: Math.max(word.confidence, twin.confidence), alt });
    } else if (word.confidence >= MIN_PLAIN_CONFIDENCE) {
      out.push(word);
    }
  }
  for (const n of numbers) {
    if (used.has(n) || n.confidence < MIN_EXTRA_CONFIDENCE) continue;
    if (out.some((w) => overlap(n, w) >= SAME_WORD)) continue;
    out.push(n);
  }
  return out;
}

/** A rule this far (px) inside a word's box splits it. */
const SPLIT_MARGIN = 3;

/**
 * A word OCR read across an erased column border ("5.00630.00": a price and a
 * weight side by side) is split where the rule ran, in proportion to its
 * characters. Only splits that leave two amounts are kept.
 */
export function splitAtRules(word: OcrLine, rules: VerticalRule[]): OcrLine[] {
  if (hasHebrew(word.text) || word.text.length < 4) return [word];
  const cuts = [
    ...new Set(
      rules
        .filter((r) => r.top <= word.bottom && r.bottom >= word.top)
        .filter((r) => r.x > word.left + SPLIT_MARGIN && r.x < word.right - SPLIT_MARGIN)
        .map((r) => r.x),
    ),
  ].sort((a, b) => a - b);
  if (cuts.length === 0) return [word];
  // Neighbouring pixel columns of one rule are one cut.
  const merged = cuts.filter((x, i) => i === 0 || x - cuts[i - 1] > SPLIT_MARGIN);
  const width = word.right - word.left;
  const parts: OcrLine[] = [];
  let from = 0;
  let left = word.left;
  for (const x of merged) {
    const guess = Math.round(((x - word.left) / width) * word.text.length);
    const to = bestCut(word.text, from, guess);
    if (to == null) return [word];
    parts.push({ ...word, left, right: x, text: word.text.slice(from, to) });
    from = to;
    left = x;
  }
  const last = word.text.slice(from);
  if (!AMOUNT_TEXT.test(last)) return [word];
  parts.push({ ...word, left, right: word.right, text: last });
  return parts;
}

/** One amount as OCR reads it: "1,440.00", "5.000", "60", "12.00%". */
const AMOUNT_TEXT = /^-?\d[\d,]*(?:\.\d{1,3})?%?$/;
/** How far (characters) a cut may move from where the rule fell. */
const CUT_REACH = 3;

/**
 * Where to cut `text` near `guess` so the piece before is an amount and the
 * rest still starts with a digit. Cuts after a decimal part of two or three
 * digits ("7.30|180.00") are preferred; the nearest to the rule wins.
 */
function bestCut(text: string, from: number, guess: number): number | null {
  let best: { at: number; score: number } | null = null;
  for (let at = Math.max(from + 1, guess - CUT_REACH); at <= Math.min(text.length - 1, guess + CUT_REACH); at++) {
    const piece = text.slice(from, at);
    if (!AMOUNT_TEXT.test(piece) || !/^\d/.test(text.slice(at))) continue;
    const score = Math.abs(at - guess) - (/\.\d{2,3}$/.test(piece) ? 10 : 0);
    if (!best || score < best.score) best = { at, score };
  }
  return best?.at ?? null;
}

/** Shared area over the smaller box's area. */
function overlap(a: OcrLine, b: OcrLine): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  const area = (box: OcrLine) => (box.right - box.left) * (box.bottom - box.top);
  return (w * h) / Math.min(area(a), area(b));
}

function copy(image: GrayImage): GrayImage {
  return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
}
