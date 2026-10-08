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
  type Row,
} from "../pdf/layout.js";
import { parseDate, parseNumber, round2 } from "../pdf/text.js";
import type { SupplierParser } from "./types.js";
import { checkTotal } from "./validate.js";

/** Same distance `wrappedText` uses for lines that belong to a data row. */
const WRAP_GAP = 8;

type Key = "date" | "doc" | "sku" | "description" | "quantity" | "unitPrice" | "netPrice" | "total";

const COLUMNS: ColumnSpec<Key>[] = [
  { key: "date", header: /^תאריך$/ },
  { key: "doc", header: /^תעודה$/ },
  { key: "sku", header: /^מק"ט$/ },
  { key: "description", header: /^תאור מוצר$/ },
  { key: "quantity", header: /^כמות$/ },
  { key: "unitPrice", header: /^מחיר ליחידה$/ },
  { key: "netPrice", header: /^מחיר ליח' אחרי הנחה$/ },
  { key: "total", header: /^סה"כ מחיר$/ },
];

/** Pallet SKUs ("משטח גליל", "משטח גליל חדש") start with 9000. */
const isPallet = (sku: string, description: string) => /^9000/.test(sku) || description.startsWith("משטח");

/**
 * Galil Shuk Mekomi (גליל שוק מקומי) consolidated tax invoice. The header is
 * printed over three rows, and long product names wrap onto the lines just
 * above and below their data row. Pallet rows are left out. The item table
 * ends at "מחיר כולל" (items + pallets); the "סה"כ כללי" after it belongs to
 * the packaging summary.
 */
const isDated = (row: Row) => row.cells.some((c) => /^\d{1,2}\/\d{1,2}\/\d{2}$/.test(c.text));

/** A single cell in the description column: a wrapped product-name line. */
function isNameLine(row: Row, descriptionX: number): boolean {
  return row.cells.length === 1 && Math.abs(row.cells[0].x - descriptionX) <= 30;
}

/** Within wrapping distance of a data row, i.e. part of that row's name. */
function nearDataRow(rows: Row[], row: Row): boolean {
  return rows.some((r) => isDated(r) && Math.abs(r.y - row.y) <= WRAP_GAP);
}

function lastDataRow(rows: Row[]): Row | undefined {
  return rows.filter(isDated).at(-1);
}

export const galilParser: SupplierParser = {
  id: "galil",
  displayName: "גליל שוק מקומי",

  detect(doc) {
    // Not by name: Har HaKor's address also says "גליל עליון".
    return doc.text.includes("570056218");
  },

  parse(doc: PdfDocument): SupplierInvoice {
    const lines: SupplierLine[] = [];
    const warnings: string[] = [];
    let pallets = 0;
    /** Last line of a page whose name wraps onto the top of the next page. */
    let carried: SupplierLine | null = null;

    pages: for (const rows of doc.pages) {
      let columns: Columns<Key> | null = null;
      let seenData = false;
      for (const [i, row] of rows.entries()) {
        if (!columns) {
          columns = columnsFromHeaderRows(rows, i, COLUMNS);
          continue;
        }
        if (carried && !seenData && isNameLine(row, columns.description) && !nearDataRow(rows, row)) {
          carried.description = [carried.description, row.cells[0].text].filter(Boolean).join(" ");
          continue;
        }
        if (row.text.includes("מחיר כולל")) break pages;

        const c = readRow(row, columns);
        const date = parseDate(cellText(c.date));
        const total = parseNumber(cellText(c.total));
        const quantity = parseNumber(cellText(c.quantity));
        const unitPrice = parseNumber(cellText(c.unitPrice));
        if (!date || total == null || quantity == null || unitPrice == null) continue;
        seenData = true;
        carried = null;

        const sku = cellText(c.sku);
        const description = wrappedText(rows, row, columns.description, cellText(c.description));
        if (isPallet(sku, description)) {
          pallets += total;
          continue;
        }

        const netPrice = parseNumber(cellText(c.netPrice)) ?? unitPrice;
        const line: SupplierLine = {
          id: `S${lines.length + 1}`,
          page: row.page,
          date,
          docNumber: cellText(c.doc) || null,
          bookRef: null,
          description,
          variety: "",
          sku: sku || null,
          packages: null,
          quantity,
          unit: cellText(c.quantity).replace(/[\d.,\s]/g, ""),
          unitPrice,
          discountPct: unitPrice ? round2(1 - netPrice / unitPrice) : 0,
          lineTotal: total,
        };
        lines.push(line);
        if (row === lastDataRow(rows)) carried = line;
      }
    }

    const sum = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const priceTotal = amountOnRow(doc, "מחיר כולל");
    const printedItemsTotal = priceTotal == null ? null : round2(priceTotal - pallets);
    checkTotal("חשבונית גליל שוק מקומי", sum, printedItemsTotal, warnings);

    return {
      supplierId: "galil",
      supplierName: "גליל שוק מקומי",
      invoiceNumber: doc.text.match(/מספר תעודה:\s*(\S+)/)?.[1] ?? "",
      invoiceDate: parseDate(doc.text.match(/תאריך חשבונית:\s*(\S+)/)?.[1]),
      lines,
      printedItemsTotal,
      warnings,
    };
  },
};

