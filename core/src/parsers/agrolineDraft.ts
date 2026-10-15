import { ExtractionError } from "../errors.js";
import type { OwnInvoice, OwnLine } from "../model.js";
import {
  cellText,
  columnsFromHeader,
  fuzzyIncludes,
  readRow,
  type ColumnSpec,
  type Columns,
  type PdfDocument,
  type Row,
} from "../pdf/layout.js";
import { parseDate, parseNumber, round2 } from "../pdf/text.js";
import type { OwnDocumentParser } from "./types.js";
import { checkTotal } from "./validate.js";

type Key =
  | "date"
  | "ref"
  | "product"
  | "size"
  | "packageType"
  | "packages"
  | "quantity"
  | "unitPrice"
  | "total";

const COLUMNS: ColumnSpec<Key>[] = [
  { key: "date", header: /^תאריך$/, label: "תאריך" },
  { key: "ref", header: /^אסמכתא$/, label: "אסמכתא" },
  { key: "product", header: /^תוצרת\/זן\/איכות$/, label: "תוצרת/זן/איכות" },
  { key: "size", header: /^גודל$/, label: "גודל" },
  { key: "packageType", header: /^אריזה$/, label: "אריזה" },
  { key: "packages", header: /^כמות$/, label: "כמות" },
  { key: "quantity", header: /^משקל\/יחידות$/, label: "משקל/יחידות" },
  { key: "unitPrice", header: /^מחיר$/, label: "מחיר" },
  { key: "total", header: /^סכום$/, label: "סכום" },
];

const TITLE = "חשבונית טיוטה";

/**
 * A wholesaler's AGROLINE draft ("חשבונית טיוטה") — the same layout for every
 * supplier (Teena-Rimon's own document). Amounts are before the commercial
 * discount, which is printed once in the footer ("הנחה מסחרית").
 */
export const agrolineDraftParser: OwnDocumentParser = {
  id: "agroline-draft",

  // Some suppliers (e.g. D. Hai) also print from AGROLINE, so only the draft
  // title identifies the wholesaler's side.
  detect(doc) {
    if (doc.text.includes(TITLE)) return true;
    // Read back by OCR: allow a misread letter in the title.
    return !!doc.repairedByOcr && doc.rows.slice(0, 15).some((r) => fuzzyIncludes(r, TITLE));
  },

  parse: parseAgrolineDraft,
};

function parseAgrolineDraft(doc: PdfDocument, customerName: string): OwnInvoice {
  const lines: OwnLine[] = [];
  const warnings: string[] = [];

  for (const rows of doc.pages) {
    let columns: Columns<Key> | null = null;
    for (const row of rows) {
      if (!columns) {
        columns = columnsFromHeader(row, COLUMNS, { fuzzy: doc.repairedByOcr });
        continue;
      }
      const c = readRow(row, columns);
      const date = parseDate(cellText(c.date));
      const total = parseNumber(cellText(c.total));
      const quantity = parseNumber(cellText(c.quantity));
      if (!date || total == null || quantity == null) continue;

      // Two numbers sit under "אסמכתא": the wholesaler's doc (right) and the
      // supplier reference typed in by the clerk (left).
      const refs = [...c.ref].sort((a, b) => b.x - a.x).map((cell) => cell.text);
      lines.push({
        id: `T${lines.length + 1}`,
        page: row.page,
        date,
        ownDocNumber: refs[0] ?? "",
        supplierRef: refs[1] ?? "",
        product: cellText(c.product),
        size: cellText(c.size),
        packageType: cellText(c.packageType),
        packages: parseNumber(cellText(c.packages)),
        quantity,
        unitPrice: parseNumber(cellText(c.unitPrice)) ?? 0,
        lineTotal: total,
      });
    }
  }

  if (lines.length === 0) {
    throw new ExtractionError(`לא נמצאו שורות בחשבונית הטיוטה של ${customerName}`, "NO_LINES");
  }

  const gross = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const printedGrossTotal = footerAmount(doc, "עבור תקופה");
  checkTotal(`חשבונית ${customerName}`, gross, printedGrossTotal, warnings);

  const commercialDiscount = footerAmount(doc, "הנחה מסחרית") ?? 0;
  if (!commercialDiscount) warnings.push(missingDiscountWarning(customerName));

  return {
    documentNumber: doc.text.match(/חשבונית טיוטה\s+(\d+)/)?.[1] ?? "",
    againstInvoice: doc.text.match(/כנגד חשבונית\s+(\d+)/)?.[1] ?? null,
    lines,
    printedGrossTotal,
    counterparty: counterparty(doc),
    commercialDiscount,
    discountPct: gross ? commercialDiscount / gross : 0,
    warnings,
  };
}

/** "לכבוד: משק דודו מרום בע"מ (ע.מ. 513241455)" → name and VAT number. */
function counterparty(doc: PdfDocument): OwnInvoice["counterparty"] {
  const row = doc.rows.find((r) => /לכבוד\s*:/.test(r.text));
  if (!row) return undefined;
  const text = row.text.replace(/.*לכבוד\s*:\s*/, "");
  const vatId = text.match(/(\d{9})/)?.[1] ?? null;
  const name = text.replace(/\(?\s*ע\.?\s*מ\.?.*$/, "").replace(/[\s(]+$/, "").trim();
  return name ? { name, vatId } : undefined;
}

export function missingDiscountWarning(customerName: string): string {
  return `לא נמצאה "הנחה מסחרית" בחשבונית ${customerName} — ההשוואה מניחה 0%`;
}

/**
 * Footer amounts are printed in the leftmost column, roughly level with their
 * label (baselines can differ by a couple of points).
 */
function footerAmount(doc: PdfDocument, label: string): number | null {
  const labelRow =
    doc.rows.find((r) => r.text.includes(label)) ?? (doc.repairedByOcr ? doc.rows.find((r) => fuzzyIncludes(r, label)) : undefined);
  if (!labelRow) return null;
  const numeric = doc.rows
    .filter((r: Row) => r.page === labelRow.page && Math.abs(r.y - labelRow.y) <= 3)
    .flatMap((r) => r.cells)
    .filter((c) => /^[\d,]+\.\d{2}$/.test(c.text));
  if (numeric.length === 0) return null;
  return parseNumber(numeric.reduce((a, b) => (a.x < b.x ? a : b)).text);
}
