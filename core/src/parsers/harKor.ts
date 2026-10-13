import { ExtractionError } from "../errors.js";
import type { SupplierInvoice, SupplierLine } from "../model.js";
import { AMOUNT, type Cell, type ColumnRead, DATE, DIGITS, readTable } from "../ocr/table.js";
import type { GrayImage, OcrEngine } from "../ocr/types.js";
import { columnBox, crop, findGrid, type Grid } from "../pdf/scan.js";
import { hasHebrew, parseDate, parseNumber, round2 } from "../pdf/text.js";
import type { ScannedSupplierParser } from "./types.js";
import { checkTotal, confirmAmounts } from "./validate.js";

const DISPLAY_NAME = "הר-קור";
const LABEL = `חשבונית ${DISPLAY_NAME}`;

/** The item table's columns, left to right as scanned (the invoice reads right to left). */
const COLUMNS = [
  "total", // סה"כ בש"ח — weight × price, before the footer discount
  "unitPrice", // מחיר
  "quantity", // משקל (kg)
  "packages", // כמות
  "packageType", // אריזה
  "size", // גודל
  "grade", // סוג
  "product", // זן
  "chargedPackages", // אריזות לחיוב — packaging charges, not compared
  "doc", // תעודה — the delivery note, what Teena-Rimon records as אסמכתא
  "date", // תאריך
] as const;
type Column = (typeof COLUMNS)[number];
const col = (name: Column) => COLUMNS.indexOf(name);

const READS: ColumnRead[] = COLUMNS.map((name) => {
  switch (name) {
    case "total":
    case "unitPrice":
    case "quantity":
      return { model: "eng", whitelist: AMOUNT };
    case "packages":
    case "doc":
      return { model: "eng", whitelist: DIGITS };
    case "date":
      return { model: "eng", whitelist: DATE };
    case "product":
      return { model: "heb" };
    default:
      return null;
  }
});

/**
 * Product names as Har-Kor prints them, and what they mean. "ש" and "נ" are
 * Har-Kor's short forms of שזיף and נקטרינה; 1881 is a peach cultivar code
 * (Teena-Rimon records it as אפרסק). OCR output is snapped to the nearest of
 * these; a name that isn't close to any is kept as read.
 */
const PRODUCTS: Record<string, string> = {
  "ש לריאן": "שזיף לריאן",
  "ש בלאק דימו": "שזיף בלאק דיימונד",
  "ש לטיצה": "שזיף לטיציה",
  שזיף: "שזיף",
  "נ דורינא": "נקטרינה דורינה",
  "נ פלברטופ": "נקטרינה פלברטופ",
  סמרסט: "אפרסק סמרסט",
  "אפרסק 188": "אפרסק 188",
  "אפרסק שלו": "אפרסק שלו",
  "1881": "אפרסק 1881",
  ספדונה: "אגס ספדונה",
  קוסטיה: "אגס קוסטיה",
};

/**
 * Har-Kor 2002 (הר-קור) — scanned invoices only. The table is ruled, so the
 * scan is split into cells along its lines and each column is read by OCR
 * with the characters it may contain. Every row is checked (weight × price =
 * total) and the columns against the printed totals; see `confirmAmounts`.
 * Line totals are printed before the discount, which is applied once in the
 * footer ("הנחה 12.00%").
 */
export const harKorParser: ScannedSupplierParser = {
  id: "har-kor",
  displayName: DISPLAY_NAME,
  scanned: true,
  vatId: "513221630",

  async parseScan(pages: GrayImage[], ocr: OcrEngine, onPage?: (done: number) => void): Promise<SupplierInvoice> {
    const warnings: string[] = [];
    const rows: { page: number; cells: Cell[] }[] = [];
    let last: { page: GrayImage; grid: Grid } | null = null;

    for (const [i, page] of pages.entries()) {
      const grid = findGrid(page, COLUMNS.length);
      if (grid) {
        const cells = await readTable(page, grid, READS, ocr);
        // A name with (almost) no Hebrew letters is a cultivar code ("1881"),
        // which the Hebrew model misreads: read it again as digits.
        for (const [r, row] of cells.entries()) {
          const product = row[col("product")];
          if (product.text.replace(/[^א-ת]/g, "").length > 1) continue;
          const band = grid.rows[r];
          const box = columnBox(grid.columns[col("product")], band.top, band.bottom);
          const digits = (await ocr.readLines(crop(page, box), { model: "eng", whitelist: DIGITS })).map((l) => l.text).join("");
          if (/^\d{3,}$/.test(digits)) row[col("product")] = { text: digits, confidence: 1 };
        }
        rows.push(...cells.map((c) => ({ page: i + 1, cells: c })));
        last = { page, grid };
      } else if (i === 0) {
        throw new ExtractionError(`לא ניתן לזהות את טבלת הפריטים ב${LABEL} הסרוקה — ייתכן שהסריקה עקומה או מטושטשת`, "SCAN_UNREADABLE");
      }
      onPage?.(i + 1);
    }
    if (!last) throw new ExtractionError(`לא נמצאו שורות פריטים ב${LABEL}`, "NO_LINES");

    const header = await readHeader(pages[0], findGrid(pages[0], COLUMNS.length)!, ocr);
    const footer = await readFooter(last.page, last.grid, ocr);

    if (footer.discountPct == null) warnings.push(`לא נמצאה "הנחה" ב${LABEL} — ההשוואה מניחה 0%`);
    const pct = footer.discountPct ?? 0;

    const text = (r: Cell[], name: Column) => r[col(name)].text;
    const amounts = confirmAmounts(
      rows.map(({ cells }) => ({
        quantity: amount(text(cells, "quantity")),
        unitPrice: amount(text(cells, "unitPrice")),
        total: amount(text(cells, "total")),
      })),
      { quantity: footer.quantity, total: footer.total },
    );

    const lines: SupplierLine[] = [];
    let previous: { doc: string | null; date: string | null } = { doc: null, date: null };
    for (const [i, { page, cells }] of rows.entries()) {
      const a = amounts[i];
      const uncertain = new Set<keyof SupplierLine>(
        a.uncertain.map((f) => (f === "total" ? "lineTotal" : f)),
      );
      const n = i + 1;
      for (const f of a.corrected) {
        warnings.push(`${LABEL}, שורה ${n}: ${FIELD_NAMES[f]} תוקן לפי סיכומי החשבונית (זיהוי תווים)`);
      }

      const doc = docNumber(cells[col("doc")]);
      if (!doc) uncertain.add("docNumber");
      // A delivery note is on one date; a date the OCR missed is taken from
      // the row above when it belongs to the same note.
      let date = rowDate(cells[col("date")]);
      if (!date && doc && doc === previous.doc) date = previous.date;
      if (!date) uncertain.add("date");

      const product = productName(cells[col("product")]);
      if (!product.known) uncertain.add("description");

      const packages = parseNumber(text(cells, "packages"));
      if (packages == null) uncertain.add("packages");

      lines.push({
        id: `S${n}`,
        page,
        date,
        docNumber: doc,
        bookRef: null,
        description: product.name,
        variety: "",
        sku: null,
        packages,
        quantity: a.quantity,
        unit: "",
        unitPrice: a.unitPrice,
        discountPct: pct,
        lineTotal: round2(a.total * (1 - pct)),
        ...(uncertain.size > 0 && { ocrUncertain: [...uncertain] }),
      });
      previous = { doc, date };
    }

    const grossSum = round2(amounts.reduce((s, a) => s + a.total, 0));
    checkTotal(`${LABEL} (לפני הנחה)`, grossSum, footer.total, warnings);
    const weightSum = round2(amounts.reduce((s, a) => s + a.quantity, 0));
    if (footer.quantity != null && Math.abs(weightSum - footer.quantity) > 0.05) {
      warnings.push(`${LABEL}: סכום המשקל בשורות (${weightSum}) שונה מהסה"כ המודפס (${footer.quantity})`);
    }
    const packagesSum = lines.reduce((s, l) => s + (l.packages ?? 0), 0);
    if (footer.packages != null && packagesSum !== footer.packages) {
      warnings.push(`${LABEL}: סכום הכמויות בשורות (${packagesSum}) שונה מהסה"כ המודפס (${footer.packages})`);
    }
    const uncertainLines = lines.filter((l) => l.ocrUncertain).length;
    if (uncertainLines > 0) {
      warnings.push(`${LABEL}: ${uncertainLines} שורות לא אומתו בזיהוי התווים — יש לבדוק אותן מול החשבונית`);
    }

    return {
      supplierId: harKorParser.id,
      supplierName: DISPLAY_NAME,
      invoiceNumber: header.invoiceNumber,
      invoiceDate: header.date,
      lines,
      printedItemsTotal:
        footer.total != null && footer.discountAmount != null ? round2(footer.total - footer.discountAmount) : null,
      scanned: true,
      warnings,
    };
  },
};

const FIELD_NAMES = { quantity: "המשקל", unitPrice: "המחיר", total: 'הסה"כ' } as const;

/** "3,802.50" → 3802.5. OCR sometimes drops the decimal point; every amount here has two decimals. */
function amount(text: string): number | null {
  const digits = text.replace(/[^\d.]/g, "");
  if (!digits) return null;
  if (/^\d+\.\d{1,2}$/.test(digits)) return Number(digits);
  if (/^\d{3,}$/.test(digits)) return Number(digits) / 100;
  return null;
}

function docNumber(cell: Cell): string | null {
  const digits = cell.text.replace(/\D/g, "");
  return digits.length >= 3 && digits.length <= 7 ? digits : null;
}

/** "29/07/26" → "2026-07-29"; also when the OCR lost the slashes ("290726"). */
function rowDate(cell: Cell): string | null {
  const digits = cell.text.replace(/\D/g, "");
  const iso = parseDate(cell.text) ?? (digits.length === 6 ? parseDate(digits.replace(/(\d\d)(\d\d)(\d\d)/, "$1/$2/$3")) : null);
  if (!iso) return null;
  const [, m, d] = iso.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? iso : null;
}

/** Snap an OCR'd name to the nearest known Har-Kor product. */
function productName(cell: Cell): { name: string; known: boolean } {
  const read = cell.text.replace(/\s+/g, " ").trim();
  // A cultivar code ("1881") comes out of the Hebrew model as junk.
  const letters = read.replace(/[^א-ת]/g, "").length;
  const candidates = Object.keys(PRODUCTS);
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const name of candidates) {
    const d = editDistance(read, name);
    if (d < bestDistance) {
      best = name;
      bestDistance = d;
    }
  }
  if (best && bestDistance <= Math.ceil(best.length / 3) && (letters > 1 || !hasHebrew(best))) {
    return { name: PRODUCTS[best], known: true };
  }
  if (letters <= 1 && /\d{3,}/.test(read)) {
    const code = read.replace(/\D/g, "");
    if (PRODUCTS[code]) return { name: PRODUCTS[code], known: true };
  }
  // Not a product we know: keep it as read, with Har-Kor's short forms spelled out.
  return { name: read.replace(/^ש /, "שזיף ").replace(/^נ /, "נקטרינה "), known: read.length > 0 && hasHebrew(read) };
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/** "חשבונית מס מספר: 111081" and "תאריך: 31/08/26", above the table on page 1. */
async function readHeader(page: GrayImage, grid: Grid, ocr: OcrEngine) {
  const lines = await ocr.readLines(crop(page, { left: 0, right: page.width - 1, top: 0, bottom: grid.header.top - 10 }), {
    model: "heb",
  });
  const invoiceLine = lines.find((l) => l.text.includes("חשבונית"));
  const invoiceNumber = invoiceLine?.text.match(/\d{5,}/)?.[0] ?? "";
  const dateLine = lines.find((l) => l.text.includes("תאריך") && /\d/.test(l.text)) ?? lines.find((l) => /\d+\/\d+\/\d+/.test(l.text));
  return { invoiceNumber, date: dateLine ? rowDate({ text: dateLine.text.replace(/^[^\d]*/, ""), confidence: 1 }) : null };
}

/**
 * The 'סה"כ' row printed right under the table (amount, weight and packages
 * in their columns), then "הנחה 12.00%  11,177.96" below it.
 */
async function readFooter(page: GrayImage, grid: Grid, ocr: OcrEngine) {
  const rowHeight = grid.rows[0].bottom - grid.rows[0].top;
  const band = { top: grid.bottom + 1, bottom: grid.bottom + Math.round(rowHeight * 1.3) };
  const read = async (name: Column, whitelist: string) => {
    const box = columnBox(grid.columns[col(name)], band.top, band.bottom);
    const lines = await ocr.readLines(crop(page, box), { model: "eng", whitelist });
    return lines.map((l) => l.text).join("");
  };
  const total = amount(await read("total", AMOUNT));
  const quantity = amount(await read("quantity", AMOUNT));
  const packages = parseNumber(await read("packages", DIGITS));

  const below = await ocr.readLines(
    crop(page, { left: 0, right: page.width - 1, top: band.bottom, bottom: Math.min(page.height - 1, band.bottom + rowHeight * 8) }),
    { model: "eng", whitelist: `${AMOUNT}%` },
  );
  // "12.00%", confirmed by the amount printed next to it (total × percent).
  const percents = below.flatMap((l) => [...l.text.matchAll(/(\d{1,2}\.\d{2})%/g)].map((m) => Number(m[1]) / 100));
  const amounts = below.flatMap((l) => l.text.match(/[\d,]+\.\d\d/g) ?? []).map((s) => Number(s.replace(/,/g, "")));
  let discountPct: number | null = percents[0] ?? null;
  let discountAmount: number | null = null;
  for (const pct of percents) {
    const match = total == null ? undefined : amounts.find((v) => Math.abs(v - round2(total * pct)) <= 0.05);
    if (match != null) {
      discountPct = pct;
      discountAmount = match;
      break;
    }
  }
  return { total, quantity, packages, discountPct, discountAmount };
}
