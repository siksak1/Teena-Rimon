import { normalizeProductName } from "./normalize";
import type {
  ComparisonResult,
  ComparisonSummary,
  ExtractionResult,
  InvoiceItem,
  LineDiscrepancy,
  MatchStatus,
} from "../types/invoice";

/** Absolute float tolerance for money / weight equality. */
const EPS = 0.01;

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

function diff(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a == null || b == null) return null;
  return Number((b - a).toFixed(4));
}

function classify(
  our: InvoiceItem | null,
  supplier: InvoiceItem | null,
): MatchStatus {
  if (our && !supplier) return "our_only";
  if (!our && supplier) return "supplier_only";
  if (!our || !supplier) return "our_only";

  const qtyOk = nearlyEqual(our.quantity, supplier.quantity);
  const priceOk = nearlyEqual(our.unitPrice, supplier.unitPrice);

  if (qtyOk && priceOk) return "match";
  if (!qtyOk && !priceOk) return "both_mismatch";
  if (!priceOk) return "price_mismatch";
  return "quantity_mismatch";
}

type Bucket = {
  canonicalName: string;
  ourName: string | null;
  supplierName: string | null;
  our: InvoiceItem | null;
  supplier: InvoiceItem | null;
};

/**
 * Deterministic comparison engine — runs entirely in the browser.
 * Takes raw extraction JSON, normalizes names, matches rows, computes diffs.
 */
export function compareInvoices(extraction: ExtractionResult): ComparisonResult {
  const buckets = new Map<string, Bucket>();

  for (const item of extraction.ourInvoice.items) {
    const key = normalizeProductName(item.name);
    const existing = buckets.get(key);
    if (existing) {
      existing.our = item;
      existing.ourName = item.name;
    } else {
      buckets.set(key, {
        canonicalName: key,
        ourName: item.name,
        supplierName: null,
        our: item,
        supplier: null,
      });
    }
  }

  for (const item of extraction.supplierInvoice.items) {
    const key = normalizeProductName(item.name);
    const existing = buckets.get(key);
    if (existing) {
      existing.supplier = item;
      existing.supplierName = item.name;
    } else {
      buckets.set(key, {
        canonicalName: key,
        ourName: null,
        supplierName: item.name,
        our: null,
        supplier: item,
      });
    }
  }

  const rows: LineDiscrepancy[] = [];
  let matches = 0;
  let priceIssues = 0;
  let quantityIssues = 0;
  let unmatched = 0;

  let index = 0;
  for (const bucket of buckets.values()) {
    const status = classify(bucket.our, bucket.supplier);

    if (status === "match") matches += 1;
    if (status === "price_mismatch" || status === "both_mismatch") priceIssues += 1;
    if (status === "quantity_mismatch" || status === "both_mismatch") {
      quantityIssues += 1;
    }
    if (status === "our_only" || status === "supplier_only") unmatched += 1;

    rows.push({
      id: `${index++}-${bucket.canonicalName}`,
      status,
      canonicalName: bucket.canonicalName,
      ourName: bucket.ourName,
      supplierName: bucket.supplierName,
      our: bucket.our,
      supplier: bucket.supplier,
      quantityDiff: diff(bucket.our?.quantity, bucket.supplier?.quantity),
      unitPriceDiff: diff(bucket.our?.unitPrice, bucket.supplier?.unitPrice),
      lineTotalDiff: diff(bucket.our?.lineTotal, bucket.supplier?.lineTotal),
    });
  }

  // Surface issues first, then matches
  const severity: Record<MatchStatus, number> = {
    both_mismatch: 0,
    price_mismatch: 1,
    quantity_mismatch: 2,
    our_only: 3,
    supplier_only: 4,
    match: 5,
  };
  rows.sort((a, b) => severity[a.status] - severity[b.status]);

  const summary: ComparisonSummary = {
    totalRows: rows.length,
    matches,
    priceIssues,
    quantityIssues,
    unmatched,
    ourGrandTotal: extraction.ourInvoice.grandTotal,
    supplierGrandTotal: extraction.supplierInvoice.grandTotal,
    grandTotalDiff: Number(
      (
        extraction.supplierInvoice.grandTotal - extraction.ourInvoice.grandTotal
      ).toFixed(4),
    ),
    currency: extraction.ourInvoice.currency || "ILS",
  };

  return { rows, summary, extraction };
}
