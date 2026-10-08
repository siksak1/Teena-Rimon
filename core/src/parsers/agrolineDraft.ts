import { ExtractionError } from "../errors.js";
import type { OwnInvoice, OwnLine } from "../model.js";
import {
  cellText,
  columnsFromHeader,
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
  { key: "date", header: /^תאריך$/ },
  { key: "ref", header: /^אסמכתא$/ },
  { key: "product", header: /^תוצרת\/זן\/איכות$/ },
  { key: "size", header: /^גודל$/ },
  { key: "packageType", header: /^אריזה$/ },
  { key: "packages", header: /^כמות$/ },
  { key: "quantity", header: /^משקל\/יחידות$/ },
  { key: "unitPrice", header: /^מחיר$/ },
  { key: "total", header: /^סכום$/ },
];

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
    return doc.text.includes("חשבונית טיוטה");
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
        columns = columnsFromHeader(row, COLUMNS);
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
    throw new ExtractionError(`לא נמצאו שורות בחשבונית הטיוטה של ${customerName}`);
  }

  const gross = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const printedGrossTotal = footerAmount(doc, "עבור תקופה");
  checkTotal(`חשבונית ${customerName}`, gross, printedGrossTotal, warnings);

  const commercialDiscount = footerAmount(doc, "הנחה מסחרית") ?? 0;
  if (!commercialDiscount) warnings.push(`לא נמצאה "הנחה מסחרית" בחשבונית ${customerName} — ההשוואה מניחה 0%`);

  return {
    documentNumber: doc.text.match(/חשבונית טיוטה\s+(\d+)/)?.[1] ?? "",
    againstInvoice: doc.text.match(/כנגד חשבונית\s+(\d+)/)?.[1] ?? null,
    lines,
    printedGrossTotal,
    commercialDiscount,
    discountPct: gross ? commercialDiscount / gross : 0,
    warnings,
  };
}

/**
 * Footer amounts are printed in the leftmost column, roughly level with their
 * label (baselines can differ by a couple of points).
 */
function footerAmount(doc: PdfDocument, label: string): number | null {
  const labelRow = doc.rows.find((r) => r.text.includes(label));
  if (!labelRow) return null;
  const numeric = doc.rows
    .filter((r: Row) => r.page === labelRow.page && Math.abs(r.y - labelRow.y) <= 3)
    .flatMap((r) => r.cells)
    .filter((c) => /^[\d,]+\.\d{2}$/.test(c.text));
  if (numeric.length === 0) return null;
  return parseNumber(numeric.reduce((a, b) => (a.x < b.x ? a : b)).text);
}
