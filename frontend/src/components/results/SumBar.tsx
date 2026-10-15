import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import customer from "@customer-config";
import { money, num, signedMoney, signedNum } from "./format";
import { SelectionContext, useSelectableRow, useSelection, useSelectionState, type SelItem, type SelTable } from "./selection";

export function SelectionProvider({ children }: { children: ReactNode }) {
  return <SelectionContext.Provider value={useSelectionState()}>{children}</SelectionContext.Provider>;
}

type Sum = { count: number; quantity: number; amount: number };

function sumOf(items: SelItem[]): Sum {
  // Agorot and grams, so the total matches the sum of the shown cells exactly.
  const agorot = items.reduce((a, i) => a + Math.round(i.amount * 100), 0);
  const grams = items.reduce((a, i) => a + Math.round(i.quantity * 1000), 0);
  return { count: items.length, quantity: grams / 1000, amount: agorot / 100 };
}

const rows = (n: number) => (n === 1 ? "שורה אחת" : `${n} שורות`);

/**
 * Floats at the bottom of the screen while any row is selected. Rendered into
 * <body>: the page shell's transform and backdrop blur would otherwise pin a
 * fixed element to the shell instead of the viewport.
 */
export function SumBar() {
  const { selected, shown, clear } = useSelection();
  if (selected.size === 0) return null;

  const items = [...selected.values()];
  const supplier = sumOf(items.filter((i) => i.side === "supplier"));
  const own = sumOf(items.filter((i) => i.side === "own"));
  const hidden = [...selected.keys()].filter((k) => !shown.has(k)).length;
  const both = supplier.count > 0 && own.count > 0;
  const all = sumOf(items);

  return createPortal(
    <div className="sum-bar" role="status" aria-live="polite">
      {both ? (
        <>
          <SidePart label="ספק" sum={supplier} />
          <SidePart label={customer.shortName} sum={own} />
          <span className="sum-bar__part">
            <strong>הפרש</strong>{" "}
            <span className={`mono ${own.quantity !== supplier.quantity ? "is-hot" : ""}`}>
              {signedNum(Math.round((own.quantity - supplier.quantity) * 1000) / 1000)}
            </span>{" "}
            ק"ג
            {" · "}
            <span className={`mono ${own.amount !== supplier.amount ? "is-hot" : ""}`}>
              {signedMoney(Math.round((own.amount - supplier.amount) * 100) / 100)}
            </span>
          </span>
        </>
      ) : (
        <span className="sum-bar__part">
          נבחרו {rows(selected.size)} · משקל <span className="mono">{num(all.quantity)}</span> ק"ג · סכום{" "}
          <span className="mono">{money(all.amount)}</span>
        </span>
      )}
      {hidden > 0 && <span className="sum-bar__hidden">({hidden} מוסתרות)</span>}
      <button type="button" className="sum-bar__clear" onClick={clear}>
        נקה ✕
      </button>
    </div>,
    document.body,
  );
}

function SidePart({ label, sum }: { label: string; sum: Sum }) {
  return (
    <span className="sum-bar__part">
      <strong>{label}</strong> {rows(sum.count)} · <span className="mono">{num(sum.quantity)}</span> ק"ג ·{" "}
      <span className="mono">{money(sum.amount)}</span>
    </span>
  );
}

/** A selectable <tr>; `children` receives the checkbox to place in one of its cells. */
export function SelRow({
  selKey,
  table,
  className,
  children,
}: {
  selKey: string;
  table: SelTable;
  className?: string;
  children: (box: ReactNode) => ReactNode;
}) {
  const { row, isSelected, toggle } = useSelectableRow(selKey, table);
  const box = (
    <input type="checkbox" className="sel-box" aria-label="בחירת שורה לסיכום" checked={isSelected} onChange={toggle} />
  );
  return (
    <tr {...row} className={[className, row.className].filter(Boolean).join(" ")}>
      {children(box)}
    </tr>
  );
}
