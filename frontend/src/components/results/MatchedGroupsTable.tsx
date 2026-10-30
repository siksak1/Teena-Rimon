import { useState } from "react";
import type { MatchGroup } from "@core/model.js";
import customer from "@customer-config";
import { rowMatches, useColumnFilters } from "./filtering";
import { ClearFilters, FilterableHead } from "./ColumnFilters";
import { ownKey, supplierKey, type SelItem, type SelTable } from "./selection";
import { SelRow } from "./SumBar";
import {
  FLAG_LABEL,
  money,
  num,
  ownItem,
  ownNet,
  shortDate,
  signedMoney,
  signedNum,
  shownDateDelta,
  OCR_MARK,
  ocrUncertainFields,
  UNREAD_MARK,
  UNREAD_TITLE,
  supplierItem,
  supplierItemMarked,
  supplierRef,
} from "./format";

type Props = {
  groups: MatchGroup[];
  ownDiscountPct: number;
  /** Groups shown in the offset section get a neutral tone. */
  tone?: "default" | "offset";
  /** Excel reports: a grower column (each report covers many growers). */
  growers?: boolean;
};

/** "שורה" is the line's own id (S…/T…), as in the supplier-only and own-only tables. */
const HEADERS = ["קבוצה", "צד", "שורה", "תאריך", "תעודה / אסמכתא", "פריט", "אריזות", 'ק"ג', "מחיר", 'סה"כ נטו'];
/** Excel reports carry no discount: the amount is just weight × price. */
const GROWER_HEADERS = ["קבוצה", "צד", "שורה", "מגדל", ...HEADERS.slice(3, -1), 'סה"כ'];

function groupTone(g: MatchGroup, tone: Props["tone"]): string {
  if (tone === "offset") return "grp-offset";
  if (g.flags.length === 0) return "grp-ok";
  return g.netDiff !== 0 ? "grp-danger" : "grp-warn";
}

/** Groups start open when they have a money difference or a scanned row to check. */
const openByDefault = (g: MatchGroup) => g.netDiff !== 0 || g.supplierLines.some((l) => l.ocrUncertain || l.unread);

/** The text of each line as shown in the table, one entry per column, for the column filters. */
function lineCells(g: MatchGroup, ownDiscountPct: number, growers: boolean): string[][] {
  const grower = (l: { grower?: string }) => (growers ? [l.grower ?? ""] : []);
  return [
    ...g.supplierLines.map((l) => [
      g.id,
      "ספק",
      l.id,
      ...grower(l),
      shortDate(l.date),
      supplierRef(l),
      supplierItemMarked(l),
      num(l.packages),
      num(l.quantity),
      num(l.unitPrice),
      money(l.lineTotal),
    ]),
    ...g.ownLines.map((l) => [
      g.id,
      customer.shortName,
      l.id,
      ...grower(l),
      shortDate(l.date),
      l.supplierRef || "—",
      ownItem(l),
      num(l.packages),
      num(l.quantity),
      num(l.unitPrice),
      money(ownNet(l, ownDiscountPct)),
    ]),
  ];
}

function GroupStatus({ g }: { g: MatchGroup }) {
  return g.flags.length === 0 ? (
    <span className="chip chip--ok">תואם</span>
  ) : (
    <div className="chips">
      {g.flags.map((f) => (
        <span key={f} className={`chip chip--${f}`}>
          {FLAG_LABEL[f]}
        </span>
      ))}
    </div>
  );
}

function DiffCells({ g }: { g: MatchGroup }) {
  return (
    <>
      <td className="mono">{g.packagesDiff ? signedNum(g.packagesDiff) : ""}</td>
      <td className="mono">{g.quantityDiff ? signedNum(g.quantityDiff) : ""}</td>
      <td className="muted">{shownDateDelta(g.dateDelta) ? `${signedNum(g.dateDelta)} ימים` : ""}</td>
      <td className={`mono ${g.netDiff !== 0 ? "is-hot" : ""}`}>{signedMoney(g.netDiff)}</td>
    </>
  );
}

/**
 * One <tbody> per group: the supplier rows, then the own-document rows, then a
 * summary row with the differences and the reasons. Groups without a money
 * difference start collapsed to a single summary row.
 */
export function MatchedGroupsTable({ groups, ownDiscountPct, tone = "default", growers = false }: Props) {
  const headers = growers ? GROWER_HEADERS : HEADERS;
  /** Columns from the side tag up to the numbers: side, line, [grower,] date, reference, item. */
  const labelSpan = growers ? 6 : 5;
  const filters = useColumnFilters(headers.length);
  /** Groups the user opened or closed, relative to their default. */
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const isOpen = (g: MatchGroup) => openByDefault(g) !== toggled.has(g.id);
  const toggle = (id: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const setAll = (open: boolean) =>
    setToggled(new Set(groups.filter((g) => openByDefault(g) !== open).map((g) => g.id)));

  const visible = filters.active
    ? groups.filter((g) => lineCells(g, ownDiscountPct, growers).some((cells) => rowMatches(cells, filters.values)))
    : groups;

  /** The line rows on screen, in order, for the partial sums. */
  const selTable: SelTable = new Map<string, SelItem>(
    visible.filter(isOpen).flatMap((g) => [
      ...g.supplierLines.map((l) => [supplierKey(l.id), { side: "supplier", quantity: l.quantity, amount: l.lineTotal }] as const),
      ...g.ownLines.map((l) => [ownKey(l.id), { side: "own", quantity: l.quantity, amount: ownNet(l, ownDiscountPct) }] as const),
    ]),
  );

  return (
    <>
      <div className="table-tools">
        <button type="button" className="link-btn" onClick={() => setAll(true)}>
          פתיחת הכל
        </button>
        <button type="button" className="link-btn" onClick={() => setAll(false)}>
          סגירת הכל
        </button>
        <ClearFilters filters={filters} />
      </div>
      <div className="table-wrap">
        <table className="rec-table">
          <FilterableHead headers={headers} filters={filters} />
          {visible.map((g) => {
            const open = isOpen(g);
            const toggleButton = (
              <button
                type="button"
                className="grp-toggle"
                aria-expanded={open}
                aria-label={`${open ? "סגירת" : "פתיחת"} קבוצה ${g.id}`}
                onClick={() => toggle(g.id)}
              >
                ▾
              </button>
            );

            if (!open) {
              const items = [...new Set([...g.supplierLines.map(supplierItem), ...g.ownLines.map(ownItem)])];
              return (
                <tbody key={g.id} className={`grp grp--collapsed ${groupTone(g, tone)}`}>
                  <tr className="grp-summary">
                    <td className="grp-id mono">
                      {toggleButton}
                      {g.id}
                    </td>
                    <td colSpan={labelSpan}>
                      <div className="grp-brief">
                        <GroupStatus g={g} />
                        <span className="grp-brief__items">{items.join(" · ")}</span>
                        <span className="muted">
                          ({g.supplierLines.length} ספק · {g.ownLines.length} {customer.shortName})
                        </span>
                      </div>
                    </td>
                    <DiffCells g={g} />
                  </tr>
                </tbody>
              );
            }

            const rows = g.supplierLines.length + g.ownLines.length + 1;
            return (
              <tbody key={g.id} className={`grp ${groupTone(g, tone)}`}>
                {g.supplierLines.map((l, i) => (
                  <SelRow key={l.id} selKey={supplierKey(l.id)} table={selTable} className="side-supplier">
                    {(box) => (
                      <>
                        {i === 0 && (
                          <td rowSpan={rows} className="grp-id mono">
                            {toggleButton}
                            {g.id}
                          </td>
                        )}
                        <td>
                          {box}
                          <span className="side-tag side-tag--supplier">ספק</span>
                        </td>
                        <td className="mono">{l.id}</td>
                        {growers && <td className="grower">{l.grower}</td>}
                        <td>{shortDate(l.date)}</td>
                        <td className="mono">{supplierRef(l)}</td>
                        <td className="name">
                          {supplierItem(l)}
                          {l.ocrUncertain && (
                            <span className="ocr-mark" title={`לא אומת בזיהוי התווים: ${ocrUncertainFields(l)}`}>
                              {OCR_MARK}
                            </span>
                          )}
                          {l.unread && (
                            <span className="ocr-mark" title={UNREAD_TITLE}>
                              {UNREAD_MARK}
                            </span>
                          )}
                        </td>
                        <td className="mono">{num(l.packages)}</td>
                        <td className="mono">{num(l.quantity)}</td>
                        <td className="mono">
                          {num(l.unitPrice)}
                          {Math.abs(l.discountPct - ownDiscountPct) > 0.0005 && <small> (הנחה {num(l.discountPct * 100)}%)</small>}
                        </td>
                        <td className="mono">{money(l.lineTotal)}</td>
                      </>
                    )}
                  </SelRow>
                ))}
                {g.ownLines.map((l) => (
                  <SelRow key={l.id} selKey={ownKey(l.id)} table={selTable} className="side-tr">
                    {(box) => (
                      <>
                        <td>
                          {box}
                          <span className="side-tag side-tag--tr">{customer.shortName}</span>
                        </td>
                        <td className="mono">{l.id}</td>
                        {growers && <td className="grower">{l.grower}</td>}
                        <td>{shortDate(l.date)}</td>
                        <td className="mono">{l.supplierRef || "—"}</td>
                        <td className="name">{ownItem(l)}</td>
                        <td className="mono">{num(l.packages)}</td>
                        <td className="mono">{num(l.quantity)}</td>
                        <td className="mono">{num(l.unitPrice)}</td>
                        <td className="mono">{money(ownNet(l, ownDiscountPct))}</td>
                      </>
                    )}
                  </SelRow>
                ))}
                <tr className="grp-summary">
                  <td colSpan={labelSpan}>
                    <GroupStatus g={g} />
                    {g.notes.length > 0 && (
                      <ul className="notes">
                        {g.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <DiffCells g={g} />
                </tr>
              </tbody>
            );
          })}
          {visible.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={headers.length} className="empty">
                  {filters.active ? "אין קבוצות תואמות לסינון." : "אין קבוצות להצגה."}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>
    </>
  );
}
