import type { SupplierInvoice, SupplierLine } from "../model.js";
import {
  amountOnRow,
  cellText,
  columnsFromHeader,
  readRow,
  type Cell,
  type ColumnSpec,
  type Columns,
  type PdfDocument,
} from "../pdf/layout.js";
import { parseDate, parseNumber, parsePercent, round2 } from "../pdf/text.js";
import type { SupplierParser } from "./types.js";
import { checkTotal } from "./validate.js";

type Key =
  | "doc"
  | "date"
  | "description"
  | "pallet"
  | "packages"
  | "packageType"
  | "quantity"
  | "unitPrice"
  | "discount"
  | "total";

const COLUMNS: ColumnSpec<Key>[] = [
  { key: "doc", header: /^מס' ת\. משלוח ללקוח$/ },
  { key: "date", header: /^תאריך משלוח$/ },
  { key: "description", header: /^תאור מוצר$/ },
  { key: "pallet", header: /^סוג משטח$/ },
  { key: "packages", header: /^מספר אריזות$/ },
  { key: "packageType", header: /^סוג אריזה$/ },
  { key: "quantity", header: /^כמות$/ },
  { key: "unitPrice", header: /^מחיר ליחידה$/ },
  { key: "discount", header: /^הנחה$/ },
  { key: "total", header: /^סה"כ מחיר$/ },
];

/**
 * HaHaklaim (החקלאים שיווק ירקות טריים) consolidated tax invoice. Every row
 * carries its own delivery number and date; line totals are after the line
 * discount. Pallet-deposit rows ("פקדון משטח") have no delivery number and
 * are left out. The footer starts at "מחיר כולל" (items + deposits).
 */
export const haklaimParser: SupplierParser = {
  id: "haklaim",
  displayName: "החקלאים",

  detect(doc) {
    return doc.text.includes("515049054");
  },

  parse(doc: PdfDocument): SupplierInvoice {
    const lines: SupplierLine[] = [];
    const warnings: string[] = [];
    let deposits = 0;

    pages: for (const rows of doc.pages) {
      let columns: Columns<Key> | null = null;
      for (const row of rows) {
        if (!columns) {
          columns = columnsFromHeader(row, COLUMNS);
          continue;
        }
        if (row.text.includes("מחיר כולל")) break pages;

        // Right-aligned totals sit nearer the discount header than their own,
        // so take the total (leftmost bare amount) and the discount by shape.
        const totalCell = row.cells
          .filter((cell) => /^[\d,]+\.\d{2}$/.test(cell.text))
          .reduce<Cell | null>((a, b) => (a && a.x < b.x ? a : b), null);
        const discountCell = row.cells.find((cell) => /%$/.test(cell.text));
        const { total: _t, discount: _d, ...dataColumns } = columns;
        const rest = row.cells.filter((cell) => cell !== totalCell && cell !== discountCell);
        const c = readRow({ ...row, cells: rest }, dataColumns);
        const total = parseNumber(totalCell?.text);
        const quantity = parseNumber(cellText(c.quantity));
        const unitPrice = parseNumber(cellText(c.unitPrice));
        const description = cellText(c.description);
        if (total == null || quantity == null || unitPrice == null || !description) continue;
        const docNumber = cellText(c.doc);
        if (!docNumber) {
          deposits += total;
          continue;
        }

        lines.push({
          id: `S${lines.length + 1}`,
          page: row.page,
          date: parseDate(cellText(c.date)),
          docNumber,
          bookRef: null,
          description,
          variety: "",
          sku: null,
          packages: parseNumber(cellText(c.packages)),
          quantity,
          unit: cellText(c.quantity).replace(/[\d.,\s]/g, ""),
          unitPrice,
          discountPct: parsePercent(discountCell?.text),
          lineTotal: total,
        });
      }
    }

    const sum = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const priceTotal = amountOnRow(doc, "מחיר כולל");
    const printedItemsTotal = priceTotal == null ? null : round2(priceTotal - deposits);
    checkTotal("חשבונית החקלאים", sum, printedItemsTotal, warnings);

    return {
      supplierId: "haklaim",
      supplierName: "החקלאים",
      invoiceNumber: doc.text.match(/מספר תעודה:\s*(\S+)/)?.[1] ?? "",
      invoiceDate: parseDate(doc.text.match(/תאריך חשבונית:\s*(\S+)/)?.[1]),
      lines,
      printedItemsTotal,
      warnings,
    };
  },
};

