import { readSheet } from "read-excel-file/universal";

export type Cell = string | number | boolean | Date | null;

/** The rows of the first sheet, or null when the bytes are not an .xlsx workbook. */
export async function readFirstSheet(bytes: Uint8Array): Promise<Cell[][] | null> {
  // read-excel-file wants an ArrayBuffer of exactly the file.
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  try {
    return (await readSheet(buffer)) as Cell[][];
  } catch {
    return null;
  }
}

/** Header text compared loosely: Hebrew/ASCII quote marks unified, spaces collapsed. */
export function normalizeHeader(value: Cell): string {
  return String(value ?? "")
    .replace(/[׳`’]/g, "'")
    .replace(/[״“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** Index of the first row (among the first ten) that has every one of `headers`. */
export function findHeaderRow(rows: Cell[][], headers: string[]): number {
  const wanted = headers.map(normalizeHeader);
  return rows.slice(0, 10).findIndex((row) => {
    const cells = new Set(row.map(normalizeHeader));
    return wanted.every((h) => cells.has(h));
  });
}

export function text(value: Cell): string {
  if (value == null) return "";
  if (value instanceof Date) return isoDate(value) ?? "";
  return String(value).replace(/\s+/g, " ").trim();
}

/** A number cell, or a numeric string ("1,234.5"); null when empty or not a number. */
export function number(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[,\s₪]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** A document reference as text: 909805 → "909805" (never "909805.0"). */
export function reference(value: Cell): string {
  if (typeof value === "number") return String(value);
  return text(value);
}

/** Excel's day 0 is 1899-12-30 (the 1900 leap-year bug included). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

/**
 * ISO `YYYY-MM-DD` from a date cell (read as UTC midnight), an Excel serial
 * number, or "dd/mm/yyyy" / "dd.mm.yy" text.
 */
export function isoDate(value: Cell): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 0 && value < 100000) {
    return new Date(EXCEL_EPOCH_MS + Math.round(value) * 86400000).toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
    if (m) {
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return `${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(value.trim())) return value.trim().slice(0, 10);
  }
  return null;
}
