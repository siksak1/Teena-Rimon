import type { ExcludedRow, SupplierInvoice, SupplierLine } from "../model.js";
import type { PdfDocument } from "../pdf/layout.js";
import { round2 } from "../pdf/text.js";
import { documentDiscounts, findItemRows, readTable, type ItemRow } from "./generic.js";
import { PALLET_ROW } from "./genericHeaders.js";

/** A line total and the row it was printed on are the same amount within this. */
const ROW_TOLERANCE = 0.05;
/** Printed totals may differ from the line sum by per-line rounding. */
const TOTAL_TOLERANCE = 0.06;

export type ReadingCheck = {
  ok: boolean;
  /** Item rows printed on the invoice that no line of the reading accounts for. */
  uncovered: ItemRow[];
  /** Pallet and deposit rows: charged on the invoice, left out of the comparison. */
  excludedRows: ExcludedRow[];
  /** Why the reading was refused, for the clerk and for whoever fixes the reader. */
  reasons: string[];
};

/**
 * Check a reading of a digital invoice against the invoice itself, whatever
 * read it (a supplier's own parser, a generic one, a learned layout, the AI):
 *
 * - every row printed on the invoice whose amounts multiply out (quantity ×
 *   price × (1 − discount) = total, found by the generic parser's arithmetic,
 *   not by the reader) is one of the reading's lines, or a pallet / deposit
 *   row, which is listed apart;
 * - the invoice prints an items total, and the lines add up to it (with or
 *   without the pallet rows).
 *
 * A reader that fails is not trusted, however it was written: the next reader
 * in the chain gets the invoice.
 */
export function checkReading(doc: PdfDocument, invoice: SupplierInvoice): ReadingCheck {
  const rows = findItemRows(doc, documentDiscounts(doc)).rows;
  const pallets = rows.filter((r) => PALLET_ROW.test(r.row.text));
  const items = rows.filter((r) => !pallets.includes(r));

  // Each line accounts for one printed row: same page, same amount.
  const unused = [...invoice.lines];
  const uncovered = items.filter(({ row, math }) => {
    const i = unused.findIndex((l) => l.page === row.page && accountsFor(l, math.total.value));
    if (i === -1) return true;
    unused.splice(i, 1);
    return false;
  });

  const reasons: string[] = [];
  if (uncovered.length > 0) reasons.push(`${uncovered.length} שורות בחשבונית לא נקראו`);
  const sum = round2(invoice.lines.reduce((s, l) => s + l.lineTotal, 0));
  const palletTotal = round2(pallets.reduce((s, r) => s + r.math.total.value, 0));
  const printed = invoice.printedItemsTotal;
  // A discount applied line by line rounds each line to the agora: half an agora of drift per line.
  const tolerance = TOTAL_TOLERANCE + 0.005 * invoice.lines.filter((l) => l.discountPct !== 0).length;
  if (printed == null) {
    reasons.push('לא נמצא סה"כ מודפס לבדיקה');
  } else if (
    // The generic readers accept a total only after explaining any gap (rounding, a footer discount).
    !(invoice.generic === "table" || invoice.generic === "profile") &&
    Math.abs(sum - printed) > tolerance &&
    Math.abs(sum + palletTotal - printed) > tolerance &&
    !grossIsPrinted(doc, invoice.lines)
  ) {
    reasons.push(`סכום השורות (${sum}) שונה מהסה"כ המודפס (${printed})`);
  }

  return {
    ok: reasons.length === 0,
    uncovered,
    excludedRows: pallets.map(({ row, math }) => ({ page: row.page, text: row.text, total: math.total.value })),
    reasons,
  };
}

/**
 * Discounted lines whose amounts before the discount add up to a total the
 * invoice prints ("פדיון פטור"): some suppliers print a net total that is not
 * exactly that gross less the discount.
 */
function grossIsPrinted(doc: PdfDocument, lines: SupplierLine[]): boolean {
  if (!lines.some((l) => l.discountPct !== 0)) return false;
  const gross = round2(lines.reduce((s, l) => s + round2(l.lineTotal / (1 - l.discountPct)), 0));
  const printed = doc.rows.flatMap((r) => [...r.text.matchAll(/-?\d[\d,]*\.\d{2}/g)].map((m) => Number(m[0].replace(/,/g, ""))));
  return printed.some((p) => Math.abs(p - gross) <= TOTAL_TOLERANCE);
}

/**
 * A line is the row printed with `printed` as its amount: the same total, or
 * the printed amount less the line's discount (readers that apply a discount
 * the invoice prints once, in the footer, to every line).
 */
function accountsFor(line: SupplierLine, printed: number): boolean {
  const close = (a: number, b: number) => Math.abs(a - b) <= ROW_TOLERANCE;
  return close(line.lineTotal, printed) || close(line.lineTotal, round2(printed * (1 - line.discountPct)));
}

/**
 * The rows a reading missed, as lines of their own marked `unread`: read the
 * way the generic parser reads them (date, document and description from the
 * column headers where it finds them), else the row's text as printed.
 */
export function unreadLines(doc: PdfDocument, uncovered: ItemRow[], firstId: number): SupplierLine[] {
  const generic = readTable(doc).lines;
  return uncovered.map(({ row, math }, i) => {
    const j = generic.findIndex((l) => l.page === row.page && accountsFor(l, math.total.value));
    const read = j === -1 ? null : generic.splice(j, 1)[0];
    return {
      id: `S${firstId + i}`,
      page: row.page,
      date: read?.date ?? null,
      docNumber: read?.docNumber ?? null,
      bookRef: read?.bookRef ?? null,
      description: read?.description || row.text,
      variety: read?.variety ?? "",
      sku: read?.sku ?? null,
      packages: read?.packages ?? null,
      quantity: math.quantity.value,
      unit: read?.unit ?? "",
      unitPrice: math.price.value,
      discountPct: round2(math.discount * 10000) / 10000,
      lineTotal: math.total.value,
      unread: true,
    };
  });
}
