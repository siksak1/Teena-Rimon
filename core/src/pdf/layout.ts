import { getDocumentProxy } from "unpdf";
import { collapseWhitespace, fixMirroring, parseNumber } from "./text.js";

export type TextItem = {
  page: number;
  /** Left edge in PDF points. */
  x: number;
  /** Baseline in PDF points (grows upwards). */
  y: number;
  width: number;
  str: string;
};

/** Contiguous run of items inside one visual row (a table cell). */
export type Cell = {
  text: string;
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
};

/** Items whose baselines differ by less than this are on the same row. */
const ROW_TOLERANCE = 1.6;
/** Gap (points) between items that still belong to the same word / cell. */
const WORD_GAP = 1.2;
const CELL_GAP = 4.5;

export async function loadPdf(data: Uint8Array): Promise<PdfDocument> {
  // pdf.js may detach the buffer it is given — hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const pages: Row[][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of content.items) {
      if (!("str" in raw) || !raw.str.trim()) continue;
      items.push({
        page: p,
        x: raw.transform[4],
        y: raw.transform[5],
        width: raw.width,
        str: fixMirroring(raw.str),
      });
    }
    pages.push(toRows(items));
  }
  await pdf.cleanup();
  const rows = pages.flat();
  return { pages, rows, text: rows.map((r) => r.text).join("\n") };
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
  let current: { parts: string[]; xMin: number; xMax: number } | null = null;
  for (const item of rtl) {
    const right = item.x + item.width;
    const gap = current ? current.xMin - right : Infinity;
    if (current && gap <= CELL_GAP) {
      current.parts.push(gap > WORD_GAP ? " " : "", item.str);
      current.xMin = Math.min(current.xMin, item.x);
    } else {
      if (current) cells.push(finishCell(current));
      current = { parts: [item.str], xMin: item.x, xMax: right };
    }
  }
  if (current) cells.push(finishCell(current));
  return cells;
}

function finishCell(c: { parts: string[]; xMin: number; xMax: number }): Cell {
  return {
    text: collapseWhitespace(c.parts.join("")),
    xMin: c.xMin,
    xMax: c.xMax,
    x: (c.xMin + c.xMax) / 2,
  };
}

export type ColumnSpec<K extends string> = { key: K; header: RegExp };
export type Columns<K extends string> = Record<K, number>;

/**
 * Locate column centres from a header row. Returns null when any of the
 * requested headers is missing (i.e. this is not the header row).
 */
export function columnsFromHeader<K extends string>(
  row: Row,
  specs: ColumnSpec<K>[],
): Columns<K> | null {
  const columns = {} as Columns<K>;
  for (const spec of specs) {
    const cell = row.cells.find((c) => spec.header.test(c.text));
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
