import { useState } from "react";

export type ColumnFilters = {
  values: string[];
  active: boolean;
  set: (column: number, value: string) => void;
  clear: () => void;
};

export function useColumnFilters(columnCount: number): ColumnFilters {
  const [values, setValues] = useState<string[]>(() => Array(columnCount).fill(""));
  return {
    values,
    active: values.some((v) => v.trim() !== ""),
    set: (column, value) => setValues((prev) => prev.map((v, i) => (i === column ? value : v))),
    clear: () => setValues(Array(columnCount).fill("")),
  };
}

/** Intl output carries bidi marks and non-breaking spaces; compare on plain text. */
function normalize(text: string): string {
  return text.replace(/[‎‏]/g, "").replace(/ /g, " ").trim().toLowerCase();
}

/** True when every non-empty filter is contained in the cell text shown in its column. */
export function rowMatches(cells: string[], filters: string[]): boolean {
  return filters.every((f, i) => {
    const q = normalize(f);
    return q === "" || normalize(cells[i] ?? "").includes(q);
  });
}
