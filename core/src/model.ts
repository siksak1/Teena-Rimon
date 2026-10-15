/**
 * Data model shared by the parsers (in the browser) and the
 * reconciliation engine. Dates are ISO `YYYY-MM-DD`; money is in ILS.
 */

/** One item row on the supplier's consolidated invoice. */
export type SupplierLine = {
  id: string;
  page: number;
  date: string | null;
  /** Supplier delivery document, e.g. "SH2610231" / "2SH2605495". */
  docNumber: string | null;
  /** Booklet reference ("תעודה מפנקס" / "מספר פנקס"); often what the wholesaler records. */
  bookRef: string | null;
  description: string;
  /** Variety column (Granot "זן"); empty when the supplier has none. */
  variety: string;
  sku: string | null;
  packages: number | null;
  quantity: number;
  unit: string;
  unitPrice: number;
  /** Fraction, e.g. 0.12. Zero when the line carries no discount. */
  discountPct: number;
  /** Line total as printed — already after the line discount. */
  lineTotal: number;
  /**
   * Scanned invoices only: fields the OCR read but could not confirm (the
   * row's arithmetic and the printed column totals don't add up), e.g.
   * ["quantity", "lineTotal"]. Absent when everything checked out.
   */
  ocrUncertain?: (keyof SupplierLine)[];
  /** Excel reports only: the grower the row belongs to (one report covers many growers). */
  grower?: string;
};

export type SupplierInvoice = {
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  lines: SupplierLine[];
  /** "סה"כ כללי" of the item table, when printed. */
  printedItemsTotal: number | null;
  /** Read from a scanned image by OCR rather than from the PDF's text. */
  scanned?: true;
  /** The supplier's VAT number, when printed. */
  vatId?: string | null;
  /**
   * Read by a generic parser (any AGROLINE supplier, or the table parser)
   * rather than one written for this supplier.
   */
  generic?: "agroline" | "table";
  warnings: string[];
};

/**
 * One row on the wholesaler's own document — the side every supplier invoice
 * is checked against (Teena-Rimon: the AGROLINE draft, "חשבונית טיוטה").
 */
export type OwnLine = {
  id: string;
  page: number;
  date: string | null;
  /** The wholesaler's own document number, e.g. "23134". */
  ownDocNumber: string;
  /** The supplier reference the wholesaler's clerk typed in (book ref or SH digits). */
  supplierRef: string;
  product: string;
  size: string;
  packageType: string;
  packages: number | null;
  quantity: number;
  unitPrice: number;
  /** Printed amount — before the commercial discount. */
  lineTotal: number;
  /** Excel reports only: the grower the row belongs to. */
  grower?: string;
};

export type OwnInvoice = {
  documentNumber: string;
  /** Supplier invoice number this document is issued against ("כנגד חשבונית"). */
  againstInvoice: string | null;
  lines: OwnLine[];
  printedGrossTotal: number | null;
  /** Who the document is addressed to ("לכבוד:"): the supplier, as the wholesaler names it. */
  counterparty?: { name: string; vatId: string | null };
  commercialDiscount: number;
  /** commercialDiscount / gross, e.g. 0.12. */
  discountPct: number;
  warnings: string[];
};

export type ExtractionResult = {
  supplier: SupplierInvoice;
  own: OwnInvoice;
  meta: {
    ownFileName: string;
    supplierFileName: string;
    /**
     * "excel": two spreadsheet reports covering many growers over a period,
     * with no discount and no printed totals (see `extractExcel`). Absent for PDFs.
     */
    format?: "excel";
  };
};

/* ------------------------------------------------------------------ */
/* Reconciliation output                                               */
/* ------------------------------------------------------------------ */

export type GapFlag =
  | "quantity"
  | "packages"
  | "price"
  | "discount"
  | "name"
  | "doc_ref"
  | "arithmetic";

export type MatchGroup = {
  id: string;
  supplierLines: SupplierLine[];
  ownLines: OwnLine[];
  /** Supplier net is printed; own net = gross × (1 − own discount). */
  supplierNet: number;
  ownNet: number;
  /** ownNet − supplierNet */
  netDiff: number;
  quantityDiff: number;
  packagesDiff: number | null;
  /** Own date minus supplier date, in days. */
  dateDelta: number | null;
  flags: GapFlag[];
  /** Human-readable (Hebrew) reasons, one per detected gap. */
  notes: string[];
  score: number;
};

export type ReconciliationResult = {
  groups: MatchGroup[];
  supplierOnly: SupplierLine[];
  ownOnly: OwnLine[];
  offset: {
    /** True when net item totals are equal, so price/quantity gaps cancel out. */
    applies: boolean;
    groups: MatchGroup[];
  };
  totals: {
    supplierNet: number;
    ownGross: number;
    ownDiscountPct: number;
    ownNet: number;
    /** ownNet − supplierNet */
    diff: number;
  };
  warnings: string[];
  /** Unknown name tokens seen on matched rows — candidates for the dictionary. */
  dictionarySuggestions: string[];
};
