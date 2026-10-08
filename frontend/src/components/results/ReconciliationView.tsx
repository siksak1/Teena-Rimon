import { useState } from "react";
import type { ExtractionResult, ReconciliationResult } from "@core/model.js";
import customer from "@customer-config";
import { money, percent, signedMoney } from "./format";
import { OwnOnlyTable, SupplierOnlyTable } from "./LineTables";
import { MatchedGroupsTable } from "./MatchedGroupsTable";

type Props = {
  extraction: ExtractionResult;
  result: ReconciliationResult;
};

export function ReconciliationView({ extraction, result }: Props) {
  const ownName = customer.displayName;
  const [hideClean, setHideClean] = useState(false);
  const { totals, offset } = result;
  const offsetIds = new Set(offset.groups.map((g) => g.id));
  const mainGroups = result.groups.filter(
    (g) => !offsetIds.has(g.id) && (!hideClean || g.flags.length > 0),
  );
  const withGaps = result.groups.filter((g) => g.flags.length > 0).length;
  const isBalanced = Math.abs(totals.diff) < 0.005;

  return (
    <section className="results" aria-label="תוצאות ההתאמה">
      <header className="results__header">
        <p className="eyebrow">
          תוצאות ההתאמה
        </p>
        <h2>
          {extraction.supplier.supplierName} · חשבונית {extraction.supplier.invoiceNumber}
        </h2>
        <p className="results__meta">
          מול חשבונית {ownName} {extraction.own.documentNumber}
          {extraction.own.againstInvoice && ` (כנגד חשבונית ${extraction.own.againstInvoice})`}
        </p>
      </header>

      <div className="totals-grid">
        <div className="total-card">
          <span>ספק — סה"כ פריטים נטו</span>
          <strong>{money(totals.supplierNet)}</strong>
        </div>
        <div className="total-card">
          <span>
            {ownName} — {money(totals.ownGross)} פחות הנחה {percent(totals.ownDiscountPct)}
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
          הסה"כ נטו של {ownName} מחושב אחרי הנחה מסחרית של {percent(totals.ownDiscountPct)}. בשורת הסיכום של כל קבוצה: הפרש אריזות, ק"ג, ימים וכסף.
        </p>
        <MatchedGroupsTable groups={mainGroups} ownDiscountPct={totals.ownDiscountPct} />
      </section>

      <section className="results__section">
        <h3>רק אצל הספק ({result.supplierOnly.length})</h3>
        {result.supplierOnly.length ? (
          <SupplierOnlyTable lines={result.supplierOnly} />
        ) : (
          <p className="empty">כל שורות הספק הוצמדו.</p>
        )}
      </section>

      <section className="results__section">
        <h3>רק אצל {ownName} ({result.ownOnly.length})</h3>
        {result.ownOnly.length ? (
          <OwnOnlyTable lines={result.ownOnly} />
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
                סה"כ החשבוניות זהה, ולכן פערי המחיר והמשקל בקבוצות הבאות מתקזזים זה בזה (סכום הפערים: {signedMoney(offset.groups.reduce((a, g) => a + g.netDiff, 0))}).
              </p>
              <MatchedGroupsTable groups={offset.groups} ownDiscountPct={totals.ownDiscountPct} tone="offset" />
            </>
          ) : (
            <p className="empty">סה"כ החשבוניות זהה ואין פערים לקיזוז.</p>
          )
        ) : (
          <p className="empty">
            אין קיזוז: סה"כ נטו אינו זהה (פער של {signedMoney(totals.diff)}), ולכן כל הפערים מוצגים בטבלה הראשית.
          </p>
        )}
      </section>

      {result.dictionarySuggestions.length > 0 && (
        <section className="results__section">
          <h3>מילים שלא זוהו בשמות הפריטים</h3>
          <p className="section-hint">אפשר להוסיף אותן למילון השמות כדי לשפר את ההתאמה.</p>
          <p className="suggestions">{result.dictionarySuggestions.join(" · ")}</p>
        </section>
      )}
    </section>
  );
}
