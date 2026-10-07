/**
 * Data model shared by the parsers (backend or browser) and the
 * reconciliation engine. Dates are ISO `YYYY-MM-DD`; money is in ILS.
 */

/** One item row on the supplier's consolidated invoice. */
export type SupplierLine = {
  id: string;
  page: number;
  date: string | null;
  /** Supplier delivery document, e.g. "SH2610231" / "2SH2605495". */
  docNumber: string | null;
  /** Booklet reference ("תעודה מפנקס" / "מספר פנקס"); often what Teena-Rimon records. */
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

/** One row on Teena-Rimon's AGROLINE draft ("חשבונית טיוטה"). */
export type TrLine = {
  id: string;
  page: number;
  date: string | null;
  /** Teena-Rimon's own document number, e.g. "23134". */
  trDocNumber: string;
  /** The supplier reference Teena-Rimon typed in (book ref or SH digits). */
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

export type TrInvoice = {
  draftNumber: string;
  /** Supplier invoice number this draft is issued against ("כנגד חשבונית"). */
  againstInvoice: string | null;
  lines: TrLine[];
  printedGrossTotal: number | null;
  commercialDiscount: number;
  /** commercialDiscount / gross, e.g. 0.12. */
  discountPct: number;
  warnings: string[];
};

export type ParseMode = "server" | "client";

export type ExtractionResult = {
  supplier: SupplierInvoice;
  teenaRimon: TrInvoice;
  meta: {
    parseMode: ParseMode;
    trFileName: string;
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
  trLines: TrLine[];
  /** Supplier net is printed; TR net = gross × (1 − TR discount). */
  supplierNet: number;
  trNet: number;
  /** trNet − supplierNet */
  netDiff: number;
  quantityDiff: number;
  packagesDiff: number | null;
  /** TR date minus supplier date, in days. */
  dateDelta: number | null;
  flags: GapFlag[];
  /** Human-readable (Hebrew) reasons, one per detected gap. */
  notes: string[];
  score: number;
};

export type ReconciliationResult = {
  groups: MatchGroup[];
  supplierOnly: SupplierLine[];
  trOnly: TrLine[];
  offset: {
    /** True when net item totals are equal, so price/quantity gaps cancel out. */
    applies: boolean;
    groups: MatchGroup[];
  };
  totals: {
    supplierNet: number;
    trGross: number;
    trDiscountPct: number;
    trNet: number;
    /** trNet − supplierNet */
    diff: number;
  };
  warnings: string[];
  /** Unknown name tokens seen on matched rows — candidates for the dictionary. */
  dictionarySuggestions: string[];
};
