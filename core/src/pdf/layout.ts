import { getDocumentProxy } from "unpdf";
import { collapseWhitespace, fixMirroring } from "./text.js";

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
