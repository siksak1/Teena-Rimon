import type { OwnLine, SupplierLine } from "@core/model.js";
import customer from "@customer-config";
import { money, num, shortDate } from "./format";

/** Supplier rows that have no counterpart in the wholesaler's own document. */
export function SupplierOnlyTable({ lines }: { lines: SupplierLine[] }) {
  return (
    <div className="table-wrap">
      <table className="rec-table">
        <thead>
          <tr>
            <th>שורה</th>
            <th>תאריך</th>
            <th>תעודה</th>
            <th>פנקס</th>
            <th>פריט</th>
            <th>אריזות</th>
            <th>ק"ג</th>
            <th>מחיר</th>
            <th>הנחה</th>
            <th>סה"כ נטו</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="row-missing">
              <td className="mono">{l.id}</td>
              <td>{shortDate(l.date)}</td>
              <td className="mono">{l.docNumber ?? "—"}</td>
              <td className="mono">{l.bookRef ?? "—"}</td>
              <td className="name">{[l.description, l.variety].filter(Boolean).join(" · ")}</td>
              <td className="mono">{num(l.packages)}</td>
              <td className="mono">{num(l.quantity)}</td>
              <td className="mono">{num(l.unitPrice)}</td>
              <td className="mono">{num(l.discountPct * 100)}%</td>
              <td className="mono">{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Own-document rows the supplier did not invoice. */
export function OwnOnlyTable({ lines }: { lines: OwnLine[] }) {
  return (
    <div className="table-wrap">
      <table className="rec-table">
        <thead>
          <tr>
            <th>שורה</th>
            <th>תאריך</th>
            <th>מסמך {customer.shortName}</th>
            <th>אסמכתא</th>
            <th>פריט</th>
            <th>אריזות</th>
            <th>ק"ג</th>
            <th>מחיר</th>
            <th>סכום (לפני הנחה)</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="row-missing">
              <td className="mono">{l.id}</td>
              <td>{shortDate(l.date)}</td>
              <td className="mono">{l.ownDocNumber}</td>
              <td className="mono">{l.supplierRef || "—"}</td>
              <td className="name">{[l.product, l.size].filter(Boolean).join(" · ")}</td>
              <td className="mono">{num(l.packages)}</td>
              <td className="mono">{num(l.quantity)}</td>
              <td className="mono">{num(l.unitPrice)}</td>
              <td className="mono">{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
