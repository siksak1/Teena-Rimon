export type InvoiceItem = {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
};

export type Invoice = {
  invoiceNumber: string;
  date: string;
  vendorName: string;
  currency: string;
  items: InvoiceItem[];
  grandTotal: number;
};

export type ExtractionResult = {
  ourInvoice: Invoice;
  supplierInvoice: Invoice;
  meta: {
    mode: "mock" | "ai";
    ourFileName: string;
    supplierFileName: string;
  };
};

export type MatchStatus =
  | "match"
  | "price_mismatch"
  | "quantity_mismatch"
  | "both_mismatch"
  | "our_only"
  | "supplier_only";

export type LineDiscrepancy = {
  id: string;
  status: MatchStatus;
  canonicalName: string;
  ourName: string | null;
  supplierName: string | null;
  our: InvoiceItem | null;
  supplier: InvoiceItem | null;
  quantityDiff: number | null;
  unitPriceDiff: number | null;
  lineTotalDiff: number | null;
};

export type ComparisonSummary = {
  totalRows: number;
  matches: number;
  priceIssues: number;
  quantityIssues: number;
  unmatched: number;
  ourGrandTotal: number;
  supplierGrandTotal: number;
  grandTotalDiff: number;
  currency: string;
};

export type ComparisonResult = {
  rows: LineDiscrepancy[];
  summary: ComparisonSummary;
  extraction: ExtractionResult;
};
