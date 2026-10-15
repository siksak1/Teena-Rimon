import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";

/**
 * Rows the user ticks to see their partial sum (kg and ₪), e.g. the supplier
 * lines that together make up one own-document line. Purely a calculator:
 * nothing here changes the matching or reaches the export.
 */
export type SelItem = { side: "supplier" | "own"; quantity: number; amount: number };

/** The selectable rows of one table, in display order (Shift-click ranges stay inside it). */
export type SelTable = ReadonlyMap<string, SelItem>;

type Selection = {
  selected: ReadonlyMap<string, SelItem>;
  /** Selected rows currently on screen (not filtered out or collapsed). */
  shown: ReadonlySet<string>;
  click: (key: string, table: SelTable, range: boolean) => void;
  clear: () => void;
  show: (key: string) => () => void;
};

export const SelectionContext = createContext<Selection | null>(null);

export const supplierKey = (id: string) => `s:${id}`;
export const ownKey = (id: string) => `o:${id}`;

/** The state behind SelectionProvider. */
export function useSelectionState(): Selection {
  const [selected, setSelected] = useState<ReadonlyMap<string, SelItem>>(new Map());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());

  const click = useCallback(
    (key: string, table: SelTable, range: boolean) => {
      const keys = [...table.keys()];
      const from = anchor == null ? -1 : keys.indexOf(anchor);
      const to = keys.indexOf(key);
      setSelected((prev) => {
        const next = new Map(prev);
        if (range && from >= 0 && to >= 0) {
          for (const k of keys.slice(Math.min(from, to), Math.max(from, to) + 1)) next.set(k, table.get(k)!);
        } else if (!next.delete(key)) {
          next.set(key, table.get(key)!);
        }
        return next;
      });
      setAnchor(key);
    },
    [anchor],
  );

  const clear = useCallback(() => {
    setSelected(new Map());
    setAnchor(null);
  }, []);

  const show = useCallback((key: string) => {
    setShown((prev) => new Set(prev).add(key));
    return () =>
      setShown((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
  }, []);

  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && clear();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected.size, clear]);

  return useMemo(() => ({ selected, shown, click, clear, show }), [selected, shown, click, clear, show]);
}

export function useSelection(): Selection {
  const sel = useContext(SelectionContext);
  if (!sel) throw new Error("useSelection outside SelectionProvider");
  return sel;
}

/** Props for a selectable <tr>; `toggle` is for its checkbox. */
export function useSelectableRow(key: string, table: SelTable) {
  const { selected, click, show } = useSelection();
  const isSelected = selected.has(key);
  useEffect(() => show(key), [key, show]);

  return {
    row: {
      className: isSelected ? "is-selected" : undefined,
      "aria-selected": isSelected,
      onMouseDown: (e: MouseEvent) => {
        // Shift-click would otherwise select the text between the two rows.
        if (e.shiftKey) e.preventDefault();
      },
      onClick: (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest("button, input, a, select, .grp-id")) return;
        // Dragging to copy text is not a click on the row.
        if (window.getSelection()?.toString()) return;
        click(key, table, e.shiftKey);
      },
    },
    isSelected,
    toggle: () => click(key, table, false),
  };
}
