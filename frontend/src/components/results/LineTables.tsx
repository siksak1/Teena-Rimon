import type { OwnLine, SupplierLine } from "@core/model.js";
import customer from "@customer-config";
import { rowMatches, useColumnFilters } from "./filtering";
import { ClearFilters, FilterableHead } from "./ColumnFilters";
import { money, num, ownItem, ownNet, shortDate, supplierItemMarked } from "./format";
import { ownKey, supplierKey, type SelItem, type SelTable } from "./selection";
import { SelRow } from "./SumBar";

type Props<T> = {
  headers: string[];
  /** Cell class per column. */
  classes: string[];
  lines: T[];
  /** The text shown in each column; also what the column filters match on. */
  cells: (line: T) => string[];
  /** Selection key and partial-sum values of a line. */
  sel: (line: T) => [string, SelItem];
};

function LinesTable<T extends { id: string }>({ headers, classes, lines, cells, sel }: Props<T>) {
  const filters = useColumnFilters(headers.length);
  const rows = lines
    .map((l) => ({ id: l.id, cells: cells(l), sel: sel(l) }))
    .filter((r) => rowMatches(r.cells, filters.values));
  const selTable: SelTable = new Map(rows.map((r) => r.sel));
  return (
    <>
      <div className="table-tools">
        <ClearFilters filters={filters} />
      </div>
      <div className="table-wrap">
        <table className="rec-table">
          <FilterableHead headers={headers} filters={filters} />
          <tbody>
            {rows.map((r) => (
              <SelRow key={r.id} selKey={r.sel[0]} table={selTable} className="row-missing">
                {(box) =>
                  r.cells.map((c, i) => (
                    <td key={headers[i]} className={classes[i]}>
                      {i === 0 && box}
                      {c}
                    </td>
                  ))
                }
              </SelRow>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={headers.length} className="empty">
                  אין שורות תואמות לסינון.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

const SUPPLIER_HEADERS = ["שורה", "תאריך", "תעודה", "פנקס", "פריט", "אריזות", 'ק"ג', "מחיר", "הנחה", 'סה"כ נטו'];
const SUPPLIER_CLASSES = ["mono", "", "mono", "mono", "name", "mono", "mono", "mono", "mono", "mono"];
/** Excel reports: no booklet, no discount; one report covers many growers. */
const EXCEL_SUPPLIER_HEADERS = ["שורה", "תאריך", "מגדל", "תעודה", "פריט", "אריזות", 'ק"ג', "מחיר", 'סה"כ'];
const EXCEL_SUPPLIER_CLASSES = ["mono", "", "grower", "mono", "name", "mono", "mono", "mono", "mono"];

/** Supplier rows that have no counterpart in the wholesaler's own document. */
export function SupplierOnlyTable({ lines, excel = false }: { lines: SupplierLine[]; excel?: boolean }) {
  if (excel) {
    return (
      <LinesTable
        headers={EXCEL_SUPPLIER_HEADERS}
        classes={EXCEL_SUPPLIER_CLASSES}
        lines={lines}
        sel={(l) => [supplierKey(l.id), { side: "supplier", quantity: l.quantity, amount: l.lineTotal }]}
        cells={(l) => [
          l.id,
          shortDate(l.date),
          l.grower ?? "—",
          l.docNumber ?? "—",
          supplierItemMarked(l),
          num(l.packages),
          num(l.quantity),
          num(l.unitPrice),
          money(l.lineTotal),
        ]}
      />
    );
  }
  return (
    <LinesTable
      headers={SUPPLIER_HEADERS}
      classes={SUPPLIER_CLASSES}
      lines={lines}
      sel={(l) => [supplierKey(l.id), { side: "supplier", quantity: l.quantity, amount: l.lineTotal }]}
      cells={(l) => [
        l.id,
        shortDate(l.date),
        l.docNumber ?? "—",
        l.bookRef ?? "—",
        supplierItemMarked(l),
        num(l.packages),
        num(l.quantity),
        num(l.unitPrice),
        `${num(l.discountPct * 100)}%`,
        money(l.lineTotal),
      ]}
    />
  );
}

const OWN_HEADERS = ["שורה", "תאריך", `מסמך ${customer.shortName}`, "אסמכתא", "פריט", "אריזות", 'ק"ג', "מחיר", "סכום (לפני הנחה)"];
const OWN_CLASSES = ["mono", "", "mono", "mono", "name", "mono", "mono", "mono", "mono"];

const EXCEL_OWN_HEADERS = ["שורה", "תאריך", "מגדל", "אסמכתא", "פריט", 'ק"ג', "מחיר", 'סה"כ'];
const EXCEL_OWN_CLASSES = ["mono", "", "grower", "mono", "name", "mono", "mono", "mono"];

/** Own-document rows the supplier did not invoice. */
export function OwnOnlyTable({
  lines,
  ownDiscountPct,
  excel = false,
}: {
  lines: OwnLine[];
  /** Partial sums use the net after the commercial discount, like the matched groups. */
  ownDiscountPct: number;
  excel?: boolean;
}) {
  if (excel) {
    return (
      <LinesTable
        headers={EXCEL_OWN_HEADERS}
        classes={EXCEL_OWN_CLASSES}
        lines={lines}
        sel={(l) => [ownKey(l.id), { side: "own", quantity: l.quantity, amount: ownNet(l, ownDiscountPct) }]}
        cells={(l) => [
          l.id,
          shortDate(l.date),
          l.grower ?? "—",
          l.supplierRef || "—",
          ownItem(l),
          num(l.quantity),
          num(l.unitPrice),
          money(l.lineTotal),
        ]}
      />
    );
  }
  return (
    <LinesTable
      headers={OWN_HEADERS}
      classes={OWN_CLASSES}
      lines={lines}
      sel={(l) => [ownKey(l.id), { side: "own", quantity: l.quantity, amount: ownNet(l, ownDiscountPct) }]}
      cells={(l) => [
        l.id,
        shortDate(l.date),
        l.ownDocNumber,
        l.supplierRef || "—",
        ownItem(l),
        num(l.packages),
        num(l.quantity),
        num(l.unitPrice),
        money(l.lineTotal),
      ]}
    />
  );
}
