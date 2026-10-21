import { openPdf } from "./pdfjs.js";
import { collapseWhitespace, fixMirroring, hasHebrew, parseNumber } from "./text.js";

export type TextItem = {
  page: number;
  /** Left edge in PDF points. */
  x: number;
  /** Baseline in PDF points (grows upwards). */
  y: number;
  width: number;
  str: string;
  /** Font size in points (the text matrix's vertical scale). */
  size: number;
  /** Read by OCR: what a second reading of the same word said, when it differed. */
  alt?: string;
};

/** Contiguous run of items inside one visual row (a table cell). */
export type Cell = {
  text: string;
  /**
   * Other readings of a one-word cell read by OCR, e.g. "4.50" for "450".
   * Parsers that check arithmetic may try them; the printed totals decide.
   */
  alternatives?: string[];
  xMin: number;
  xMax: number;
  /** Horizontal centre — used to assign the cell to a column. */
  x: number;
};

export type Row = {
  page: number;
  y: number;
  cells: Cell[];
  /** All cells joined right-to-left, the way a Hebrew reader sees the row. */
  text: string;
};

export type PdfDocument = {
  pages: Row[][];
  /** Every row of every page, top to bottom. */
  rows: Row[];
  /** Plain text of the whole document, for supplier detection. */
  text: string;
  /**
   * Set when the PDF draws Hebrew in glyphs that have no Unicode mapping
   * (e.g. "Microsoft Print to PDF"): the letters extract as blanks and only
   * digits survive. `repairMissingText` reads them back by OCR.
   */
  missingText?: MissingText;
  /** Some of the text was read by OCR (see `missingText`). */
  repairedByOcr?: boolean;
};

/** Per page: the items that extracted, and where the unmapped runs start. */
export type MissingText = { items: TextItem[][]; blanks: TextItem[][] };

/** Fewer Hebrew letters than this, with at least as many blank runs, means the Hebrew is missing. */
const MISSING_TEXT_MIN = 10;

/** Items whose baselines differ by less than this are on the same row. */
const ROW_TOLERANCE = 1.6;
/** Gap (points) between items that still belong to the same word / cell. */
const WORD_GAP = 1.2;
const CELL_GAP = 4.5;

export async function loadPdf(data: Uint8Array): Promise<PdfDocument> {
  const { pdf, close } = await openPdf(data);
  const pages: Row[][] = [];
  const allItems: TextItem[][] = [];
  const blanks: TextItem[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    const pageBlanks: TextItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const item = {
        page: p,
        x: raw.transform[4],
        y: raw.transform[5],
        width: raw.width,
        str: fixMirroring(raw.str),
        size: Math.hypot(raw.transform[2], raw.transform[3]),
      };
      // A blank with a width is a run of glyphs that map to no character.
      if (raw.str.trim()) items.push(item);
      else if (raw.str && raw.width > 0) pageBlanks.push(item);
    }
    allItems.push(items);
    blanks.push(pageBlanks);
    pages.push(toRows(items));
  }
  await close();
  return documentFromPages(pages, allItems, blanks);
}

function documentFromPages(pages: Row[][], items: TextItem[][], blanks: TextItem[][]): PdfDocument {
  const rows = pages.flat();
  const text = rows.map((r) => r.text).join("\n");
  const doc: PdfDocument = { pages, rows, text };
  const hebrew = [...text].filter(hasHebrew).length;
  const blankCount = blanks.reduce((n, b) => n + b.length, 0);
  if (hebrew < MISSING_TEXT_MIN && blankCount >= MISSING_TEXT_MIN) doc.missingText = { items, blanks };
  return doc;
}

/** Rebuild a document from its items once the missing text has been added back. */
export function documentFromItems(items: TextItem[][]): PdfDocument {
  const pages = items.map((pageItems) => toRows(pageItems));
  const rows = pages.flat();
  return { pages, rows, text: rows.map((r) => r.text).join("\n"), repairedByOcr: true };
}

/** Group items into visual rows (top to bottom) and each row into cells. */
export function toRows(items: TextItem[]): Row[] {
  const sorted = [...items].sort((a, b) => b.y - a.y);
  const buckets: TextItem[][] = [];
  for (const item of sorted) {
    const bucket = buckets.at(-1);
    if (bucket && Math.abs(bucket[0].y - item.y) <= ROW_TOLERANCE) bucket.push(item);
    else buckets.push([item]);
  }
  return buckets.map((bucket) => {
    const cells = toCells(bucket);
    return {
      page: bucket[0].page,
      y: bucket[0].y,
      cells,
      text: cells.map((c) => c.text).join("  "),
    };
  });
}

/** Right-to-left: merge neighbouring items, splitting where the gap is wide. */
function toCells(items: TextItem[]): Cell[] {
  const rtl = [...items].sort((a, b) => b.x + b.width - (a.x + a.width));
  const cells: Cell[] = [];
  let current: { parts: string[]; xMin: number; xMax: number; alt?: string } | null = null;
  for (const item of rtl) {
    const right = item.x + item.width;
    const gap = current ? current.xMin - right : Infinity;
    if (current && gap <= CELL_GAP) {
      current.parts.push(gap > WORD_GAP ? " " : "", item.str);
      current.xMin = Math.min(current.xMin, item.x);
      current.alt = undefined;
    } else {
      if (current) cells.push(finishCell(current));
      current = { parts: [item.str], xMin: item.x, xMax: right, alt: item.alt };
    }
  }
  if (current) cells.push(finishCell(current));
  return cells;
}

function finishCell(c: { parts: string[]; xMin: number; xMax: number; alt?: string }): Cell {
  const cell: Cell = {
    text: collapseWhitespace(c.parts.join("")),
    xMin: c.xMin,
    xMax: c.xMax,
    x: (c.xMin + c.xMax) / 2,
  };
  if (c.alt) cell.alternatives = [c.alt];
  return cell;
}

/** `label` is the header as printed, for fuzzy matching of OCR-read headers. */
export type ColumnSpec<K extends string> = { key: K; header: RegExp; label?: string };
export type Columns<K extends string> = Record<K, number>;

/**
 * Locate column centres from a header row. Returns null when any of the
 * requested headers is missing (i.e. this is not the header row).
 */
export function columnsFromHeader<K extends string>(
  row: Row,
  specs: ColumnSpec<K>[],
  options: { fuzzy?: boolean } = {},
): Columns<K> | null {
  const columns = {} as Columns<K>;
  for (const spec of specs) {
    const cell =
      row.cells.find((c) => spec.header.test(c.text)) ??
      (options.fuzzy && spec.label ? row.cells.find((c) => fuzzyEquals(c.text, spec.label!)) : undefined);
    if (!cell) return null;
    columns[spec.key] = cell.x;
  }
  return columns;
}

/**
 * Assign each cell of a data row to the nearest column. Several cells can
 * land in the same column; they are kept right-to-left.
 */
export function readRow<K extends string>(
  row: Row,
  columns: Columns<K>,
): Record<K, Cell[]> {
  const keys = Object.keys(columns) as K[];
  const out = Object.fromEntries(keys.map((k) => [k, [] as Cell[]])) as Record<K, Cell[]>;
  for (const cell of row.cells) {
    let best = keys[0];
    for (const key of keys) {
      if (Math.abs(columns[key] - cell.x) < Math.abs(columns[best] - cell.x)) best = key;
    }
    out[best].push(cell);
  }
  return out;
}

export function cellText(cells: Cell[]): string {
  return cells.map((c) => c.text).join(" ");
}

/** Stacked header lines (e.g. "מחיר" over "ליחידה") are at most this far apart. */
const HEADER_STACK_GAP = 15;

/**
 * Like `columnsFromHeader`, for a header printed over two or three stacked
 * rows: cells that sit one above the other are joined top-to-bottom
 * ("סה"כ" + "מחיר" → "סה"כ מחיר") before the specs are matched.
 */
export function columnsFromHeaderRows<K extends string>(
  rows: Row[],
  index: number,
  specs: ColumnSpec<K>[],
): Columns<K> | null {
  const first = rows[index];
  const stack = [first];
  for (const next of rows.slice(index + 1, index + 3)) {
    const prev = stack.at(-1)!;
    if (next.page !== prev.page || prev.y - next.y > HEADER_STACK_GAP) break;
    stack.push(next);
  }
  const merged: Cell[] = [];
  for (const row of stack) {
    for (const cell of row.cells) {
      const above = merged.find((m) => cell.xMin <= m.xMax && cell.xMax >= m.xMin);
      if (above) {
        above.text = `${above.text} ${cell.text}`;
        above.xMin = Math.min(above.xMin, cell.xMin);
        above.xMax = Math.max(above.xMax, cell.xMax);
        above.x = (above.xMin + above.xMax) / 2;
      } else {
        merged.push({ ...cell });
      }
    }
  }
  return columnsFromHeader({ ...first, cells: merged, text: merged.map((c) => c.text).join("  ") }, specs);
}

/** A wrapped cell line sits this close above or below its data row. */
const WRAP_GAP = 8;

/**
 * Text of a cell that wraps onto lines printed just above and below its data
 * row (e.g. "אבוקדו גליל שוק" / row / "מוסדי"). Only single-cell rows near
 * `columnX` count; the in-row text goes in the middle.
 */
export function wrappedText(rows: Row[], dataRow: Row, columnX: number, inRow: string): string {
  const near = (r: Row) =>
    r !== dataRow &&
    r.page === dataRow.page &&
    Math.abs(r.y - dataRow.y) <= WRAP_GAP &&
    r.cells.length === 1 &&
    Math.abs(r.cells[0].x - columnX) <= 30;
  const above = rows.filter((r) => near(r) && r.y > dataRow.y).map((r) => r.cells[0].text);
  const below = rows.filter((r) => near(r) && r.y < dataRow.y).map((r) => r.cells[0].text);
  return [...above, inRow, ...below].filter(Boolean).join(" ");
}

/**
 * Leftmost money amount on the first row whose text includes `label`, e.g.
 * "מחיר כולל  13,433.66" or "סה"כ ש"ח  : 70628.50". Percentages are ignored.
 */
export function amountOnRow(doc: PdfDocument, label: string): number | null {
  const row = doc.rows.find((r) => r.text.includes(label));
  const amounts = row?.cells.filter((c) => /\d\.\d{2}\b/.test(c.text) && !c.text.includes("%")) ?? [];
  if (amounts.length === 0) return null;
  return parseNumber(amounts.reduce((a, b) => (a.x < b.x ? a : b)).text);
}

/* ------------------------------------------------------------------ */
/* Fuzzy matching, for text read back by OCR                           */
/* ------------------------------------------------------------------ */

/** Letters and digits only: OCR often drops or adds quotes, slashes and spaces. */
function letters(value: string): string {
  return value.replace(/[^\p{L}\p{N}]/gu, "");
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/** Equal up to punctuation and about one misread letter in six. */
export function fuzzyEquals(text: string, label: string): boolean {
  const a = letters(text);
  const b = letters(label);
  if (!a || !b) return false;
  return editDistance(a, b) <= Math.max(1, Math.floor(b.length / 6));
}

/** Like `text.includes(label)`, tolerant of OCR misreads: some run of cells matches `label`. */
export function fuzzyIncludes(row: Row, label: string): boolean {
  if (row.text.includes(label)) return true;
  const { cells } = row;
  for (let i = 0; i < cells.length; i++) {
    let joined = "";
    for (let j = i; j < cells.length && j < i + 3; j++) {
      joined = joined ? `${joined} ${cells[j].text}` : cells[j].text;
      if (fuzzyEquals(joined, label)) return true;
    }
    // A label can also be the start of a longer cell ("עבור תקופה 28/09/2026…").
    const words = cells[i].text.split(" ");
    for (let n = 1; n < words.length; n++) if (fuzzyEquals(words.slice(0, n).join(" "), label)) return true;
  }
  return false;
}
