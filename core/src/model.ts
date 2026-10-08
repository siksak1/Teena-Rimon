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
};

export type SupplierInvoice = {
  supplierId: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  lines: SupplierLine[];
  /** "סה"כ כללי" of the item table, when printed. */
  printedItemsTotal: number | null;
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
};

export type OwnInvoice = {
  documentNumber: string;
  /** Supplier invoice number this document is issued against ("כנגד חשבונית"). */
  againstInvoice: string | null;
  lines: OwnLine[];
  printedGrossTotal: number | null;
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
