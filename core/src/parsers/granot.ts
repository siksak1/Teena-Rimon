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
  | "date"
  | "doc"
  | "bookRef"
  | "description"
  | "variety"
  | "pallet"
  | "packages"
  | "quantity"
  | "unitPrice"
  | "discount"
  | "netPrice"
  | "total";

const COLUMNS: ColumnSpec<Key>[] = [
  { key: "date", header: /^תאריך$/ },
  { key: "doc", header: /^תעודה$/ },
  { key: "bookRef", header: /^תעודה מפנקס$/ },
  { key: "description", header: /^תאור מוצר$/ },
  { key: "variety", header: /^זן$/ },
  { key: "pallet", header: /^משטח$/ },
  { key: "packages", header: /^מס\.\s?אריזות$/ },
  { key: "quantity", header: /^כמות$/ },
  { key: "unitPrice", header: /^מחיר ליחידה$/ },
  { key: "discount", header: /^הנחה$/ },
  { key: "netPrice", header: /^מחיר ליח' אחרי הנחה$/ },
  { key: "total", header: /^סה"כ מחיר$/ },
];

/**
 * Granot (חקלאי גרנות) consolidated tax invoice ("חשבונית מס מרכזת").
 * One table per page; date / doc / book-ref cells are printed only on the
 * first row they apply to. Each doc ends with a `סה"כ` row, the table with
 * `סה"כ כללי`, followed by a pallet-charges table we ignore.
 */
export const granotParser: SupplierParser = {
  id: "granot",
  displayName: "גרנות",

  detect(doc) {
    return doc.text.includes("570063362") || doc.text.includes("חקלאי גרנות");
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
        const c = readRow(row, columns);
        const total = parseNumber(cellText(c.total));

        if (row.text.includes('סה"כ כללי')) {
          printedItemsTotal = total;
          break pages;
        }
        if (row.text.includes('סה"כ')) continue; // per-document subtotal

        const quantity = parseNumber(cellText(c.quantity));
        const unitPrice = parseNumber(cellText(c.unitPrice));
        const description = cellText(c.description);
        if (total == null || quantity == null || unitPrice == null || !description) continue;

        const rowDate = parseDate(cellText(c.date));
        if (rowDate) date = rowDate;
        const rowDoc = cellText(c.doc);
        if (rowDoc) {
          docNumber = rowDoc;
          bookRef = cellText(c.bookRef) || null;
        }

        lines.push({
          id: `S${lines.length + 1}`,
          page: row.page,
          date,
          docNumber,
          bookRef,
          description,
          variety: cellText(c.variety),
          sku: null,
          packages: parseNumber(cellText(c.packages)),
          quantity,
          unit: cellText(c.quantity).replace(/[\d.,\s]/g, ""),
          unitPrice,
          discountPct: parsePercent(cellText(c.discount)),
          lineTotal: total,
        });
      }
    }

    const sum = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    checkTotal("חשבונית גרנות", sum, printedItemsTotal, warnings);

    return {
      supplierId: "granot",
      supplierName: "גרנות",
      invoiceNumber: doc.text.match(/מספר תעודה:\s*(\S+)/)?.[1] ?? "",
      invoiceDate: parseDate(doc.text.match(/תאריך חשבונית:\s*(\S+)/)?.[1]),
      lines,
      printedItemsTotal,
      warnings,
    };
  },
};
