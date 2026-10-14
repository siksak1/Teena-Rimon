import { useRef, useState, useTransition } from "react";
import { completedEvent, failedEvent, lineCounts } from "@core/analytics.js";
import type { ExtractionResult, ReconciliationResult } from "@core/model.js";
import { supplierParsersFor } from "@core/parsers/registry.js";
import { reconcile } from "@core/reconcile/reconcile.js";
import customer from "@customer-config";
import { analyticsContext, track } from "./analytics";
import { ExtractError, extractExcelReports, extractInvoices } from "./api/extract";
import { FileDropZone } from "./components/FileDropZone";
import { ReconciliationView } from "./components/results/ReconciliationView";
import "./App.css";
import "./components/results/results.css";

type UiPhase = "idle" | "extracting" | "ready" | "error";
/** PDF: one supplier invoice. Excel: two reports covering many growers (customers with `excel` in their config). */
type Mode = "pdf" | "excel";

const supplierNames = supplierParsersFor(customer).map((p) => p.displayName).join(", ");

export default function App() {
  const [mode, setMode] = useState<Mode>("pdf");
  const [ownFile, setOwnFile] = useState<File | null>(null);
  const [supplierFile, setSupplierFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  /** Pages of a scanned supplier invoice read so far, while OCR runs. */
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{
    extraction: ExtractionResult;
    reconciliation: ReconciliationResult;
    /** Remounts the results view, so collapse and filter state start fresh for each comparison. */
    run: number;
  } | null>(null);
  const [isPending, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  const canCompare = Boolean(ownFile && supplierFile) && phase !== "extracting";

  async function handleCompare() {
    if (!ownFile || !supplierFile) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("extracting");
    setError(null);
    setScanProgress(null);

    try {
      const started = performance.now();
      const extraction =
        mode === "excel"
          ? await extractExcelReports(ownFile, supplierFile)
          : await extractInvoices(ownFile, supplierFile, (done, total) => {
              if (!controller.signal.aborted) setScanProgress({ done, total });
            });
      // Parsing can't be cancelled; ignore results that arrive after a reset or a newer run.
      if (controller.signal.aborted) return;
      const parsed = performance.now();
      const reconciliation = reconcile(extraction, customer);
      track(
        completedEvent(analyticsContext, reconciliation, lineCounts(extraction), {
          parseMs: parsed - started,
          reconcileMs: performance.now() - parsed,
        }),
      );
      startTransition(() => {
        setResult((prev) => ({ extraction, reconciliation, run: (prev?.run ?? 0) + 1 }));
        setPhase("ready");
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      track(failedEvent(analyticsContext, err instanceof ExtractError ? err.code : "INTERNAL"));
      const message = err instanceof Error ? err.message : "אירעה שגיאה בקריאת הקבצים.";
      setError(message);
      setPhase("error");
      setResult(null);
    }
  }

  function handleReset() {
    abortRef.current?.abort();
    setOwnFile(null);
    setSupplierFile(null);
    setResult(null);
    setError(null);
    setPhase("idle");
  }

  function switchMode(next: Mode) {
    if (next === mode || phase === "extracting") return;
    handleReset();
    setMode(next);
  }

  function pick(setter: (f: File | null) => void) {
    return (f: File | null) => {
      setter(f);
      setResult(null);
      setError(null);
      setPhase("idle");
    };
  }

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden />

      <header className="brand-bar">
        <div className="brand">
          <span className="brand__mark" aria-hidden />
          <div>
            <p className="brand__name">LedgerMatch</p>
            <p className="brand__tag">התאמת חשבוניות ספקים</p>
          </div>
        </div>
        <p className="brand-bar__note">
          הקבצים נקראים בדפדפן בלבד · ספקים נתמכים: {supplierNames}
        </p>
      </header>

      <main className="shell">
        {customer.excel && (
          <div className="mode-switch" role="radiogroup" aria-label="סוג ההשוואה">
            {(
              [
                ["pdf", "חשבוניות PDF"],
                ["excel", "דוחות אקסל"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                className={`mode-switch__option ${mode === value ? "is-on" : ""}`}
                onClick={() => switchMode(value)}
                disabled={phase === "extracting"}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {mode === "excel" ? (
          <section className="hero-copy">
            <h1>השוואת דוח ספק מול {customer.displayName}</h1>
            <p>
              העלו את דוח הקליטה של {customer.displayName} ואת דוח המכירות של הספק (קובצי אקסל). השורות
              מוצמדות בתוך כל מגדל לפי תעודה, תאריך, פריט ומשקל — כולל שקילות שמתחברות למכירה אחת — והפערים
              מוצגים לפי סיבה.
            </p>
          </section>
        ) : (
          <section className="hero-copy">
            <h1>השוואת חשבונית ספק מול {customer.displayName}</h1>
            <p>
              העלו את חשבונית {customer.displayName} ואת חשבונית הספק. כל שורה של הספק מוצמדת לשורות
              המתאימות לפי תעודה, תאריך, פריט, משקל ומחיר — והפערים מוצגים לפי סיבה.
            </p>
          </section>
        )}

        <div className="upload-grid">
          <FileDropZone
            key={`own-${mode}`}
            label={mode === "excel" ? `דוח ${customer.displayName}` : `חשבונית ${customer.displayName}`}
            hint={mode === "excel" ? "דוח קליטה: מגדל, תאריך, אסמכתא, תוצרת, משקל נטו, מחיר" : customer.ownDocument.label}
            file={ownFile}
            onFile={pick(setOwnFile)}
            accent="ours"
            kind={mode}
          />
          <FileDropZone
            key={`supplier-${mode}`}
            label={mode === "excel" ? "דוח ספק" : "חשבונית ספק"}
            hint={mode === "excel" ? "דוח מכירות לפי מגדל: תעודת משלוח, מגדל, תאור, משקל ומחיר מכירה" : "חשבונית מס מרכזת של הספק"}
            file={supplierFile}
            onFile={pick(setSupplierFile)}
            accent="supplier"
            kind={mode}
          />
        </div>

        <div className="actions">
          <button type="button" className="btn btn--primary" disabled={!canCompare} onClick={handleCompare}>
            {phase === "extracting" || isPending ? "משווה…" : mode === "excel" ? "השוואת הדוחות" : "השוואת החשבוניות"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={handleReset} disabled={phase === "extracting"}>
            איפוס
          </button>
          {phase === "extracting" && (
            <span className="actions__status" role="status">
              {scanProgress
                ? `קורא חשבונית סרוקה (זיהוי תווים)… עמוד ${Math.min(scanProgress.done + 1, scanProgress.total)} מתוך ${scanProgress.total}`
                : "קורא את הקבצים…"}
            </span>
          )}
        </div>

        {error && (
          <div className="banner banner--error" role="alert">
            <strong>ההשוואה נכשלה</strong>
            <p>{error}</p>
          </div>
        )}

        {result && <ReconciliationView key={result.run} extraction={result.extraction} result={result.reconciliation} />}
      </main>

      <footer className="site-foot">
        <span>הצמדה דטרמיניסטית · ללא AI</span>
        <span>הקבצים לא יוצאים מהדפדפן</span>
        <span className="site-foot__version">
          גרסה <bdi>{__APP_VERSION__} ({__APP_COMMIT__})</bdi> · תצורה <bdi>{customer.configVersion}</bdi>
        </span>
      </footer>
    </div>
  );
}
