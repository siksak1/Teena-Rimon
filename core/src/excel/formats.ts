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

/** The supplier's report, covering many growers (may carry its own document numbers too). */
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
 * Pineapples are sold by the piece: a report's "weight" then equals the
 * package count on every row of that product in the delivery. Either report
 * may show it (only one may have a package column); the unit goes on the
 * supplier's lines, where the comparison reads it.
 */
export function markUnitPricedProducts(supplier: SupplierLine[], own: OwnLine[]): void {
  const pieces = (rows: { packages: number | null; quantity: number }[]) =>
    rows.every((r) => r.packages != null && r.packages === r.quantity);
  const byKey = <T>(rows: T[], key: (r: T) => string) => {
    const map = new Map<string, T[]>();
    for (const r of rows) map.set(key(r), [...(map.get(key(r)) ?? []), r]);
    return map;
  };
  const ownByKey = byKey(own, (l) => `${l.supplierRef}|${l.product}`);
  for (const [key, group] of byKey(supplier, (l) => `${l.docNumber}|${l.description}`)) {
    const other = ownByKey.get(key);
    if (pieces(group) || (other && pieces(other))) group.forEach((l) => (l.unit = UNITS));
  }
}

/** The wholesaler's own report; it describes each item further (variety, size, grade). */
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
      // Variety, size and grade: read with the product name by the name matcher.
      size: r.extras.map(text).filter(Boolean).join(" "),
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
