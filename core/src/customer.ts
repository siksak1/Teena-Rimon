import type { NameDictionary } from "./reconcile/names/dictionary.js";

/**
 * Per-customer settings (`customers/<slug>/config.json`). The engine and the
 * parsers are shared; everything that differs between wholesalers lives here.
 */
export type CustomerConfig = {
  slug: string;
  /** Bumped on every change to this file; shown in the app footer. */
  configVersion: number;
  /** The wholesaler's name as shown in the UI and in gap notes, e.g. "תאנה ורימון". */
  displayName: string;
  /** Short form for narrow table cells, e.g. 'ת"ר'. */
  shortName: string;
  /** The wholesaler's own document — the side every supplier invoice is checked against. */
  ownDocument: {
    /** Parser id from `OWN_DOCUMENT_PARSERS`, e.g. "agroline-draft". */
    format: string;
    /** What the customer calls it, for the upload hint and error messages. */
    label: string;
  };
  /** Supplier fields the clerk may have typed into the own document's reference ("אסמכתא"). */
  referenceRules: ReferenceRule[];
  tolerances: Tolerances;
  /**
   * "invoice-wide": when the net item totals are equal, price/weight gaps are
   * shown as offsetting each other. "off": every gap stays in the main table.
   */
  offsetting: "invoice-wide" | "off";
  /** Added to the shared product dictionary (merged, not replaced). */
  dictionary?: Partial<NameDictionary>;
};

export type ReferenceRule =
  /** The supplier's booklet number ("תעודה מפנקס" / "מספר פנקס"). */
  | "bookRef"
  /** The digits of the supplier's delivery document: "SH2610231" → "2610231". */
  | "docNumber";

export type Tolerances = {
  /** A row pair is rejected only when BOTH weight and price differ by more than this fraction. */
  rejectRelativeDiff: number;
  /** Largest number of rows on the "many" side of a group (1:k or k:1). */
  maxGroupSize: number;
  /** Multi-row groups must add up to the same weight within this many kg. */
  sumToleranceKg: number;
  /** Rows (and documents) more than this many days apart are never matched. */
  dateWindowDays: number;
  /** Net item totals within this many shekels count as equal (for offsetting). */
  offsetToleranceNis: number;
  /** Rounding slack, in shekels, when checking quantity × price = line total. */
  arithmeticTolerance: number;
};
