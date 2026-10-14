import type { OwnInvoice, OwnLine, SupplierInvoice, SupplierLine } from "../model.js";
import { round2 } from "../pdf/text.js";
import { type Cell, findHeaderRow, isoDate, normalizeHeader, number, reference, text } from "./read.js";

/**
 * Spreadsheet report formats. Columns are found by their header text, so
 * column order and extra columns don't matter. Neither report has a
 * discount or printed line totals: money is weight × price on both sides.
 */
type Columns<K extends string> = Record<K, { header: string; optional?: true }>;

export interface ExcelFormat<K extends string = string> {
  id: string;
  /** What the report is called, for the upload hint and errors. */
  label: string;
  columns: Columns<K>;
}

export interface ExcelSupplierFormat extends ExcelFormat {
  parse(rows: Cell[][]): SupplierInvoice;
}

export interface ExcelOwnFormat extends ExcelFormat {
  parse(rows: Cell[][], customerName: string): OwnInvoice;
}

/** Headers every row of the format needs. */
export function requiredHeaders(format: ExcelFormat): string[] {
  return Object.values(format.columns)
    .filter((c) => !c.optional)
    .map((c) => c.header);
}

export function detectExcel(format: ExcelFormat, rows: Cell[][]): boolean {
  return findHeaderRow(rows, requiredHeaders(format)) >= 0;
}

/** Required headers missing from the sheet's best-matching header row. */
export function missingHeaders(format: ExcelFormat, rows: Cell[][]): string[] {
  const required = requiredHeaders(format);
  let best: string[] = required;
  for (const row of rows.slice(0, 10)) {
    const cells = new Set(row.map(normalizeHeader));
    const missing = required.filter((h) => !cells.has(normalizeHeader(h)));
    if (missing.length < best.length) best = missing;
  }
  return best;
}

type SheetRecord<K extends string> = { sheetRow: number; cell: (key: K) => Cell };

/** Data rows under the header row, with cells looked up by column key. Blank rows are skipped. */
function records<K extends string>(rows: Cell[][], columns: Columns<K>): SheetRecord<K>[] {
  const headerIndex = findHeaderRow(rows, requiredHeaders({ id: "", label: "", columns }));
  const header = rows[headerIndex].map(normalizeHeader);
  const index = Object.fromEntries(
    Object.entries<{ header: string }>(columns).map(([key, c]) => [key, header.indexOf(normalizeHeader(c.header))]),
  ) as Record<K, number>;
  return rows
    .slice(headerIndex + 1)
    .map((row, i) => ({ row, sheetRow: headerIndex + 2 + i }))
    .filter(({ row }) => row.some((c) => text(c) !== ""))
    .map(({ row, sheetRow }) => ({ sheetRow, cell: (key: K) => (index[key] >= 0 ? (row[index[key]] ?? null) : null) }));
}

const KG = 'ק"ג';
const UNITS = "יח'";

/* ------------------------------------------------------------------ */
/* Supplier: sales report per grower ("דוחות-…", exported from Magic)  */
/* ------------------------------------------------------------------ */

const salesReportColumns = {
  doc: { header: "מס' תעודה משלוח" },
  destination: { header: "תאור יעד", optional: true },
  grower: { header: "שם מגדל" },
  product: { header: "תאור" },
  variety: { header: "שם זן", optional: true },
  size: { header: "גודל", optional: true },
  quality: { header: "תאור איכות", optional: true },
  packages: { header: "כמות", optional: true },
  weight: { header: "משקל מכירה" },
  price: { header: "מחיר מכירה" },
  date: { header: "תאריך" },
} satisfies Columns<string>;

export const growerSalesReport: ExcelSupplierFormat = {
  id: "grower-sales-report",
  label: "דוח מכירות לפי מגדל (אקסל)",
  columns: salesReportColumns,
  parse(rows) {
    const warnings: string[] = [];
    const lines: SupplierLine[] = [];
    for (const r of records(rows, salesReportColumns)) {
      const product = text(r.cell("product"));
      const quantity = number(r.cell("weight"));
      const unitPrice = number(r.cell("price"));
      if (!product || quantity == null || unitPrice == null) {
        warnings.push(`דוח הספק, שורה ${r.sheetRow}: חסר פריט, משקל או מחיר — השורה לא נכללה בהשוואה`);
        continue;
      }
      lines.push({
        id: `S${lines.length + 1}`,
        page: r.sheetRow,
        date: isoDate(r.cell("date")),
        docNumber: reference(r.cell("doc")) || null,
        bookRef: null,
        description: product,
        variety: [r.cell("variety"), r.cell("size"), r.cell("quality")].map(text).filter(Boolean).join(" "),
        sku: null,
        packages: number(r.cell("packages")),
        quantity,
        unit: KG,
        unitPrice,
        discountPct: 0,
        lineTotal: round2(quantity * unitPrice),
        grower: text(r.cell("grower")),
      });
    }
    markUnitPricedProducts(lines);
    return {
      supplierId: "grower-sales-report",
      supplierName: "דוח ספק (אקסל)",
      invoiceNumber: "",
      invoiceDate: null,
      lines,
      printedItemsTotal: null,
      warnings,
    };
  },
};

/**
 * Pineapples are sold by the piece: the report's "weight" then equals the
 * package count on every row of that product in the delivery.
 */
function markUnitPricedProducts(lines: SupplierLine[]): void {
  const byProduct = new Map<string, SupplierLine[]>();
  for (const l of lines) {
    const key = `${l.grower}|${l.docNumber}|${l.description}`;
    byProduct.set(key, [...(byProduct.get(key) ?? []), l]);
  }
  for (const group of byProduct.values()) {
    if (group.every((l) => l.packages != null && l.packages === l.quantity)) group.forEach((l) => (l.unit = UNITS));
  }
}

/* ------------------------------------------------------------------ */
/* Own: the wholesaler's receiving report, one row per weighing        */
/* ------------------------------------------------------------------ */

const weighingsColumns = {
  grower: { header: "מגדל" },
  date: { header: "תאריך" },
  vehicle: { header: "קוד רכב", optional: true },
  ref: { header: "אסמכתא" },
  product: { header: "תוצרת" },
  weight: { header: "משקל נטו" },
  price: { header: "מחיר" },
} satisfies Columns<string>;

export const teenaRimonWeighings: ExcelOwnFormat = {
  id: "teena-rimon-weighings",
  label: "דוח קליטה (אקסל)",
  columns: weighingsColumns,
  parse(rows, customerName) {
    const warnings: string[] = [];
    const lines: OwnLine[] = [];
    for (const r of records(rows, weighingsColumns)) {
      const product = text(r.cell("product"));
      const quantity = number(r.cell("weight"));
      const unitPrice = number(r.cell("price"));
      if (!product || quantity == null || unitPrice == null) {
        warnings.push(`דוח ${customerName}, שורה ${r.sheetRow}: חסר פריט, משקל או מחיר — השורה לא נכללה בהשוואה`);
        continue;
      }
      const ref = reference(r.cell("ref"));
      lines.push({
        id: `T${lines.length + 1}`,
        page: r.sheetRow,
        date: isoDate(r.cell("date")),
        // The report has no document of its own; the supplier's delivery note is the document.
        ownDocNumber: ref,
        supplierRef: ref,
        product,
        size: "",
        packageType: "",
        packages: null,
        quantity,
        unitPrice,
        lineTotal: round2(quantity * unitPrice),
        grower: text(r.cell("grower")),
      });
    }
    return {
      documentNumber: "",
      againstInvoice: null,
      lines,
      printedGrossTotal: null,
      commercialDiscount: 0,
      discountPct: 0,
      warnings,
    };
  },
};

export const EXCEL_SUPPLIER_FORMATS: Record<string, ExcelSupplierFormat> = {
  [growerSalesReport.id]: growerSalesReport,
};

export const EXCEL_OWN_FORMATS: Record<string, ExcelOwnFormat> = {
  [teenaRimonWeighings.id]: teenaRimonWeighings,
};
