import { useState } from "react";
import { normalize } from "./filtering";

export type SortDir = "asc" | "desc";

export type ColumnSort = {
  /** The sorted column; null keeps the document's order. */
  column: number | null;
  dir: SortDir;
  /** Each click on a column: ascending, then descending, then back to the document's order. */
  toggle: (column: number) => void;
  /** Back to the document's order. */
  clear: () => void;
};

export function useColumnSort(): ColumnSort {
  const [state, setState] = useState<{ column: number | null; dir: SortDir }>({ column: null, dir: "asc" });
  return {
    ...state,
    toggle: (column) =>
      setState((prev) => {
        if (prev.column !== column) return { column, dir: "asc" };
        return prev.dir === "asc" ? { column, dir: "desc" } : { column: null, dir: "asc" };
      }),
    clear: () => setState({ column: null, dir: "asc" }),
  };
}

const collator = new Intl.Collator("he", { numeric: true, sensitivity: "base" });

/** What a cell sorts by: dates and numbers by value, anything else as text, an empty cell as null. */
function sortKey(cell: string): number | string | null {
  const text = normalize(cell);
  if (text === "" || text === "—") return null;
  const date = /^(\d\d)\/(\d\d)\/(\d\d)$/.exec(text);
  if (date) return Number(date[3] + date[2] + date[1]);
  const plain = text.replace(/[₪%,\s]/g, "").replace("−", "-");
  return /^[-+]?\d+(\.\d+)?$/.test(plain) ? Number(plain) : text;
}

function compareKeys(a: number | string, b: number | string): number {
  if (typeof a === "number") return typeof b === "number" ? a - b : -1;
  return typeof b === "number" ? 1 : collator.compare(a, b);
}

/**
 * The rows ordered by the text shown in the sorted column. Empty cells stay
 * last in both directions, and equal rows keep their order.
 */
export function sortRows<T>(rows: T[], cell: (row: T, column: number) => string, sort: Pick<ColumnSort, "column" | "dir">): T[] {
  const { column, dir } = sort;
  if (column == null) return rows;
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((row) => ({ row, key: sortKey(cell(row, column)) }))
    .sort((a, b) => {
      if (a.key == null || b.key == null) return Number(a.key == null) - Number(b.key == null);
      return sign * compareKeys(a.key, b.key);
    })
    .map((r) => r.row);
}
