import { useRef, useState, useTransition } from "react";
import type { ExtractionResult, ReconciliationResult } from "@core/model.js";
import { reconcile } from "@core/reconcile/reconcile.js";
import customer from "@customer-config";
import { extractInvoices } from "./api/extract";
import { FileDropZone } from "./components/FileDropZone";
import { ReconciliationView } from "./components/results/ReconciliationView";
import "./App.css";
import "./components/results/results.css";

type UiPhase = "idle" | "extracting" | "ready" | "error";

export default function App() {
  const [ownFile, setOwnFile] = useState<File | null>(null);
  const [supplierFile, setSupplierFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    extraction: ExtractionResult;
    reconciliation: ReconciliationResult;
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

    try {
      const extraction = await extractInvoices(ownFile, supplierFile);
      // Parsing can't be cancelled; ignore results that arrive after a reset or a newer run.
      if (controller.signal.aborted) return;
      startTransition(() => {
        setResult({ extraction, reconciliation: reconcile(extraction, customer) });
        setPhase("ready");
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : "אירעה שגיאה בקריאת החשבוניות.";
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
          הקבצים נקראים בדפדפן בלבד · ספקים נתמכים: גרנות, שיווק החוף, ד. חי, אחים מנשרי, החקלאים, גליל שוק מקומי, שיווק העשור, בננות כרמל
        </p>
      </header>

      <main className="shell">
        <section className="hero-copy">
          <h1>השוואת חשבונית ספק מול {customer.displayName}</h1>
          <p>
            העלו את חשבונית {customer.displayName} ואת חשבונית הספק. כל שורה של הספק מוצמדת לשורות
            המתאימות לפי תעודה, תאריך, פריט, משקל ומחיר — והפערים מוצגים לפי סיבה.
          </p>
        </section>

        <div className="upload-grid">
          <FileDropZone
            label={`חשבונית ${customer.displayName}`}
            hint={customer.ownDocument.label}
            file={ownFile}
            onFile={pick(setOwnFile)}
            accent="ours"
          />
          <FileDropZone
            label="חשבונית ספק"
            hint="חשבונית מס מרכזת של הספק"
            file={supplierFile}
            onFile={pick(setSupplierFile)}
            accent="supplier"
          />
        </div>

        <div className="actions">
          <button type="button" className="btn btn--primary" disabled={!canCompare} onClick={handleCompare}>
            {phase === "extracting" || isPending ? "משווה…" : "השוואת החשבוניות"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={handleReset} disabled={phase === "extracting"}>
            איפוס
          </button>
          {phase === "extracting" && (
            <span className="actions__status" role="status">
              קורא את הקבצים…
            </span>
          )}
        </div>

        {error && (
          <div className="banner banner--error" role="alert">
            <strong>ההשוואה נכשלה</strong>
            <p>{error}</p>
          </div>
        )}

        {result && <ReconciliationView extraction={result.extraction} result={result.reconciliation} />}
      </main>

      <footer className="site-foot">
        <span>הצמדה דטרמיניסטית · ללא AI</span>
        <span>הקבצים לא יוצאים מהדפדפן</span>
        <span className="site-foot__version">
          גרסה <bdi>{__APP_VERSION__} ({__APP_COMMIT__})</bdi>
        </span>
      </footer>
    </div>
  );
}
