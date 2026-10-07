import type { SupplierInvoice, SupplierLine } from "../model.js";
import {
  cellText,
  columnsFromHeader,
  readRow,
  type ColumnSpec,
  type Columns,
  type PdfDocument,
} from "../pdf/layout.js";
import { parseDate, parseNumber, parsePercent, round2 } from "../pdf/text.js";
import type { SupplierParser } from "./types.js";
import { checkTotal } from "./validate.js";

type Key =
  | "sku"
  | "description"
  | "packageType"
  | "packages"
  | "quantity"
  | "unit"
  | "unitPrice"
  | "discount"
  | "total";

const COLUMNS: ColumnSpec<Key>[] = [
  { key: "sku", header: /^מק"ט$/ },
  { key: "description", header: /^תאור פריט$/ },
  { key: "packageType", header: /^תאור אריזה$/ },
  { key: "packages", header: /^מס\.\s?אריזות$/ },
  { key: "quantity", header: /^כמות$/ },
  { key: "unit", header: /^יח' מכירה$/ },
  { key: "unitPrice", header: /^מחיר ליחידה$/ },
  { key: "discount", header: /^הנחה$/ },
  { key: "total", header: /^סה"כ מחיר$/ },
];

/**
 * Shivuk HaHof (שיווק החוף) consolidated tax invoice. Each delivery starts
 * with a header row "תאריך תעודה: …, תעודה: 2SH…, מספר פנקס: …" (the date is
 * omitted when it repeats); subtotal rows start with `סה"כ`. A line without
 * a discount has an empty discount cell. The "שונות" table (pallets) is ignored.
 */
export const shivukHahofParser: SupplierParser = {
  id: "shivuk-hahof",
  displayName: "שיווק החוף",

  detect(doc) {
    return doc.text.includes("570054569") || doc.text.includes("שיווק החוף");
  },

  parse(doc: PdfDocument): SupplierInvoice {
    const lines: SupplierLine[] = [];
    const warnings: string[] = [];
    let printedItemsTotal: number | null = null;
    let date: string | null = null;
    let docNumber: string | null = null;
    let bookRef: string | null = null;

    pages: for (const rows of doc.pages) {
      let columns: Columns<Key> | null = null;
      for (const row of rows) {
        if (!columns) {
          columns = columnsFromHeader(row, COLUMNS);
          continue;
        }
        if (row.text.includes("שונות")) break pages;

        if (row.text.includes('סה"כ')) {
          const c = readRow(row, columns);
          if (row.text.includes('סה"כ כללי')) printedItemsTotal = parseNumber(cellText(c.total));
          continue;
        }

        const docMatch = row.text.match(/תעודה:\s*(\d*SH\d+)/);
        if (docMatch) {
          docNumber = docMatch[1];
          bookRef = row.text.match(/פנקס:\s*([\d-]+)/)?.[1] ?? null;
          const headerDate = parseDate(row.text.match(/תאריך תעודה:\s*(\S+)/)?.[1]);
          if (headerDate) date = headerDate;
          continue;
        }

        // Item names are right-aligned next to the SKU, so a short name sits
        // nearer the SKU header than its own. Take the SKU (rightmost cell)
        // first and place the remaining cells without it.
        const [skuCell, ...rest] = [...row.cells].sort((a, b) => b.x - a.x);
        const sku = skuCell?.text ?? "";
        const { sku: _ignored, ...dataColumns } = columns;
        const c = readRow({ ...row, cells: rest }, dataColumns);
        const total = parseNumber(cellText(c.total));
        const quantity = parseNumber(cellText(c.quantity));
        const unitPrice = parseNumber(cellText(c.unitPrice));
        if (!/^\d+$/.test(sku) || total == null || quantity == null || unitPrice == null) continue;

        lines.push({
          id: `S${lines.length + 1}`,
          page: row.page,
          date,
          docNumber,
          bookRef,
          description: cellText(c.description),
          variety: "",
          sku,
          packages: parseNumber(cellText(c.packages)),
          quantity,
          unit: cellText(c.unit),
          unitPrice,
          discountPct: parsePercent(cellText(c.discount)),
          lineTotal: total,
        });
      }
    }

    const sum = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    checkTotal("חשבונית שיווק החוף", sum, printedItemsTotal, warnings);

    return {
      supplierId: "shivuk-hahof",
      supplierName: "שיווק החוף",
      invoiceNumber: doc.text.match(/מספר תעודה:\s*(\S+)/)?.[1] ?? "",
      invoiceDate: parseDate(doc.text.match(/תאריך חשבונית:\s*(\S+)/)?.[1]),
      lines,
      printedItemsTotal,
      warnings,
    };
  },
};
