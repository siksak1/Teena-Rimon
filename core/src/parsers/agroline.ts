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
  | "pallet"
  | "bookRef"
  | "description"
  | "size"
  | "packageType"
  | "packages"
  | "quantity"
  | "unitPrice"
  | "total";

const COLUMNS: ColumnSpec<Key>[] = [
  { key: "date", header: /^תאריך$/ },
  { key: "doc", header: /^ת\.משלוח$/ },
  { key: "pallet", header: /^משטח$/ },
  { key: "bookRef", header: /^אסמכתא$/ },
  { key: "description", header: /^תוצרת\/זן\/איכות$/ },
  { key: "size", header: /^גודל$/ },
  { key: "packageType", header: /^אריזה$/ },
  { key: "packages", header: /^כמות$/ },
  { key: "quantity", header: /^משקל\/יחידות$/ },
  { key: "unitPrice", header: /^מחיר$/ },
  { key: "total", header: /^סה"כ$/ },
];

/** Net totals may drift by a few agorot from per-line rounding. */
const NET_DRIFT_TOLERANCE = 1;

type AgrolineSupplier = { id: string; displayName: string; vatId: string };

/**
 * Supplier invoices printed by AGROLINE ("חשבון פרופורמה (שווק)" /
 * "חשבונית מס (שווק)"). Every row carries its own date and delivery number
 * ("ת.משלוח"). Line totals are printed before the discount, which is applied
 * once in the footer ("הנחה 12.0%"); the footer starts at "פדיון".
 * Teena-Rimon's drafts come from AGROLINE too, so detect by VAT id only.
 */
function agrolineParser({ id, displayName, vatId }: AgrolineSupplier): SupplierParser {
  const label = `חשבונית ${displayName}`;
  return {
    id,
    displayName,

    detect(doc) {
      return doc.text.includes(vatId);
    },

    parse(doc: PdfDocument): SupplierInvoice {
      const warnings: string[] = [];
      const discountPct = footerDiscount(doc);
      if (discountPct == null) warnings.push(`לא נמצאה "הנחה" ב${label} — ההשוואה מניחה 0%`);
      const pct = discountPct ?? 0;

      const lines: SupplierLine[] = [];
      let grossSum = 0;

      pages: for (const rows of doc.pages) {
        let columns: Columns<Key> | null = null;
        for (const row of rows) {
          if (!columns) {
            columns = columnsFromHeader(row, COLUMNS);
            continue;
          }
          if (row.text.includes("פדיון")) break pages;

          const c = readRow(row, columns);
          const date = parseDate(cellText(c.date));
          const gross = parseNumber(cellText(c.total));
          const quantity = parseNumber(cellText(c.quantity));
          const unitPrice = parseNumber(cellText(c.unitPrice));
          const description = cellText(c.description);
          if (!date || gross == null || quantity == null || unitPrice == null || !description) continue;

          grossSum += gross;
          lines.push({
            id: `S${lines.length + 1}`,
            page: row.page,
            date,
            docNumber: cellText(c.doc) || null,
            bookRef: cellText(c.bookRef) || null,
            description,
            variety: cellText(c.size),
            sku: null,
            packages: parseNumber(cellText(c.packages)),
            quantity,
            unit: "",
            unitPrice,
            discountPct: pct,
            lineTotal: round2(gross * (1 - pct)),
          });
        }
      }

      checkTotal(`${label} (לפני הנחה)`, round2(grossSum), footerAmount(doc, "פדיון פטור"), warnings);
      const printedItemsTotal = footerAmount(doc, 'סה"כ פדיון');
      const netSum = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
      if (printedItemsTotal != null && Math.abs(netSum - printedItemsTotal) > NET_DRIFT_TOLERANCE) {
        warnings.push(
          `${label}: סכום השורות אחרי הנחה (${netSum}) שונה מ"סה"כ פדיון" המודפס (${printedItemsTotal})`,
        );
      }

      return {
        supplierId: id,
        supplierName: displayName,
        invoiceNumber: invoiceNumber(doc),
        invoiceDate: parseDate(doc.text.match(/תאריך\s+(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1]),
        lines,
        printedItemsTotal,
        warnings,
      };
    },
  };
}

/** D.Ch Shivuk Totzeret Haklait (ד.ח שווק תוצרת חקלאית) — a proforma. */
export const dHaiParser = agrolineParser({ id: "d-hai", displayName: "ד. חי", vatId: "513066753" });

/** Achim Menashri (אחים מנשרי) — a tax invoice. */
export const menashriParser = agrolineParser({ id: "menashri", displayName: "אחים מנשרי", vatId: "516656378" });

/** "חשבון פרופורמה (שווק)  -32974  No" → "32974". */
function invoiceNumber(doc: PdfDocument): string {
  const row = doc.rows.find((r) => r.text.includes("(שווק)"));
  const cell = row?.cells.find((c) => /\d/.test(c.text));
  return cell?.text.replace(/\D/g, "") ?? "";
}

/** Footer row "הנחה  12.0%  15,739.06" → 0.12. */
function footerDiscount(doc: PdfDocument): number | null {
  for (const row of doc.rows) {
    if (!row.cells.some((c) => c.text === "הנחה")) continue;
    const cell = row.cells.find((c) => /%$/.test(c.text));
    if (cell) return parsePercent(cell.text);
  }
  return null;
}

/** Leftmost money amount on the footer row that carries `label`. */
function footerAmount(doc: PdfDocument, label: string): number | null {
  const row = doc.rows.find((r) => r.text.includes(label));
  const amounts = row?.cells.filter((c) => /^[\d,]+\.\d{2}$/.test(c.text)) ?? [];
  if (amounts.length === 0) return null;
  return parseNumber(amounts.reduce((a, b) => (a.x < b.x ? a : b)).text);
}
