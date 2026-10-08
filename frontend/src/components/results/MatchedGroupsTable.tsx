import type { MatchGroup } from "@core/model.js";
import { FLAG_LABEL, money, num, shortDate, signedMoney, signedNum } from "./format";

type Props = {
  groups: MatchGroup[];
  trDiscountPct: number;
  /** Groups shown in the offset section get a neutral tone. */
  tone?: "default" | "offset";
};

function groupTone(g: MatchGroup, tone: Props["tone"]): string {
  if (tone === "offset") return "grp-offset";
  if (g.flags.length === 0) return "grp-ok";
  return g.netDiff !== 0 ? "grp-danger" : "grp-warn";
}

/**
 * One <tbody> per group: the supplier rows, then the Teena-Rimon rows, then a
 * summary row with the differences and the reasons.
 */
export function MatchedGroupsTable({ groups, trDiscountPct, tone = "default" }: Props) {
  return (
    <div className="table-wrap">
      <table className="rec-table">
        <thead>
          <tr>
            <th>קבוצה</th>
            <th>צד</th>
            <th>תאריך</th>
            <th>תעודה / אסמכתא</th>
            <th>פריט</th>
            <th>אריזות</th>
            <th>ק"ג</th>
            <th>מחיר</th>
            <th>סה"כ נטו</th>
          </tr>
        </thead>
        {groups.map((g) => {
          const rows = g.supplierLines.length + g.trLines.length + 1;
          return (
            <tbody key={g.id} className={`grp ${groupTone(g, tone)}`}>
              {g.supplierLines.map((l, i) => (
                <tr key={l.id} className="side-supplier">
                  {i === 0 && (
                    <td rowSpan={rows} className="grp-id mono">
                      {g.id}
                    </td>
                  )}
                  <td>
                    <span className="side-tag side-tag--supplier">ספק</span>
                  </td>
                  <td>{shortDate(l.date)}</td>
                  <td className="mono">{[l.bookRef, l.docNumber].filter(Boolean).join(" · ")}</td>
                  <td className="name">{[l.description, l.variety].filter(Boolean).join(" · ")}</td>
                  <td className="mono">{num(l.packages)}</td>
                  <td className="mono">{num(l.quantity)}</td>
                  <td className="mono">
                    {num(l.unitPrice)}
                    {Math.abs(l.discountPct - trDiscountPct) > 0.0005 && <small> (הנחה {num(l.discountPct * 100)}%)</small>}
                  </td>
                  <td className="mono">{money(l.lineTotal)}</td>
                </tr>
              ))}
              {g.trLines.map((l) => (
                <tr key={l.id} className="side-tr">
                  <td>
                    <span className="side-tag side-tag--tr">ת"ר</span>
                  </td>
                  <td>{shortDate(l.date)}</td>
                  <td className="mono">{l.supplierRef || "—"}</td>
                  <td className="name">{[l.product, l.size].filter(Boolean).join(" · ")}</td>
                  <td className="mono">{num(l.packages)}</td>
                  <td className="mono">{num(l.quantity)}</td>
                  <td className="mono">{num(l.unitPrice)}</td>
                  <td className="mono">{money(Math.round(l.lineTotal * (1 - trDiscountPct) * 100) / 100)}</td>
                </tr>
              ))}
              <tr className="grp-summary">
                <td colSpan={4}>
                  {g.flags.length === 0 ? (
                    <>
                      <span className="chip chip--ok">תואם</span>
                      {g.notes.length > 0 && (
                        <ul className="notes">
                          {g.notes.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="chips">
                        {g.flags.map((f) => (
                          <span key={f} className={`chip chip--${f}`}>
                            {FLAG_LABEL[f]}
                          </span>
                        ))}
                      </div>
                      <ul className="notes">
                        {g.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </td>
                <td className="mono">{g.packagesDiff ? signedNum(g.packagesDiff) : ""}</td>
                <td className="mono">{g.quantityDiff ? signedNum(g.quantityDiff) : ""}</td>
                <td className="muted">{g.dateDelta ? `${signedNum(g.dateDelta)} ימים` : ""}</td>
                <td className={`mono ${g.netDiff !== 0 ? "is-hot" : ""}`}>{signedMoney(g.netDiff)}</td>
              </tr>
            </tbody>
          );
        })}
      </table>
    </div>
  );
}
