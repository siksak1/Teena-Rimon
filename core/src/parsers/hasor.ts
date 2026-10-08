import type { SupplierInvoice, SupplierLine } from "../model.js";
import {
  amountOnRow,
  cellText,
  columnsFromHeaderRows,
  readRow,
  wrappedText,
  type ColumnSpec,
  type Columns,
  type PdfDocument,
} from "../pdf/layout.js";
import { parseDate, parseNumber, parsePercent, round2 } from "../pdf/text.js";
import type { SupplierParser } from "./types.js";
import { checkTotal } from "./validate.js";

type Key =
  | "date"
  | "doc"
  | "description"
  | "quality"
  | "packageType"
  | "packages"
  | "weight"
  | "unitPrice"
  | "total";

const COLUMNS: ColumnSpec<Key>[] = [
  { key: "date", header: /^תאריך$/ },
  { key: "doc", header: /^מספר תעודה$/ },
  { key: "description", header: /^תאור$/ },
  { key: "quality", header: /^קוד איכות$/ },
  { key: "packageType", header: /^תאור אריזה$/ },
  { key: "packages", header: /^כמות באריזה$/ },
  { key: "weight", header: /^משקל נטו$/ },
  { key: "unitPrice", header: /^מחיר$/ },
  { key: "total", header: /^סה"כ לשורה נטו$/ },
];

const DATE = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
/** Delivery numbers are printed as "<branch>/<number>", e.g. "21/265134". */
const DOC = /^\d{2}\/\d{6}$/;
/** Net totals may drift by a few agorot from per-line rounding. */
const NET_DRIFT_TOLERANCE = 1;

/**
 * Shivuk HaAsor (שיווק העשור) tax invoice. The supplier's name and VAT id are
 * only in the logo image, so it is detected by layout. Each delivery prints
 * an item row, then a packaging row ("קרטון", count only) and a pallet row
 * ("משטח …"); only item rows are kept. Line totals are printed after the
 * footer discount ("הנחה סחורה 12.00%") while unit prices are before it.
 * Items sold by the unit (pineapple) have no weight.
 */
export const hasorParser: SupplierParser = {
  id: "hasor",
  displayName: "שיווק העשור",

  detect(doc) {
    return (
      doc.text.includes("מספר הקצאה מקוצר") &&
      doc.rows.some((r) => r.cells.some((c) => c.text === "קוד") && r.cells.some((c) => c.text === "כמות"))
    );
  },

  parse(doc: PdfDocument): SupplierInvoice {
    const warnings: string[] = [];
    const discountRow = doc.rows.find((r) => r.text.includes("הנחה סחורה"));
    const discountCell = discountRow?.cells.find((c) => /%$/.test(c.text));
    if (!discountCell) warnings.push('לא נמצאה "הנחה סחורה" בחשבונית שיווק העשור — ההשוואה מניחה 0%');
    const pct = parsePercent(discountCell?.text);

    const lines: SupplierLine[] = [];
    let grossSum = 0;

    // Continuation pages repeat no table header; keep the first page's columns.
    let columns: Columns<Key> | null = null;
    pages: for (const rows of doc.pages) {
      for (const [i, row] of rows.entries()) {
        if (!columns) {
          columns = columnsFromHeaderRows(rows, i, COLUMNS);
          continue;
        }
        if (row.text.includes("סה\"כ סחורה ברוטו")) break pages;

        // Short product names sit nearer the doc header than their own, so
        // take date and doc by shape and place the remaining cells without them.
        const dateCell = row.cells.find((c) => DATE.test(c.text));
        const docCell = row.cells.find((c) => DOC.test(c.text));
        if (!dateCell || !docCell) continue;
        const { date: _d, doc: _n, ...dataColumns } = columns;
        const rest = row.cells.filter((c) => c !== dateCell && c !== docCell);
        const c = readRow({ ...row, cells: rest }, dataColumns);

        const description = cellText(c.description);
        const total = parseNumber(cellText(c.total));
        const unitPrice = parseNumber(cellText(c.unitPrice));
        const packages = parseNumber(cellText(c.packages));
        const weight = parseNumber(cellText(c.weight));
        const quantity = weight ?? packages;
        if (total == null || unitPrice == null || quantity == null || !description) continue;
        if (description.startsWith("משטח")) continue;

        grossSum += quantity * unitPrice;
        lines.push({
          id: `S${lines.length + 1}`,
          page: row.page,
          date: parseDate(dateCell.text),
          docNumber: docCell.text,
          bookRef: null,
          description,
          variety: wrappedText(rows, row, columns.quality, cellText(c.quality)),
          sku: null,
          packages,
          quantity,
          unit: weight == null ? "יח'" : 'ק"ג',
          unitPrice,
          discountPct: pct,
          lineTotal: total,
        });
      }
    }

    checkTotal(
      "חשבונית שיווק העשור (לפני הנחה)",
      round2(grossSum),
      amountOnRow(doc, 'סה"כ סחורה ברוטו'),
      warnings,
    );
    const printedItemsTotal = amountOnRow(doc, 'סה"כ נטו סחורה');
    const netSum = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    if (printedItemsTotal != null && Math.abs(netSum - printedItemsTotal) > NET_DRIFT_TOLERANCE) {
      warnings.push(
        `חשבונית שיווק העשור: סכום השורות (${netSum}) שונה מ"סה"כ נטו סחורה" המודפס (${printedItemsTotal})`,
      );
    }

    return {
      supplierId: "hasor",
      supplierName: "שיווק העשור",
      invoiceNumber: doc.text.match(/חשבונית מס\s+(\d+\/\d+)/)?.[1] ?? "",
      invoiceDate: parseDate(doc.text.match(/תאריך ח\S*\s+(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1]),
      lines,
      printedItemsTotal,
      warnings,
    };
  },
};
