import type { OwnInvoice, OwnLine, SupplierInvoice, SupplierLine } from "../model.js";
import { round2 } from "../pdf/text.js";
import type { ColumnMap, ExcelField, SheetLayout } from "./columns.js";
import { type Cell, isoDate, number, reference, text } from "./read.js";

/**
 * Builds the comparison rows from a report whose columns were found by
 * `detectPair` (see `columns.ts`), whatever their names and order. Neither
 * report has a discount or printed line totals: money is weight × price on
 * both sides.
 */
type SheetRecord = { sheetRow: number; cell: (field: ExcelField) => Cell; extras: Cell[] };

function records(layout: SheetLayout, map: ColumnMap): SheetRecord[] {
  return layout.rows
    .map(({ cells, sheetRow }) => ({
      sheetRow,
      cell: (field: ExcelField) => {
        const index = map.fields[field];
        return index != null ? (cells[index] ?? null) : null;
      },
      extras: map.extras.map((i) => cells[i] ?? null),
    }))
    .filter((r) => !isTotalsRow(r));
}

/** A row with figures but no item, grower or document: a subtotal the report adds. */
function isTotalsRow(r: SheetRecord): boolean {
  return !text(r.cell("product")) && !text(r.cell("grower")) && !text(r.cell("doc"));
}

const KG = 'ק"ג';
const UNITS = "יח'";

/** The supplier's sales report, covering many growers. */
export function parseSupplierSheet(layout: SheetLayout, map: ColumnMap): SupplierInvoice {
  const warnings = [...map.warnings.map((w) => `דוח הספק: ${w}`)];
  const lines: SupplierLine[] = [];
  for (const r of records(layout, map)) {
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
      variety: r.extras.map(text).filter(Boolean).join(" "),
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
    supplierId: "excel-report",
    supplierName: "דוח ספק (אקסל)",
    invoiceNumber: "",
    invoiceDate: null,
    lines,
    printedItemsTotal: null,
    warnings,
  };
}

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

/** The wholesaler's own receiving report, typically one row per weighing. */
export function parseOwnSheet(layout: SheetLayout, map: ColumnMap, customerName: string): OwnInvoice {
  const warnings = [...map.warnings.map((w) => `דוח ${customerName}: ${w}`)];
  const lines: OwnLine[] = [];
  for (const r of records(layout, map)) {
    const product = text(r.cell("product"));
    const quantity = number(r.cell("weight"));
    const unitPrice = number(r.cell("price"));
    if (!product || quantity == null || unitPrice == null) {
      warnings.push(`דוח ${customerName}, שורה ${r.sheetRow}: חסר פריט, משקל או מחיר — השורה לא נכללה בהשוואה`);
      continue;
    }
    const ref = reference(r.cell("doc"));
    lines.push({
      id: `T${lines.length + 1}`,
      page: r.sheetRow,
      date: isoDate(r.cell("date")),
      // Without a document of its own, the supplier's delivery note is the document.
      ownDocNumber: reference(r.cell("ownDoc")) || ref,
      supplierRef: ref,
      product,
      size: "",
      packageType: "",
      packages: number(r.cell("packages")),
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
}
