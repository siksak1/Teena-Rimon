import type { ComparisonResult, LineDiscrepancy, MatchStatus } from "../types/invoice";

type Props = {
  result: ComparisonResult;
};

const STATUS_LABEL: Record<MatchStatus, string> = {
  match: "Match",
  price_mismatch: "Price",
  quantity_mismatch: "Quantity",
  both_mismatch: "Price & Qty",
  our_only: "Our only",
  supplier_only: "Supplier only",
};

function money(value: number | null | undefined, currency: string): string {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

function qty(value: number | null | undefined, unit?: string): string {
  if (value == null) return "—";
  const n = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 3 }).format(
    value,
  );
  return unit ? `${n} ${unit}` : n;
}

function signed(value: number | null, currency?: string): string {
  if (value == null) return "—";
  const prefix = value > 0 ? "+" : "";
  if (currency) return `${prefix}${money(value, currency)}`;
  return `${prefix}${new Intl.NumberFormat("he-IL", { maximumFractionDigits: 3 }).format(value)}`;
}

function rowClass(status: MatchStatus): string {
  switch (status) {
    case "match":
      return "row-match";
    case "price_mismatch":
      return "row-warn";
    case "quantity_mismatch":
      return "row-warn";
    case "both_mismatch":
      return "row-danger";
    case "our_only":
    case "supplier_only":
      return "row-missing";
    default:
      return "";
  }
}

function NameCell({ row }: { row: LineDiscrepancy }) {
  const mapped =
    row.ourName &&
    row.supplierName &&
    row.ourName !== row.supplierName;

  return (
    <div className="name-cell" dir="auto">
      <strong>{row.canonicalName}</strong>
      {mapped && (
        <span className="name-cell__map">
          {row.ourName} ← {row.supplierName}
        </span>
      )}
      {!mapped && row.ourName !== row.canonicalName && row.ourName && (
        <span className="name-cell__map">our: {row.ourName}</span>
      )}
      {!mapped &&
        row.supplierName !== row.canonicalName &&
        row.supplierName && (
          <span className="name-cell__map">supplier: {row.supplierName}</span>
        )}
    </div>
  );
}

export function DiscrepancyDashboard({ result }: Props) {
  const { summary, rows, extraction } = result;
  const currency = summary.currency;

  return (
    <section className="dashboard" aria-label="Discrepancy dashboard">
      <header className="dashboard__header">
        <div>
          <p className="eyebrow">
            Comparison result
            {extraction.meta.mode === "mock" && (
              <span className="badge badge--mock">Mock extract</span>
            )}
          </p>
          <h2>Discrepancy dashboard</h2>
          <p className="dashboard__meta">
            {extraction.ourInvoice.invoiceNumber} vs{" "}
            {extraction.supplierInvoice.invoiceNumber} ·{" "}
            {extraction.ourInvoice.date}
          </p>
        </div>
      </header>

      <div className="summary-strip" role="list">
        <div className="summary-pill summary-pill--ok" role="listitem">
          <span>Matched</span>
          <strong>{summary.matches}</strong>
        </div>
        <div className="summary-pill summary-pill--warn" role="listitem">
          <span>Price issues</span>
          <strong>{summary.priceIssues}</strong>
        </div>
        <div className="summary-pill summary-pill--warn" role="listitem">
          <span>Qty issues</span>
          <strong>{summary.quantityIssues}</strong>
        </div>
        <div className="summary-pill summary-pill--miss" role="listitem">
          <span>Unmatched</span>
          <strong>{summary.unmatched}</strong>
        </div>
        <div className="summary-pill summary-pill--total" role="listitem">
          <span>Grand total Δ</span>
          <strong className={summary.grandTotalDiff === 0 ? "" : "is-hot"}>
            {signed(summary.grandTotalDiff, currency)}
          </strong>
        </div>
      </div>

      <div className="totals-bar">
        <div>
          <span>Our total</span>
          <strong>{money(summary.ourGrandTotal, currency)}</strong>
        </div>
        <div>
          <span>Supplier total</span>
          <strong>{money(summary.supplierGrandTotal, currency)}</strong>
        </div>
      </div>

      <div className="table-wrap">
        <table className="disc-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Product</th>
              <th>Our qty</th>
              <th>Supplier qty</th>
              <th>Δ qty</th>
              <th>Our price</th>
              <th>Supplier price</th>
              <th>Δ price</th>
              <th>Δ line</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={rowClass(row.status)}>
                <td>
                  <span className={`status-chip status-chip--${row.status}`}>
                    {STATUS_LABEL[row.status]}
                  </span>
                </td>
                <td>
                  <NameCell row={row} />
                </td>
                <td>{qty(row.our?.quantity, row.our?.unit)}</td>
                <td>{qty(row.supplier?.quantity, row.supplier?.unit)}</td>
                <td className={row.quantityDiff && row.quantityDiff !== 0 ? "is-hot" : ""}>
                  {signed(row.quantityDiff)}
                </td>
                <td>{money(row.our?.unitPrice, currency)}</td>
                <td>{money(row.supplier?.unitPrice, currency)}</td>
                <td className={row.unitPriceDiff && row.unitPriceDiff !== 0 ? "is-hot" : ""}>
                  {signed(row.unitPriceDiff, currency)}
                </td>
                <td className={row.lineTotalDiff && row.lineTotalDiff !== 0 ? "is-hot" : ""}>
                  {signed(row.lineTotalDiff, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
