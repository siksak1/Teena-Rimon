import { useRef, useState, useTransition } from "react";
import { extractInvoices, ExtractApiError } from "./api/extract";
import { compareInvoices } from "./lib/compare";
import { FileDropZone } from "./components/FileDropZone";
import { DiscrepancyDashboard } from "./components/DiscrepancyDashboard";
import type { ComparisonResult } from "./types/invoice";
import "./App.css";

type UiPhase = "idle" | "extracting" | "ready" | "error";

export default function App() {
  const [ourFile, setOurFile] = useState<File | null>(null);
  const [supplierFile, setSupplierFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const abortRef = useRef<AbortController | null>(null);

  const canCompare = Boolean(ourFile && supplierFile) && phase !== "extracting";

  async function handleCompare() {
    if (!ourFile || !supplierFile) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("extracting");
    setError(null);

    try {
      // Backend returns RAW JSON only (mock in development)
      const extraction = await extractInvoices(
        ourFile,
        supplierFile,
        controller.signal,
      );

      // All deterministic logic stays on the client
      startTransition(() => {
        const comparison = compareInvoices(extraction);
        setResult(comparison);
        setPhase("ready");
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const message =
        err instanceof ExtractApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong while extracting invoices.";
      setError(message);
      setPhase("error");
      setResult(null);
    }
  }

  function handleReset() {
    abortRef.current?.abort();
    setOurFile(null);
    setSupplierFile(null);
    setResult(null);
    setError(null);
    setPhase("idle");
  }

  return (
    <div className="app">
      <div className="atmosphere" aria-hidden />

      <header className="brand-bar">
        <div className="brand">
          <span className="brand__mark" aria-hidden />
          <div>
            <p className="brand__name">LedgerMatch</p>
            <p className="brand__tag">Invoice reconciliation</p>
          </div>
        </div>
        <p className="brand-bar__note">
          AI extracts · browser compares · mock mode in development
        </p>
      </header>

      <main className="shell">
        <section className="hero-copy">
          <h1>Reconcile two invoices in one pass</h1>
          <p>
            Drop your internal invoice beside the supplier PDF. Names are
            normalized locally, quantities and prices are diffed deterministically
            — the API only returns structured extraction JSON.
          </p>
        </section>

        <div className="upload-grid">
          <FileDropZone
            label="Our invoice"
            hint="Internal / expected amounts"
            file={ourFile}
            onFile={(f) => {
              setOurFile(f);
              setResult(null);
              setError(null);
              setPhase("idle");
            }}
            accent="ours"
          />
          <FileDropZone
            label="Supplier invoice"
            hint="Vendor bill to verify"
            file={supplierFile}
            onFile={(f) => {
              setSupplierFile(f);
              setResult(null);
              setError(null);
              setPhase("idle");
            }}
            accent="supplier"
          />
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={!canCompare}
            onClick={handleCompare}
          >
            {phase === "extracting" || isPending ? "Comparing…" : "Compare invoices"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={handleReset}
            disabled={phase === "extracting"}
          >
            Reset
          </button>
          {phase === "extracting" && (
            <span className="actions__status" role="status">
              Extracting structured data…
            </span>
          )}
        </div>

        {error && (
          <div className="banner banner--error" role="alert">
            <strong>Extraction failed</strong>
            <p>{error}</p>
          </div>
        )}

        {phase === "idle" && !result && ourFile && supplierFile && (
          <p className="hint-line">
            Ready — in development the API returns mock line items instantly so
            you can validate the comparison engine for free.
          </p>
        )}

        {result && <DiscrepancyDashboard result={result} />}
      </main>

      <footer className="site-foot">
        <span>Frontend-owned mapping dictionary &amp; diffs</span>
        <span>Lambda-ready `/api/extract` bridge</span>
      </footer>
    </div>
  );
}
