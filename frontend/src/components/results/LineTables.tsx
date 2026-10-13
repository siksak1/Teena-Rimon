import type { OwnLine, SupplierLine } from "@core/model.js";
import customer from "@customer-config";
import { rowMatches, useColumnFilters } from "./filtering";
import { ClearFilters, FilterableHead } from "./ColumnFilters";
import { money, num, ownItem, shortDate, supplierItemMarked } from "./format";

type Props<T> = {
  headers: string[];
  /** Cell class per column. */
  classes: string[];
  lines: T[];
  /** The text shown in each column; also what the column filters match on. */
  cells: (line: T) => string[];
};

function LinesTable<T extends { id: string }>({ headers, classes, lines, cells }: Props<T>) {
  const filters = useColumnFilters(headers.length);
  const rows = lines.map((l) => ({ id: l.id, cells: cells(l) })).filter((r) => rowMatches(r.cells, filters.values));
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
              <tr key={r.id} className="row-missing">
                {r.cells.map((c, i) => (
                  <td key={headers[i]} className={classes[i]}>
                    {c}
                  </td>
                ))}
              </tr>
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

/** Supplier rows that have no counterpart in the wholesaler's own document. */
export function SupplierOnlyTable({ lines }: { lines: SupplierLine[] }) {
  return (
    <LinesTable
      headers={SUPPLIER_HEADERS}
      classes={SUPPLIER_CLASSES}
      lines={lines}
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

/** Own-document rows the supplier did not invoice. */
export function OwnOnlyTable({ lines }: { lines: OwnLine[] }) {
  return (
    <LinesTable
      headers={OWN_HEADERS}
      classes={OWN_CLASSES}
      lines={lines}
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
