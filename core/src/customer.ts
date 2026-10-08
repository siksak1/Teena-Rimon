import { z } from "zod";

/**
 * Per-customer settings (`customers/<slug>/config.json`). The engine and the
 * parsers are shared; everything that differs between wholesalers lives here.
 * Strict objects: a misspelt key fails validation instead of being ignored.
 */
const referenceRule = z.enum([
  /** The supplier's booklet number ("תעודה מפנקס" / "מספר פנקס"). */
  "bookRef",
  /** The digits of the supplier's delivery document: "SH2610231" → "2610231". */
  "docNumber",
]);

const tolerances = z.strictObject({
  /** A row pair is rejected only when BOTH weight and price differ by more than this fraction. */
  rejectRelativeDiff: z.number().positive().max(1),
  /** Largest number of rows on the "many" side of a group (1:k or k:1). */
  maxGroupSize: z.int().min(1).max(8),
  /** Multi-row groups must add up to the same weight within this many kg. */
  sumToleranceKg: z.number().nonnegative(),
  /** Rows (and documents) more than this many days apart are never matched. */
  dateWindowDays: z.int().nonnegative(),
  /** Net item totals within this many shekels count as equal (for offsetting). */
  offsetToleranceNis: z.number().nonnegative(),
  /** Rounding slack, in shekels, when checking quantity × price = line total. */
  arithmeticTolerance: z.number().nonnegative(),
});

/** Entries added to the shared product dictionary (see `NameDictionary`). */
const dictionaryExtension = z.strictObject({
  families: z.array(z.string()).optional(),
  familyAliases: z.record(z.string(), z.string()).optional(),
  cultivars: z
    .record(z.string(), z.strictObject({ family: z.string(), color: z.string().optional(), as: z.string().optional() }))
    .optional(),
  colors: z.record(z.string(), z.string()).optional(),
  grades: z.record(z.string(), z.string()).optional(),
  sizes: z.record(z.string(), z.string()).optional(),
  noise: z.array(z.string()).optional(),
});

export const customerConfigSchema = z.strictObject({
  /** Lowercase id, also the folder name under `customers/`. */
  slug: z.string().regex(/^[a-z0-9-]+$/),
  /** Bumped on every change to the config; shown in the app footer. */
  configVersion: z.int().positive(),
  /** The wholesaler's name as shown in the UI and in gap notes, e.g. "תאנה ורימון". */
  displayName: z.string().min(1),
  /** Short form for narrow table cells, e.g. 'ת"ר'. */
  shortName: z.string().min(1),
  /** The wholesaler's own document — the side every supplier invoice is checked against. */
  ownDocument: z.strictObject({
    /** Parser id from `OWN_DOCUMENT_PARSERS`, e.g. "agroline-draft". */
    format: z.string().min(1),
    /** What the customer calls it, for the upload hint and error messages. */
    label: z.string().min(1),
  }),
  /** Supplier parser ids (`SUPPLIER_PARSERS`) this customer gets; others are reported as unsupported. */
  suppliers: z.array(z.string().min(1)).min(1),
  /** Supplier fields the clerk may have typed into the own document's reference ("אסמכתא"). */
  referenceRules: z.array(referenceRule).min(1),
  tolerances,
  /**
   * "invoice-wide": when the net item totals are equal, price/weight gaps are
   * shown as offsetting each other. "off": every gap stays in the main table.
   */
  offsetting: z.enum(["invoice-wide", "off"]),
  /** Added to the shared product dictionary (merged, not replaced). */
  dictionary: dictionaryExtension.optional(),
});

export type CustomerConfig = z.infer<typeof customerConfigSchema>;
export type ReferenceRule = z.infer<typeof referenceRule>;
export type Tolerances = z.infer<typeof tolerances>;

/** Validate a parsed config.json; `source` names the file in the error. */
export function parseCustomerConfig(raw: unknown, source: string): CustomerConfig {
  const result = customerConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid customer config ${source}:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
