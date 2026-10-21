import { z } from "zod";
import type { HeaderField } from "./genericHeaders.js";

// This schema runs in the browser, whose CSP forbids eval: no compiled validators (zod would probe for eval).
z.config({ jitless: true });

const headerFields = [
  "netPrice",
  "bookRef",
  "total",
  "discount",
  "unitPrice",
  "packages",
  "quantity",
  "date",
  "doc",
  "sku",
  "packageType",
  "pallet",
  "unit",
  "variety",
  "description",
] as const satisfies readonly HeaderField[];

/**
 * The layout of one supplier's invoices, learned once (written by the AI the
 * first time the supplier's invoice could not be read) and stored by VAT
 * number. It holds labels as printed, never invoice data. The generic table
 * parser reads the supplier's next invoices with it (`parseWithProfile`): the
 * labels narrow its guesses, and the lines must still add up to the printed
 * total, so a profile that no longer fits makes it refuse, never guess.
 */
export const supplierProfileSchema = z.strictObject({
  /** The supplier's VAT / company number as printed (digits only). */
  vatId: z.string().regex(/^\d{8,9}$/),
  name: z.string().min(1).max(100),
  /** Bumped each time the profile is learned again (the layout changed). */
  version: z.number().int().min(1),
  /** ISO timestamp. */
  createdAt: z.string(),
  /** Learned from a digital PDF, or from a scan read by OCR. */
  source: z.enum(["pdf", "scan"]),
  /** Column headers as printed → the field they hold. Overrides the shared dictionary. */
  headers: z.record(z.string().min(1).max(60), z.enum(headerFields)),
  /** Headers of the columns that multiply out: quantity × unit price (− discount) = line total. */
  amountColumns: z.strictObject({
    quantity: z.string().min(1).max(60),
    unitPrice: z.string().min(1).max(60),
    total: z.string().min(1).max(60),
    discount: z.string().min(1).max(60).optional(),
  }),
  /** Label of the row that prints the items total, e.g. "סה\"כ לפני מע\"מ". */
  totalLabel: z.string().min(1).max(60),
  /** Label printed beside the invoice number, e.g. "חשבונית מס מספר". */
  invoiceNumberLabel: z.string().min(1).max(60).optional(),
  /** Label printed beside the invoice date. */
  dateLabel: z.string().min(1).max(60).optional(),
  /** Where the discount is printed: on each row, once in the footer, as a second (net) price column, or nowhere. */
  discountSource: z.enum(["row", "footer", "netPriceColumn", "none"]),
  /** Units printed beside amounts that the shared list does not know, e.g. "₪", "ארגז". */
  amountUnits: z.array(z.string().min(1).max(10)).max(10).optional(),
  /** Item-table rows that are not items (pallets, deposits, packaging), as regular expressions. */
  skipRows: z.array(z.string().min(1).max(80)).max(10).optional(),
});

export type SupplierProfile = z.infer<typeof supplierProfileSchema>;

/** Validate a stored or AI-written profile; null when it doesn't fit the schema. */
export function readProfile(raw: unknown): SupplierProfile | null {
  const result = supplierProfileSchema.safeParse(raw);
  if (!result.success) return null;
  for (const pattern of result.data.skipRows ?? []) {
    try {
      new RegExp(pattern);
    } catch {
      return null;
    }
  }
  return result.data;
}

/** Candidate VAT numbers in a document's text: nine-digit numbers (eight for old ones). */
export function vatCandidates(text: string): string[] {
  return [...new Set([...text.matchAll(/(?<!\d)(\d{8,9})(?!\d)/g)].map((m) => m[1]))];
}
