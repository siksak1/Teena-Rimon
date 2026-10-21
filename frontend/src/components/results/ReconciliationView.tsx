import { useState } from "react";
import { type ExcelField, FIELD_LABELS } from "@core/excel/fields.js";
import type { ExtractionResult, ReconciliationResult } from "@core/model.js";
import customer from "@customer-config";
import { money, OCR_MARK, percent, shortDate, signedMoney } from "./format";
import { OwnOnlyTable, SupplierOnlyTable } from "./LineTables";
import { MatchedGroupsTable } from "./MatchedGroupsTable";
import { useSelection } from "./selection";
import { SelectionProvider, SumBar } from "./SumBar";

type Props = {
  extraction: ExtractionResult;
  result: ReconciliationResult;
};

/** The chip beside the results title: how the supplier invoice was read, when not by its own parser. */
const SOURCE_CHIPS = {
  agroline: { label: "פורמט כללי", title: "לספק זה אין קורא ייעודי: החשבונית נקראה כחשבונית AGROLINE, והסכומים אומתו מול הסה\"כ המודפס" },
  table: { label: "פורמט כללי", title: "לספק זה אין קורא ייעודי: החשבונית נקראה לפי מבנה הטבלה, והסכומים אומתו מול הסה\"כ המודפס" },
  profile: { label: "מבנה נלמד", title: "החשבונית נקראה בדפדפן לפי מבנה שנלמד מחשבונית קודמת של ספק זה, והסכומים אומתו מול הסה\"כ המודפס" },
  ai: { label: "נקרא בעזרת AI", title: "אף קורא בדפדפן לא הצליח לקרוא את החשבונית, והיא נקראה בעזרת AI ונבדקה מול החשבונית" },
} as const;

export function ReconciliationView(props: Props) {
  return (
    <SelectionProvider>
      <Results {...props} />
      <SumBar />
    </SelectionProvider>
  );
}

function Results({ extraction, result }: Props) {
  const { selected } = useSelection();
  const ownName = customer.displayName;
  const [hideClean, setHideClean] = useState(false);
  const [exporting, setExporting] = useState<"idle" | "busy" | "failed">("idle");
  const { totals, offset } = result;
  const offsetIds = new Set(offset.groups.map((g) => g.id));
  const mainGroups = result.groups.filter(
    (g) => !offsetIds.has(g.id) && (!hideClean || g.flags.length > 0),
  );
  const withGaps = result.groups.filter((g) => g.flags.length > 0).length;
  const isBalanced = Math.abs(totals.diff) < 0.005;
  const { supplier } = extraction;
  /** Two Excel reports (many growers, no discount) rather than two invoices. */
  const excel = extraction.meta.format === "excel";
  const docs = excel ? "הדוחות" : "החשבוניות";
  const ocrUncertain = supplier.lines.filter((l) => l.ocrUncertain).length;

  async function handleExport() {
    setExporting("busy");
    try {
      // Loaded on demand so the spreadsheet writer stays out of the main bundle.
      const { exportReconciliation } = await import("./exportExcel");
      await exportReconciliation(extraction, result);
      setExporting("idle");
    } catch (err) {
      console.error(err);
      setExporting("failed");
    }
  }

  return (
    <section className={`results ${selected.size ? "results--has-selection" : ""}`} aria-label="תוצאות ההתאמה">
      <header className="results__header">
        <p className="eyebrow">
          תוצאות ההתאמה
          {!excel && extraction.supplier.generic && (
            <span className="chip" title={SOURCE_CHIPS[extraction.supplier.generic].title}>
              {SOURCE_CHIPS[extraction.supplier.generic].label}
            </span>
          )}
        </p>
        {excel ? (
          <>
            <h2>דוח ספק מול דוח {ownName} (אקסל)</h2>
            <p className="results__meta">
              {new Set(supplier.lines.map((l) => l.grower)).size} מגדלים · {periodOf(supplier.lines)}
            </p>
            {extraction.meta.excelColumns && (
              <details className="results__columns">
                <summary>העמודות שזוהו</summary>
                <p>דוח הספק: {columnsLine(extraction.meta.excelColumns.supplier)}</p>
                <p>
                  דוח {ownName}: {columnsLine(extraction.meta.excelColumns.own)}
                </p>
              </details>
            )}
          </>
        ) : (
          <>
            <h2>
              {extraction.supplier.supplierName} · חשבונית {extraction.supplier.invoiceNumber}
            </h2>
            <p className="results__meta">
              מול חשבונית {ownName} {extraction.own.documentNumber}
              {extraction.own.againstInvoice && ` (כנגד חשבונית ${extraction.own.againstInvoice})`}
            </p>
          </>
        )}
        <div className="results__actions">
          <button type="button" className="btn btn--ghost" onClick={handleExport} disabled={exporting === "busy"}>
            {exporting === "busy" ? "מייצא…" : "ייצוא לאקסל"}
          </button>
          {exporting === "failed" && (
            <span className="results__error" role="alert">
              הייצוא נכשל. נסו שוב.
            </span>
          )}
        </div>
      </header>

      <div className="totals-grid">
        <div className="total-card">
          <span>{excel ? 'ספק — סה"כ (ק"ג × מחיר)' : 'ספק — סה"כ פריטים נטו'}</span>
          <strong>{money(totals.supplierNet)}</strong>
        </div>
        <div className="total-card">
          <span>
            {excel
              ? `${ownName} — סה"כ (ק"ג × מחיר)`
              : `${ownName} — ${money(totals.ownGross)} פחות הנחה ${percent(totals.ownDiscountPct)}`}
          </span>
          <strong>{money(totals.ownNet)}</strong>
        </div>
        <div className={`total-card ${isBalanced ? "total-card--ok" : "total-card--hot"}`}>
          <span>פער ({ownName} פחות ספק)</span>
          <strong>{signedMoney(totals.diff)}</strong>
        </div>
      </div>

      <div className="count-strip" role="list">
        <span role="listitem">קבוצות שהוצמדו: <strong>{result.groups.length}</strong></span>
        <span role="listitem">עם פערים: <strong>{withGaps}</strong></span>
        <span role="listitem">רק אצל הספק: <strong>{result.supplierOnly.length}</strong></span>
        <span role="listitem">רק אצל {ownName}: <strong>{result.ownOnly.length}</strong></span>
      </div>

      {supplier.generic === "ai" && (
        <div className="banner banner--scan" role="status">
          <strong>פורמט חדש — החשבונית נקראה בעזרת AI</strong>
          <p>
            אף קורא בדפדפן לא הצליח לקרוא את החשבונית, ולכן היא נשלחה לקריאה בעזרת AI. כל שורה נבדקה (כמות × מחיר =
            סה"כ, והסכומים מודפסים בחשבונית) וסכום השורות נבדק מול הסה"כ המודפס.{" "}
            {ocrUncertain === 0
              ? "כל השורות אומתו. מבנה החשבונית נשמר, וחשבוניות הבאות של ספק זה ייקראו בדפדפן."
              : `${ocrUncertain} שורות לא אומתו ומסומנות "${OCR_MARK}" — יש לבדוק אותן מול החשבונית.`}
          </p>
        </div>
      )}

      {supplier.scanned && supplier.generic !== "ai" && (
        <div className="banner banner--scan" role="status">
          <strong>חשבונית סרוקה — נקראה בזיהוי תווים (OCR) בדפדפן</strong>
          <p>
            כל שורה נבדקה (משקל × מחיר = סה"כ) ועמודות החשבונית נבדקו מול הסיכומים המודפסים בה.{" "}
            {ocrUncertain === 0
              ? "כל השורות אומתו."
              : `${ocrUncertain} שורות לא אומתו ומסומנות "${OCR_MARK}" — יש לבדוק אותן מול החשבונית.`}
          </p>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="banner banner--warn" role="status">
          <strong>אזהרות קריאה</strong>
          <ul>
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <section className="results__section">
        <div className="section-head">
          <h3>שורות שהוצמדו</h3>
          <label className="toggle">
            <input type="checkbox" checked={hideClean} onChange={(e) => setHideClean(e.target.checked)} />
            הסתרת קבוצות תואמות
          </label>
        </div>
        <p className="section-hint">
          {excel
            ? 'הסכום בכל שורה הוא ק"ג × מחיר, בלי הנחה. שורות מוצמדות רק בתוך אותו מגדל. '
            : `הסה"כ נטו של ${ownName} מחושב אחרי הנחה מסחרית של ${percent(totals.ownDiscountPct)}. `}
          בשורת הסיכום של כל קבוצה: הפרש אריזות, ק"ג, ימים וכסף. לחיצה על שורות מציגה את סכום הק"ג והכסף שלהן.
        </p>
        <MatchedGroupsTable groups={mainGroups} ownDiscountPct={totals.ownDiscountPct} growers={excel} />
      </section>

      <section className="results__section">
        <h3>רק אצל הספק ({result.supplierOnly.length})</h3>
        {result.supplierOnly.length ? (
          <SupplierOnlyTable lines={result.supplierOnly} excel={excel} />
        ) : (
          <p className="empty">כל שורות הספק הוצמדו.</p>
        )}
      </section>

      <section className="results__section">
        <h3>רק אצל {ownName} ({result.ownOnly.length})</h3>
        {result.ownOnly.length ? (
          <OwnOnlyTable lines={result.ownOnly} ownDiscountPct={totals.ownDiscountPct} excel={excel} />
        ) : (
          <p className="empty">כל שורות {ownName} הוצמדו.</p>
        )}
      </section>

      <section className="results__section">
        <h3>קיזוז פערים</h3>
        {offset.applies ? (
          offset.groups.length ? (
            <>
              <p className="section-hint">
                סה"כ {docs} זהה, ולכן פערי המחיר והמשקל בקבוצות הבאות מתקזזים זה בזה (סכום הפערים: {signedMoney(offset.groups.reduce((a, g) => a + g.netDiff, 0))}).
              </p>
              <MatchedGroupsTable groups={offset.groups} ownDiscountPct={totals.ownDiscountPct} tone="offset" growers={excel} />
            </>
          ) : (
            <p className="empty">סה"כ {docs} זהה ואין פערים לקיזוז.</p>
          )
        ) : (
          <p className="empty">
            אין קיזוז: סה"כ {docs} אינו זהה (פער של {signedMoney(totals.diff)}), ולכן כל הפערים מוצגים בטבלה הראשית.
          </p>
        )}
      </section>

    </section>
  );
}

/** "31/08/26 – 08/09/26": the dates a report covers. */
function periodOf(lines: { date: string | null }[]): string {
  const dates = lines.map((l) => l.date).filter((d): d is string => Boolean(d)).sort();
  if (dates.length === 0) return "";
  const first = shortDate(dates[0]);
  const last = shortDate(dates[dates.length - 1]);
  return first === last ? first : `${first} – ${last}`;
}

/** "פריט ← תאור · משקל ← משקל מכירה …": which column each field was read from. */
function columnsLine(used: Record<string, string>): string {
  return (Object.keys(FIELD_LABELS) as ExcelField[])
    .filter((f) => used[f])
    .map((f) => `${FIELD_LABELS[f]} ← ${used[f]}`)
    .join(" · ");
}
