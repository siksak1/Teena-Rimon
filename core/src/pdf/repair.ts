import type { GrayImage, OcrEngine, OcrLine } from "../ocr/types.js";
import { documentFromItems, type PdfDocument, type TextItem } from "./layout.js";
import { renderPages } from "./pdfjs.js";
import { hasHebrew } from "./text.js";

/** Render scale: 4 px per point (288 dpi), enough for 7–8 pt Hebrew. */
const SCALE = 4;
/** Pixels darker than this count as ink. */
const INK = 160;
/** Text box around a baseline, in font sizes. */
const ASCENT = 0.95;
const DESCENT = 0.3;
/** Straight ink runs at least this long (points) are ruling lines, not letters. */
const MIN_HORIZONTAL_RULE = 20;
const MIN_VERTICAL_RULE = 15;
/** An OCR word this close (in font sizes) to an extracted item's baseline is on its row. */
const SNAP = 0.45;
/** Words without Hebrew are kept only above this confidence (they are usually rule debris). */
const MIN_PLAIN_CONFIDENCE = 0.6;

/**
 * Read back the Hebrew of a document whose glyphs have no Unicode mapping
 * (`doc.missingText`, e.g. printed with "Microsoft Print to PDF"). The
 * digits and amounts that did extract are exact and stay as they are. Each
 * page is rendered, everything already extracted and every ruling line is
 * whited out, and what is left is read word by word. Each word becomes a text
 * item at its place on the page, so the usual row and cell grouping applies.
 */
export async function repairMissingText(
  doc: PdfDocument,
  data: Uint8Array,
  ocr: OcrEngine,
  onPage?: (done: number, total: number) => void,
): Promise<PdfDocument> {
  const missing = doc.missingText;
  if (!missing) return doc;
  const pageNumbers = missing.items.map((_, i) => i + 1);
  const rendered = await renderPages(data, pageNumbers, SCALE);

  const items = missing.items.map((pageItems) => [...pageItems]);
  for (const [done, p] of pageNumbers.entries()) {
    onPage?.(done, pageNumbers.length);
    const { image, heightPt } = rendered.get(p)!;
    const known = missing.items[p - 1];
    for (const item of known) eraseItem(image, item, heightPt);
    eraseRules(image, SCALE);

    const words = (await ocr.readLines(image, { model: "heb", unit: "word" }))
      .map((w) => ({ ...w, text: clean(w.text) }))
      .filter((w) => w.text && (hasHebrew(w.text) || w.confidence >= MIN_PLAIN_CONFIDENCE));
    const anchors = [...known, ...missing.blanks[p - 1]];
    for (const row of visualRows(words)) {
      const y = baseline(row, anchors, heightPt);
      const size = Math.max(...row.map((w) => w.bottom - w.top)) / SCALE / ASCENT;
      for (const word of row) {
        items[p - 1].push({
          page: p,
          x: word.left / SCALE,
          width: (word.right - word.left) / SCALE,
          y,
          str: word.text,
          size,
        });
      }
    }
  }
  onPage?.(pageNumbers.length, pageNumbers.length);
  return documentFromItems(items);
}

/** White out an extracted item's box so OCR reads only the missing text. */
function eraseItem(image: GrayImage, item: TextItem, heightPt: number): void {
  const left = Math.floor(item.x * SCALE) - 2;
  const right = Math.ceil((item.x + item.width) * SCALE) + 2;
  const top = Math.floor((heightPt - item.y - ASCENT * item.size) * SCALE);
  const bottom = Math.ceil((heightPt - item.y + DESCENT * item.size) * SCALE);
  fill(image, left, right, top, bottom);
}

function fill(image: GrayImage, left: number, right: number, top: number, bottom: number): void {
  const x0 = Math.max(0, left);
  const x1 = Math.min(image.width - 1, right);
  for (let y = Math.max(0, top); y <= Math.min(image.height - 1, bottom); y++) {
    image.data.fill(255, y * image.width + x0, y * image.width + x1 + 1);
  }
}

/** A vertical ruling line, in pixels: its column and the rows it spans. */
export type VerticalRule = { x: number; top: number; bottom: number };

/**
 * White out long straight runs of ink: table rules and box frames confuse OCR.
 * `scale` is pixels per point. Returns the vertical rules, so words that OCR
 * read across an erased column border can be split there.
 */
export function eraseRules(image: GrayImage, scale: number): VerticalRule[] {
  const { width, height, data } = image;
  const minH = MIN_HORIZONTAL_RULE * scale;
  const minV = MIN_VERTICAL_RULE * scale;
  const ink = (x: number, y: number) => data[y * width + x] < INK;
  const runs: [number, number, number, number][] = [];
  const verticals: VerticalRule[] = [];
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      if (x < width && ink(x, y)) {
        if (start < 0) start = x;
      } else if (start >= 0) {
        if (x - start >= minH) runs.push([start, x - 1, y, y]);
        start = -1;
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let start = -1;
    for (let y = 0; y <= height; y++) {
      if (y < height && ink(x, y)) {
        if (start < 0) start = y;
      } else if (start >= 0) {
        if (y - start >= minV) {
          runs.push([x, x, start, y - 1]);
          verticals.push({ x, top: start, bottom: y - 1 });
        }
        start = -1;
      }
    }
  }
  // Rules are often anti-aliased into a neighbouring pixel row or column.
  for (const [l, r, t, b] of runs) fill(image, l - 1, r + 1, t - 1, b + 1);
  return verticals;
}

/** Words that overlap vertically by at least half the shorter one share a row. */
export function visualRows(words: OcrLine[]): OcrLine[][] {
  const rows: OcrLine[][] = [];
  for (const word of [...words].sort((a, b) => a.top - b.top)) {
    const row = rows.find((r) =>
      r.some((w) => Math.min(w.bottom, word.bottom) - Math.max(w.top, word.top) >= 0.5 * Math.min(w.bottom - w.top, word.bottom - word.top)),
    );
    if (row) row.push(word);
    else rows.push([word]);
  }
  return rows;
}

/**
 * The row's baseline in PDF points: an extracted item's baseline when one is
 * close (so the words join that item's row), else the median word bottom —
 * most Hebrew letters sit on the baseline.
 */
function baseline(row: OcrLine[], anchors: TextItem[], heightPt: number): number {
  const bottoms = row.map((w) => w.bottom).sort((a, b) => a - b);
  const estimate = heightPt - bottoms[bottoms.length >> 1] / SCALE;
  const left = Math.min(...row.map((w) => w.left)) / SCALE;
  const right = Math.max(...row.map((w) => w.right)) / SCALE;
  let best: TextItem | null = null;
  for (const a of anchors) {
    const d = Math.abs(a.y - estimate);
    if (d > SNAP * a.size) continue;
    // Prefer an anchor on the same stretch of the page (two-column footers).
    const near = (x: number) => Math.min(Math.abs(x - left), Math.abs(x - right));
    if (!best || d < Math.abs(best.y - estimate) - 0.3 || (Math.abs(d - Math.abs(best.y - estimate)) <= 0.3 && near(a.x) < near(best.x))) best = a;
  }
  return best ? best.y : estimate;
}

/** Drop stray rule fragments and edge punctuation Tesseract reads from cell borders. */
export function clean(text: string): string {
  return text
    .replace(/[|_\[\]{}]/g, " ")
    .replace(/^[\s.,;'!-]+|[\s.,;'!-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
