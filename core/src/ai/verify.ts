import { z } from "zod";
import type { SupplierInvoice, SupplierLine } from "../model.js";
import { parseWithProfile, readAmount } from "../parsers/generic.js";
import { readProfile, type SupplierProfile } from "../parsers/profile.js";
import type { PdfDocument } from "../pdf/layout.js";
import { parseDate, round2 } from "../pdf/text.js";

/**
 * What the AI returns for one supplier invoice (the backend asks for exactly
 * this shape with structured outputs, and validates it again here): the
 * invoice as read, and the supplier's layout for next time. Nothing the AI
 * says is taken on trust; `verifyAiReading` checks it against the PDF.
 */
const nullableString = z.string().nullable();
export const aiReadingSchema = z.object({
  supplierName: z.string(),
  vatId: nullableString,
  invoiceNumber: z.string(),
  /** DD/MM/YYYY as printed, or null. */
  invoiceDate: nullableString,
  printedItemsTotal: z.number().nullable(),
  lines: z.array(
    z.object({
      page: z.number().int(),
      date: nullableString,
      docNumber: nullableString,
      bookRef: nullableString,
      description: z.string(),
      sku: nullableString,
      packages: z.number().nullable(),
      quantity: z.number(),
      unit: z.string(),
      unitPrice: z.number(),
      discountPct: z.number(),
      lineTotal: z.number(),
    }),
  ),
  profile: z.object({
    headers: z.array(z.object({ label: z.string(), field: z.string() })),
    amountColumns: z.object({ quantity: z.string(), unitPrice: z.string(), total: z.string(), discount: nullableString }),
    totalLabel: z.string(),
    invoiceNumberLabel: nullableString,
    dateLabel: nullableString,
    discountSource: z.string(),
    amountUnits: z.array(z.string()),
    skipRows: z.array(z.string()),
  }),
});
export type AiReading = z.infer<typeof aiReadingSchema>;

export type VerifiedReading = {
  invoice: SupplierInvoice;
  /** Every row multiplies out, every amount is printed on the invoice, and the rows add up to the printed total. */
  verified: boolean;
  /** The layout to keep for this supplier: only when it reads the same lines from the invoice by itself. */
  profile: SupplierProfile | null;
};

const ROW_TOLERANCE = 0.05;
const TOTAL_TOLERANCE = 0.06;

/**
 * Check an AI reading against the invoice's own text (`doc`: the PDF's text,
 * or what OCR read from a scan):
 *
 * - each row: quantity × price × (1 − discount) = total;
 * - each amount the AI gives (quantity, price, total) is printed on the
 *   invoice — a digital PDF's text is exact, so an amount found nowhere was
 *   invented or misread (skipped for scans, whose OCR text may itself be off);
 * - the rows add up to the items total, and that total is printed.
 *
 * Rows that fail are kept and marked (`ocrUncertain`), so the clerk sees them
 * in the comparison; `verified` is false. The profile is kept only if the
 * generic parser, given it, reads the same lines from `doc` without the AI.
 */
export function verifyAiReading(
  reading: AiReading,
  doc: PdfDocument,
  options: { scanned: boolean; vatHint: string | null; now?: Date },
): VerifiedReading {
  const printed = printedValues(doc);
  const isPrinted = (value: number) => options.scanned || printed.some((p) => Math.abs(p - Math.abs(value)) <= 0.005);

  let unconfirmed = 0;
  const lines: SupplierLine[] = reading.lines.map((l, i) => {
    const line: SupplierLine = {
      id: `S${i + 1}`,
      page: l.page,
      date: parseDate(l.date ?? undefined) ?? null,
      docNumber: blank(l.docNumber),
      bookRef: blank(l.bookRef),
      description: l.description.trim(),
      variety: "",
      sku: blank(l.sku),
      packages: l.packages,
      quantity: l.quantity,
      unit: l.unit.trim(),
      unitPrice: l.unitPrice,
      discountPct: Math.round(l.discountPct * 10000) / 10000,
      lineTotal: round2(l.lineTotal),
    };
    const uncertain = new Set<keyof SupplierLine>();
    const expected = line.quantity * line.unitPrice * (1 - line.discountPct);
    if (Math.abs(expected - line.lineTotal) > ROW_TOLERANCE + 0.0001 * Math.abs(line.lineTotal)) {
      uncertain.add("quantity").add("unitPrice").add("lineTotal");
    }
    if (!isPrinted(line.quantity)) uncertain.add("quantity");
    if (line.unitPrice !== 0 && !isPrinted(line.unitPrice)) uncertain.add("unitPrice");
    // A total printed before a footer discount is restated net: its gross amount is what is printed.
    if (!isPrinted(line.lineTotal) && !isPrinted(round2(line.quantity * line.unitPrice))) uncertain.add("lineTotal");
    if (uncertain.size > 0) {
      line.ocrUncertain = [...uncertain];
      unconfirmed++;
    }
    return line;
  });

  const sum = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const total = reading.printedItemsTotal;
  // The items total is printed, or (a discount applied once in the footer) the gross total before it.
  const gross = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
  const totalHolds = total != null && Math.abs(sum - total) <= TOTAL_TOLERANCE && (isPrinted(total) || isPrinted(gross));
  const verified = lines.length > 0 && unconfirmed === 0 && totalHolds;

  const warnings = [
    "החשבונית נקראה בעזרת AI, כי אף קורא אחר לא הצליח לקרוא אותה. " +
      (verified
        ? "כל השורות אומתו (כמות × מחיר = סה\"כ, והסכומים מודפסים בחשבונית) וסכומן תואם לסה\"כ המודפס"
        : "חלק מהנתונים לא אומתו מול החשבונית ומסומנים לבדיקה"),
  ];
  if (unconfirmed > 0) warnings.push(`${unconfirmed} שורות לא אומתו מול החשבונית ומסומנות ⚠ לבדיקה`);
  if (!totalHolds) {
    warnings.push(
      total == null
        ? "לא נמצא סה\"כ פריטים מודפס לבדיקת השורות"
        : `סכום השורות (${sum}) אינו תואם לסה"כ המודפס (${total}) — ייתכן שחסרות שורות`,
    );
  }

  const vatId = digitsOnly(reading.vatId) ?? options.vatHint;
  const invoice: SupplierInvoice = {
    supplierId: vatId ? `ai-${vatId}` : "ai",
    supplierName: reading.supplierName.trim() || "ספק",
    vatId,
    invoiceNumber: reading.invoiceNumber.trim(),
    invoiceDate: parseDate(reading.invoiceDate ?? undefined) ?? null,
    lines,
    printedItemsTotal: total,
    warnings,
    generic: "ai",
  };

  return { invoice, verified, profile: verified && vatId ? learnedProfile(reading, doc, invoice, vatId, options) : null };
}

/** The AI's layout as a profile, kept only if it reads the very same lines from the invoice. */
function learnedProfile(
  reading: AiReading,
  doc: PdfDocument,
  invoice: SupplierInvoice,
  vatId: string,
  options: { scanned: boolean; now?: Date },
): SupplierProfile | null {
  const p = reading.profile;
  const profile = readProfile({
    vatId,
    name: invoice.supplierName.slice(0, 100),
    version: 1,
    createdAt: (options.now ?? new Date()).toISOString(),
    source: options.scanned ? "scan" : "pdf",
    headers: Object.fromEntries(p.headers.map((h) => [h.label.trim(), h.field])),
    amountColumns: {
      quantity: p.amountColumns.quantity,
      unitPrice: p.amountColumns.unitPrice,
      total: p.amountColumns.total,
      ...(p.amountColumns.discount ? { discount: p.amountColumns.discount } : {}),
    },
    totalLabel: p.totalLabel,
    ...(p.invoiceNumberLabel ? { invoiceNumberLabel: p.invoiceNumberLabel } : {}),
    ...(p.dateLabel ? { dateLabel: p.dateLabel } : {}),
    discountSource: p.discountSource,
    ...(p.amountUnits.length > 0 ? { amountUnits: p.amountUnits } : {}),
    ...(p.skipRows.length > 0 ? { skipRows: p.skipRows } : {}),
  });
  if (!profile) return null;
  try {
    return sameLines(parseWithProfile(doc, profile).lines, invoice.lines) ? profile : null;
  } catch {
    return null;
  }
}

/** Same rows, in the same order, with the same amounts. */
export function sameLines(a: SupplierLine[], b: SupplierLine[]): boolean {
  const close = (x: number, y: number, tolerance: number) => Math.abs(x - y) <= tolerance;
  return (
    a.length === b.length &&
    a.every(
      (l, i) =>
        close(l.quantity, b[i].quantity, 0.005) &&
        close(l.unitPrice, b[i].unitPrice, 0.0005) &&
        close(l.lineTotal, b[i].lineTotal, 0.02) &&
        close(l.discountPct, b[i].discountPct, 0.0005),
    )
  );
}

/** Every amount printed on the invoice, including OCR's second readings. */
function printedValues(doc: PdfDocument): number[] {
  const values: number[] = [];
  for (const row of doc.rows) {
    for (const cell of row.cells) {
      for (const text of [cell.text, ...(cell.alternatives ?? []), ...cell.text.split(/\s+/)]) {
        const value = readAmount(text.replace(/[₪$]/g, "").trim());
        if (value != null) values.push(Math.abs(value));
      }
    }
  }
  return values;
}

function blank(value: string | null): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function digitsOnly(value: string | null): string | null {
  const digits = value?.replace(/\D/g, "");
  return digits && /^\d{8,9}$/.test(digits) ? digits : null;
}
