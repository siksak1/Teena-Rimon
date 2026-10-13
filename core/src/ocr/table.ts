import { columnBox, crop, type Grid, pageY } from "../pdf/scan.js";
import type { GrayImage, OcrEngine, OcrLine, OcrModel } from "./types.js";

/** How to read one column of a ruled table. */
export type ColumnRead = { model: OcrModel; whitelist?: string } | null;

export const DIGITS = "0123456789";
export const AMOUNT = "0123456789.,";
export const DATE = "0123456789/";

export type Cell = { text: string; confidence: number };

/**
 * Read a ruled table's data rows, one OCR pass per column (left to right as
 * in `grid.columns`; `null` skips a column). Each recognised line goes to the
 * row band it overlaps most. A cell the column pass left empty is read again
 * on its own: Tesseract sometimes skips a sparse strip, never a lone cell.
 */
export async function readTable(
  page: GrayImage,
  grid: Grid,
  reads: ColumnRead[],
  ocr: OcrEngine,
): Promise<Cell[][]> {
  const cells: Cell[][] = grid.rows.map(() => reads.map(() => ({ text: "", confidence: 0 })));
  const top = grid.rows[0].top;
  const bottom = grid.rows.at(-1)!.bottom;

  for (const [c, read] of reads.entries()) {
    if (!read) continue;
    const box = columnBox(grid.columns[c], top, bottom);
    const lines = await ocr.readLines(crop(page, box, grid.rules), read);
    const byRow = new Map<number, OcrLine[]>();
    for (const line of lines) {
      if (!clean(line.text)) continue;
      const row = rowOf(grid, pageY(line.top, box), pageY(line.bottom, box));
      if (row >= 0) byRow.set(row, [...(byRow.get(row) ?? []), line]);
    }
    for (const [row, found] of byRow) cells[row][c] = join(found, read.model);

    for (const [row, band] of grid.rows.entries()) {
      if (cells[row][c].text) continue;
      const one = await ocr.readLines(crop(page, columnBox(grid.columns[c], band.top, band.bottom)), read);
      cells[row][c] = join(one.filter((l) => clean(l.text)), read.model);
    }
  }
  return cells;
}

/** The row band a line overlaps most, or -1. */
function rowOf(grid: Grid, top: number, bottom: number): number {
  let best = -1;
  let bestOverlap = 0;
  for (const [i, band] of grid.rows.entries()) {
    const overlap = Math.min(bottom, band.bottom) - Math.max(top, band.top);
    if (overlap > bestOverlap) {
      best = i;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** Lines that landed in one cell, in reading order (right to left for Hebrew). */
function join(lines: OcrLine[], model: OcrModel): Cell {
  if (lines.length === 0) return { text: "", confidence: 0 };
  const ordered = [...lines].sort((a, b) => (model === "heb" ? b.right - a.right : a.left - b.left));
  return {
    text: ordered.map((l) => clean(l.text)).join(" "),
    confidence: Math.min(...ordered.map((l) => l.confidence)),
  };
}

/** Drop what is left of the ruling lines ("|", "_") and stray punctuation at the edges. */
function clean(text: string): string {
  return text
    .replace(/[|_\[\]{}]/g, " ")
    .replace(/^[\s.,:;'"!-]+|[\s.,:;'"!-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
