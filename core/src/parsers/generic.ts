import { ExtractionError } from "../errors.js";
import type { SupplierInvoice, SupplierLine } from "../model.js";
import { wrappedText, type Cell, type PdfDocument, type Row } from "../pdf/layout.js";
import { hasHebrew, parseDate, parseNumber, round2 } from "../pdf/text.js";
import { ADJUSTMENT_ROW, headerField, PALLET_ROW, SUMMARY_ROW, TOTAL_LABEL, type HeaderField } from "./genericHeaders.js";
import type { TextSupplierParser } from "./types.js";

/**
 * Generic reader for supplier invoices with no parser of their own: any
 * table whose rows read quantity × unit price × (1 − discount) = line total.
 *
 * 1. On every row, look for three amounts that satisfy that equation, right
 *    to left as Hebrew tables print them (quantity, price, then the total in
 *    the leftmost of the three). The discount is a percentage on the row, one
 *    printed in the footer, the ratio of a second, discounted price column,
 *    or none.
 * 2. The price and total columns most rows agree on are the item table;
 *    rows elsewhere (pallet and packaging tables) are left out.
 * 3. Header names above the first item row label the other columns (date,
 *    delivery document, booklet reference, description…), see
 *    `genericHeaders.ts`. Rows between items such as "תעודה: SH…, מספר פנקס: …"
 *    set the date and document for the rows below them, and a row with blank
 *    date and document cells continues the one above.
 * 4. The result is accepted only when the item rows add up to a total printed
 *    on the invoice (with or without the pallet rows); otherwise the invoice
 *    is refused rather than guessed at.
 */
export const genericTableParser: TextSupplierParser = {
  id: "generic",
  displayName: "פורמט כללי",
  fallback: true,

  // Tried last: anything with a few rows whose amounts multiply out.
  detect(doc) {
    return !doc.text.includes("חשבונית טיוטה") && findItemRows(doc, documentDiscounts(doc)).rows.length >= 2;
  },

  parse: parseGeneric,
};

/** Rows whose arithmetic fails by more than this are not item rows. */
const ABS_TOLERANCE = 0.05;
const REL_TOLERANCE = 0.0001;
/** Column centres closer than this (points) are the same column. */
const COLUMN_TOLERANCE = 15;
/** A discount above this is not a discount but two unrelated amounts. */
const MAX_DISCOUNT = 0.5;
/** A column holds quantities when at least this share of the rows (and two) use it. */
const QUANTITY_COLUMN_SHARE = 0.1;
/** Header rows sit at most this far (points) above the first item row. */
const HEADER_REACH = 80;
/** Printed totals may differ from the line sum by per-line rounding. */
const TOTAL_TOLERANCE = 0.06;

type Amount = { cell: Cell; value: number };
type Arithmetic = { quantity: Amount; price: Amount; total: Amount; discount: number };
type ItemRow = { row: Row; math: Arithmetic };
type HeaderColumn = { x: number; xMin: number; xMax: number; label: string; field: HeaderField | null };

function parseGeneric(doc: PdfDocument): SupplierInvoice {
  const warnings: string[] = [];
  const { lines, isItem, pallets, gross, footerDiscount, invoiceDate } = readTable(doc);
  if (lines.length === 0) throw refuse("לא נמצאו שורות פריטים");

  const sum = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const match = matchPrintedTotal(doc, isItem, [
    { value: sum, items: sum },
    { value: round2(sum + pallets), items: sum },
    // Gross lines and a footer discount: the net total is printed with per-line rounding drift.
    ...(footerDiscount ? [{ value: round2(gross), items: printedNear(doc, isItem, sum) ?? sum }] : []),
  ]);
  if (match == null) {
    throw refuse(`סכום השורות (${sum}) אינו מתאים לאף סה"כ המודפס בחשבונית${totalsHint(doc, isItem, sum, pallets)}`);
  }
  const printedItemsTotal = match.items;
  if (match.adjustment != null) {
    warnings.push(`הפרש של ${match.gap} ש"ח בין סכום השורות לסה"כ המודפס, המוסבר בעיגול/הנחה כללית של ${match.adjustment} ש"ח בחשבונית`);
  }

  warnings.push(
    "החשבונית נקראה בפורמט כללי (ללא קורא ייעודי לספק זה). הסכומים אומתו מול הסה\"כ המודפס, אך מומלץ לבדוק את התאריכים, מספרי התעודות ושמות המוצרים",
  );
  if (lines.some((l) => !l.date)) warnings.push("בחלק מהשורות לא נמצא תאריך");

  return {
    supplierId: "generic",
    supplierName: "ספק",
    vatId: null,
    invoiceNumber: findInvoiceNumber(doc),
    invoiceDate,
    lines,
    printedItemsTotal,
    warnings,
    generic: "table",
  };
}

/** The item lines as read, before they are checked against the printed totals. Exported for the tests. */
export function readTable(doc: PdfDocument) {
  const discounts = documentDiscounts(doc);
  const { rows: itemRows } = findItemRows(doc, discounts);

  const invoiceDate = findInvoiceDate(doc);
  const isItem = new Map(itemRows.map((r) => [r.row, r]));
  const headers = new Map<number, HeaderColumn[]>();
  let previous: HeaderColumn[] = [];
  for (const page of new Set(itemRows.map((r) => r.row.page))) {
    // A page without headers continues the previous page's table.
    const found = headerColumns(doc, itemRows.find((r) => r.row.page === page)!.row);
    previous = found.length > 0 ? found : previous;
    headers.set(page, previous);
  }

  const lines: SupplierLine[] = [];
  let pallets = 0;
  let gross = 0;
  const context = { date: null as string | null, doc: null as string | null, bookRef: null as string | null };
  let carried: SupplierLine | null = null;

  for (const rows of doc.pages) {
    const page = rows[0]?.page;
    const columns = headers.get(page) ?? [];
    // Group rows count below the page's column headers (or, on a page
    // without headers, after its first item), never in the page title.
    const top = headerTop(doc, page);
    let inTable = false;
    const descriptionX = columns.find((c) => c.field === "description")?.x;
    const varietyX = columns.find((c) => c.field === "variety")?.x;
    const itemYs = rows.filter((r) => isItem.has(r)).map((r) => r.y);
    for (const row of rows) {
      const item = isItem.get(row);
      // The name of a page's last item can run onto the top of the next page.
      if (!item && !inTable && carried && descriptionX != null && row.y < top && isNameLine(row, descriptionX, itemYs)) {
        carried.description = [carried.description, row.cells[0].text].filter(Boolean).join(" ");
        continue;
      }
      if (!item) {
        // Group rows between items set the date / document for the rows below.
        const inside = Number.isFinite(top) ? row.y < top : inTable;
        if (inside && !SUMMARY_ROW.test(row.text)) updateContext(context, row.text);
        continue;
      }
      inTable = true;
      const fields = rowFields(row, item.math, columns, invoiceDate);
      const description = describe(rows, row, fields, columns);
      const total = item.math.total.value;
      if (PALLET_ROW.test(description)) {
        pallets += total;
        continue;
      }

      // A row's own date / document wins; blank cells continue the row above.
      if (fields.date) context.date = fields.date;
      if (fields.doc) {
        if (fields.doc !== context.doc) context.bookRef = null;
        context.doc = fields.doc;
      }
      if (fields.bookRef) context.bookRef = fields.bookRef;

      gross += item.math.quantity.value * item.math.price.value;
      lines.push({
        id: `S${lines.length + 1}`,
        page: row.page,
        date: context.date,
        docNumber: context.doc,
        bookRef: context.bookRef,
        description,
        variety: varietyX == null ? fields.variety : wrappedText(rows, row, varietyX, fields.variety),
        sku: fields.sku,
        packages: fields.packages,
        quantity: item.math.quantity.value,
        unit: fields.unit,
        unitPrice: item.math.price.value,
        discountPct: round4(item.math.discount),
        lineTotal: total,
      });
    }
    carried = lines.at(-1) ?? null;
  }
  // Line totals printed before a discount that the footer applies once.
  const footerDiscount = applyFooterDiscount(doc, lines, discounts);
  return { lines, isItem, pallets, gross, footerDiscount, invoiceDate };
}

function refuse(reason: string): ExtractionError {
  return new ExtractionError(`לא ניתן לקרוא את חשבונית הספק באופן אוטומטי: ${reason}`, "UNSUPPORTED_SUPPLIER");
}

/* ------------------------------------------------------------------ */
/* Item rows, by arithmetic                                            */
/* ------------------------------------------------------------------ */

/** A number with an optional unit beside it: "94.00 ק'ג", "1,440.00", ":39274.95". */
const NUMBER_WITH_UNIT = /^(\D*?)([:\-]?\s*-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*:?)(\D*)$/;
/** Units, without their quote marks. */
const UNITS = new Set(["", "קג", "שח", "יח", "יחידות", "kg"]);
const QUOTES = /["'״׳]/g;

/**
 * The value of a cell that is an amount, or null: not a date, a code or a
 * percentage. The unit may print on either side of the number, and its quote
 * mark can be moved away from it in right-to-left text ("'2.00 יח",
 * "ש"ח 3.000").
 */
export function readAmount(text: string): number | null {
  const match = text.trim().match(NUMBER_WITH_UNIT);
  if (!match) return null;
  const [, before, number, after] = match;
  if (!UNITS.has((before + after).replace(QUOTES, "").replace(/\s+/g, ""))) return null;
  // Long whole numbers are document, pallet or item codes.
  if (/^\d{6,}$/.test(number.trim())) return null;
  return parseNumber(number);
}

function amounts(row: Row): Amount[] {
  return row.cells.flatMap((cell) => {
    const value = readAmount(cell.text);
    return value == null ? [] : [{ cell, value }];
  });
}

function percentages(text: string): number[] {
  return [...text.matchAll(/(\d{1,2}(?:\.\d+)?)\s*%/g)]
    .map((m) => Number(m[1]) / 100)
    .filter((d) => d > 0 && d <= MAX_DISCOUNT);
}

/** Discount rates printed outside the item rows ("הנחה סחורה 12.00%", "הנחה 12.0%"). */
function documentDiscounts(doc: PdfDocument): number[] {
  return [...new Set(doc.rows.filter((r) => r.text.includes("הנחה")).flatMap((r) => percentages(r.text)))];
}

const close = (a: number, b: number) => Math.abs(a - b) <= ABS_TOLERANCE + REL_TOLERANCE * Math.abs(b);

/** Every reading of a row's amounts that multiplies out (quantity right of price, price right of total). */
function rowReadings(row: Row, docDiscounts: number[]): Arithmetic[] {
  const nums = amounts(row).sort((a, b) => a.cell.x - b.cell.x);
  if (nums.length < 3) return [];
  const rowDiscounts = percentages(row.text);
  const readings: Arithmetic[] = [];
  for (let t = 0; t < nums.length; t++) {
    const total = nums[t];
    if (total.value < 0) continue;
    for (let p = t + 1; p < nums.length; p++) {
      const price = nums[p];
      // A free line (price and total 0) is kept: a delivery charged nothing is still a delivery.
      if (price.value < 0 || (price.value === 0) !== (total.value === 0)) continue;
      // A second, discounted price column between the price and the total.
      const implied = nums
        .slice(t + 1, p)
        .map((n) => 1 - n.value / price.value)
        .filter((d) => d > 0 && d <= MAX_DISCOUNT);
      for (let q = p + 1; q < nums.length; q++) {
        const quantity = nums[q];
        if (quantity.value <= 0) continue;
        for (const discount of [0, ...rowDiscounts, ...docDiscounts, ...implied]) {
          if (close(quantity.value * price.value * (1 - discount), total.value)) {
            readings.push({ quantity, price, total, discount });
            break;
          }
        }
      }
    }
  }
  return readings;
}

/**
 * Among a row's readings, prefer the highest price: the list price with its
 * discount, not the discounted price. Within the table's columns when known
 * (6 × 50 = 300 reads either way).
 */
function bestReading(readings: Arithmetic[], columns?: TableColumns): Arithmetic | null {
  const near = (x: number, column: number) => Math.abs(x - column) <= COLUMN_TOLERANCE;
  const fits = columns
    ? readings.filter(
        (r) =>
          near(r.total.cell.x, columns.totalX) &&
          near(r.price.cell.x, columns.priceX) &&
          columns.quantityXs.some((x) => near(r.quantity.cell.x, x)),
      )
    : readings;
  return fits.reduce<Arithmetic | null>((best, r) => (!best || r.price.value > best.price.value ? r : best), null);
}

type TableColumns = { totalX: number; priceX: number; quantityXs: number[] };

/**
 * Item rows: rows that multiply out, with their price and total in the
 * columns most such rows use (other tables on the invoice are laid out
 * differently), and their quantity in a column several rows use, so a row
 * number or code that happens to multiply out is not taken for a quantity.
 * Free lines (0 × price) only count inside those columns.
 */
function findItemRows(doc: PdfDocument, docDiscounts: number[]): { rows: ItemRow[] } {
  const candidates = doc.rows
    .filter((row) => !SUMMARY_ROW.test(row.text))
    .map((row) => ({ row, readings: rowReadings(row, docDiscounts) }))
    .filter((c) => c.readings.length > 0);
  const first = candidates.flatMap((c) => bestReading(c.readings.filter((r) => r.total.value > 0)) ?? []);
  if (first.length === 0) return { rows: [] };
  const columns: TableColumns = {
    totalX: modalX(first.map((r) => r.total.cell.x)),
    priceX: modalX(first.map((r) => r.price.cell.x)),
    // Several columns: unit-priced rows have their quantity under the package count.
    quantityXs: frequentXs(
      first.map((r) => r.quantity.cell.x),
      Math.max(2, Math.ceil(first.length * QUANTITY_COLUMN_SHARE)),
    ),
  };
  return {
    rows: candidates.flatMap(({ row, readings }) => {
      const math = bestReading(readings, columns);
      return math ? [{ row, math }] : [];
    }),
  };
}

/** The x shared (within the column tolerance) by most values. */
function modalX(xs: number[]): number {
  let best = xs[0];
  let bestCount = 0;
  for (const x of xs) {
    const count = xs.filter((y) => Math.abs(y - x) <= COLUMN_TOLERANCE).length;
    if (count > bestCount) {
      best = x;
      bestCount = count;
    }
  }
  return best;
}

/** The x's (one per column) shared by at least `minCount` values. */
function frequentXs(xs: number[], minCount: number): number[] {
  const columns: number[] = [];
  for (const x of xs) {
    if (columns.some((c) => Math.abs(c - x) <= COLUMN_TOLERANCE)) continue;
    if (xs.filter((y) => Math.abs(y - x) <= COLUMN_TOLERANCE).length >= minCount) columns.push(x);
  }
  return columns;
}

/* ------------------------------------------------------------------ */
/* Headers and the other fields of a row                               */
/* ------------------------------------------------------------------ */

/**
 * Column names above a page's first item row. Headers printed over two or
 * three lines ("מחיר" over "ליחידה") are joined top to bottom. Rows with
 * digits (group rows such as "תאריך תעודה: 16/08/26") are not headers.
 */
function headerColumns(doc: PdfDocument, firstItem: Row): HeaderColumn[] {
  const above = doc.rows.filter(
    (r) =>
      r.page === firstItem.page &&
      r.y > firstItem.y &&
      r.y - firstItem.y <= HEADER_REACH &&
      !/\d{2}/.test(r.text) &&
      r.cells.some((c) => headerField(c.text) != null),
  );
  // The header block is the run of such rows nearest the item rows.
  const block: Row[] = [];
  for (const row of [...above].sort((a, b) => a.y - b.y)) {
    const last = block.at(-1);
    if (last && row.y - last.y > 16) break;
    block.push(row);
  }
  const columns: HeaderColumn[] = [];
  for (const row of block.reverse()) {
    for (const cell of row.cells) {
      const over = columns.find((c) => cell.xMin <= c.xMax && cell.xMax >= c.xMin);
      if (over) {
        over.label = `${over.label} ${cell.text}`;
        over.xMin = Math.min(over.xMin, cell.xMin);
        over.xMax = Math.max(over.xMax, cell.xMax);
        over.x = (over.xMin + over.xMax) / 2;
      } else {
        columns.push({ x: cell.x, xMin: cell.xMin, xMax: cell.xMax, label: cell.text, field: null });
      }
    }
  }
  for (const column of columns) column.field = headerField(column.label) ?? firstField(column.label);
  return columns;
}

/** A joined label no pattern knows: try its parts ("אסמכתא" + "נוספת"). */
function firstField(label: string): HeaderField | null {
  for (const part of label.split(" ")) {
    const field = headerField(part);
    if (field) return field;
  }
  return null;
}

/** The top of the page's header block, so group rows above it (titles) are ignored. */
function headerTop(doc: PdfDocument, page: number): number {
  const rows = doc.rows.filter(
    (r) => r.page === page && r.cells.filter((c) => headerField(c.text) != null).length >= 2 && !/\d{2}/.test(r.text),
  );
  return rows.length > 0 ? Math.max(...rows.map((r) => r.y)) + 1 : Infinity;
}

type RowFields = {
  date: string | null;
  doc: string | null;
  bookRef: string | null;
  sku: string | null;
  variety: string;
  packages: number | null;
  unit: string;
  /** Cells left for the description. */
  text: Cell[];
  descriptionX: number | null;
};

function nearestColumn(columns: HeaderColumn[], cell: Cell): HeaderColumn | null {
  let best: HeaderColumn | null = null;
  for (const c of columns) {
    const inside = cell.x >= c.xMin - 4 && cell.x <= c.xMax + 4;
    const d = inside ? 0 : Math.abs(c.x - cell.x);
    if (!best || d < (cell.x >= best.xMin - 4 && cell.x <= best.xMax + 4 ? 0 : Math.abs(best.x - cell.x))) best = c;
  }
  return best;
}

const CODE_FIELDS = new Set<HeaderField | null>(["doc", "bookRef", "sku", "date"]);

const DOC_TOKEN = /^(?:[A-Z]{1,3}\d{5,}|\d+[A-Z]{1,3}\d{5,}|\d{1,3}\/\d{5,}|\d{4,8})$/;

function rowFields(row: Row, math: Arithmetic, columns: HeaderColumn[], invoiceDate: string | null): RowFields {
  const used = new Set([math.quantity.cell, math.price.cell, math.total.cell]);
  const out: RowFields = {
    date: null,
    doc: null,
    bookRef: null,
    sku: null,
    variety: "",
    packages: null,
    unit: unitOf(math.quantity.cell.text),
    text: [],
    descriptionX: null,
  };
  const variety: string[] = [];
  let packedCount: number | null = null;
  const hasDocColumn = columns.some((c) => c.field === "doc");

  for (const cell of row.cells) {
    if (used.has(cell)) continue;
    const text = cell.text.trim();
    const date = cellDate(text, invoiceDate);
    if (date && !out.date) {
      out.date = date;
      continue;
    }
    let column = nearestColumn(columns, cell);
    // Codes have no letters: a Hebrew cell near a code column is a right-aligned name.
    if (hasHebrew(text) && column && CODE_FIELDS.has(column.field!)) column = null;
    switch (column?.field) {
      case "doc":
        // A second document column (AGROLINE's "אסמכתא" after "ת.משלוח") is the booklet reference.
        if (out.doc == null) out.doc = text;
        else out.bookRef ??= text;
        continue;
      case "bookRef":
        out.bookRef ??= text;
        continue;
      case "sku":
        out.sku ??= text.replace(/^\*+|\*+$/g, "");
        continue;
      case "unit":
        out.unit ||= text;
        continue;
      case "variety":
        variety.push(text);
        continue;
      case "packages":
      case "quantity":
        if (out.packages == null && readAmount(text) != null) {
          out.packages = readAmount(text);
          continue;
        }
        break;
      case "unitPrice":
      case "netPrice":
      case "total":
      case "discount":
      case "pallet":
        continue;
    }
    if (!hasDocColumn && !out.doc && DOC_TOKEN.test(text)) {
      out.doc = text;
      continue;
    }
    if (column?.field === "packageType") {
      // "קר +18.5שק רש 54": the package count can run into the package type.
      packedCount ??= parseNumber(text.match(/\s(\d+)$/)?.[1]);
      continue;
    }
    if (column?.field === "description" || hasHebrew(text)) {
      if (text && UNITS.has(text.replace(QUOTES, ""))) continue;
      out.text.push(cell);
      if (column?.field === "description") out.descriptionX ??= column.x;
    }
  }
  out.variety = variety.join(" ");
  out.packages ??= packedCount;
  // Unit-priced rows (no weight) have their quantity under the package count.
  const column = nearestColumn(columns, math.quantity.cell);
  const weighed = columns.some((c) => /משקל/.test(c.label));
  if (column && /משקל/.test(column.label)) {
    out.unit ||= 'ק"ג';
  } else if (column?.field === "packages" || (column?.field === "quantity" && weighed)) {
    out.packages ??= math.quantity.value;
    out.unit ||= "יח'";
  }
  return out;
}

/** A wrapped piece of a name: a lone Hebrew cell under the description, not beside an item row. */
function isNameLine(row: Row, descriptionX: number, itemYs: number[]): boolean {
  return (
    row.cells.length === 1 &&
    hasHebrew(row.cells[0].text) &&
    Math.abs(row.cells[0].x - descriptionX) <= 30 &&
    !itemYs.some((y) => Math.abs(y - row.y) <= 8)
  );
}

/** The description: its cells, plus lines of a long name wrapped above and below the row. */
function describe(rows: Row[], row: Row, fields: RowFields, columns: HeaderColumn[]): string {
  const text = fields.text.map((c) => c.text).join(" ");
  const x = fields.descriptionX ?? columns.find((c) => c.field === "description")?.x;
  return x == null ? text : wrappedText(rows, row, x, text);
}

function unitOf(quantityText: string): string {
  const unit = quantityText.replace(/[\d.,:\s-]/g, "");
  // "'2.00 יח": a quote moved before the number belongs after the unit.
  return unit.replace(/^(["'״׳])(.+)$/, "$2$1");
}

/* ------------------------------------------------------------------ */
/* Dates, group rows and the invoice's own number                      */
/* ------------------------------------------------------------------ */

/** "16/09/26", "01/09/2026", or "2/09" (the invoice's year). */
function cellDate(text: string, invoiceDate: string | null): string | null {
  if (/^\d{1,2}\/\d{1,2}\/(?:\d{2}|\d{4})$/.test(text)) return parseDate(text);
  const short = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!short || !invoiceDate) return null;
  const [day, month] = [Number(short[1]), Number(short[2])];
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const [year, invoiceMonth] = invoiceDate.split("-").map(Number);
  const y = month > invoiceMonth ? year - 1 : year;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * A group row: "תאריך תעודה: 16/08/26, תעודה: 2SH2605403, מספר פנקס: 26386",
 * "01/09/2026 53215 ת.מ משלוח".
 */
function updateContext(context: { date: string | null; doc: string | null; bookRef: string | null }, text: string): void {
  const date = text.match(/\b(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))\b/)?.[1];
  const doc =
    text.match(/(?<!תאריך )תעודה\s*:?\s*([A-Z0-9]*\d[A-Z0-9]*)(?![\d/])/)?.[1] ??
    text.match(/(\d{4,})\s+ת\.?\s*מ\.?\s*משלוח/)?.[1] ??
    text.match(/משלוח\s*:?\s*(\d{4,})/)?.[1];
  const bookRef = text.match(/פנקס\s*:?\s*(\d[\d-]*\d|\d)/)?.[1];
  if (!date && !doc && !bookRef) return;
  if (date) context.date = parseDate(date) ?? context.date;
  if (doc) {
    context.doc = doc;
    context.bookRef = bookRef ?? null;
  } else if (bookRef) {
    context.bookRef = bookRef;
  }
}

function findInvoiceDate(doc: PdfDocument): string | null {
  const labelled = doc.text.match(/תאריך(?: חשבונית)?\s*:?\s*(\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2}))/)?.[1];
  if (labelled) return parseDate(labelled);
  const any = doc.rows.slice(0, 15).map((r) => r.text.match(/\b\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})\b/)?.[0]).find(Boolean);
  return parseDate(any);
}

function findInvoiceNumber(doc: PdfDocument): string {
  for (const row of doc.rows.slice(0, 25)) {
    if (!row.text.includes("חשבונית")) continue;
    const token = row.cells.map((c) => c.text.match(/\b([A-Z]{0,3}\d{4,}[A-Z0-9]*)\b/)?.[1]).find((t) => t && !/^\d{9}$/.test(t));
    if (token) return token;
  }
  return doc.text.match(/No\.?\s*-?(\d{3,})/)?.[1] ?? "";
}

/* ------------------------------------------------------------------ */
/* Totals                                                              */
/* ------------------------------------------------------------------ */

/**
 * When every line multiplied out without a discount but the footer prints
 * one, and a printed total equals the lines less that discount, the line
 * totals were gross: restate them net, as the other parsers do.
 */
function applyFooterDiscount(doc: PdfDocument, lines: SupplierLine[], discounts: number[]): number | null {
  if (lines.some((l) => l.discountPct !== 0)) return null;
  const sum = lines.reduce((s, l) => s + l.lineTotal, 0);
  const printed = printedAmounts(doc, new Map());
  for (const d of discounts) {
    const net = round2(sum * (1 - d));
    if (!printed.some((p) => Math.abs(p - net) <= 1)) continue;
    for (const line of lines) {
      line.discountPct = d;
      line.lineTotal = round2(line.lineTotal * (1 - d));
    }
    return d;
  }
  return null;
}

/** Amounts on rows that look like totals ("סה"כ כללי", "מחיר כולל", "סה"כ נטו סחורה"…). */
function printedAmounts(doc: PdfDocument, items: Map<Row, ItemRow>): number[] {
  return doc.rows
    .filter((r) => !items.has(r) && TOTAL_LABEL.test(r.text))
    .flatMap((r) => r.cells.filter((c) => /\d\.\d{2}\b/.test(c.text) && !c.text.includes("%")))
    .map((c) => parseNumber(c.text))
    .filter((v): v is number => v != null);
}

/** A printed total within a shekel of `value` (net totals drift by per-line rounding). */
function printedNear(doc: PdfDocument, items: Map<Row, ItemRow>, value: number): number | null {
  return printedAmounts(doc, items).find((p) => Math.abs(p - value) <= 1) ?? null;
}

type TotalMatch = { items: number; adjustment: number | null; gap: number };

/**
 * The printed items total the lines add up to (less pallets when it includes
 * them), or null. Failing an exact match, a gap no larger than a rounding or
 * general-discount amount printed on the invoice is accepted: suppliers
 * spread such an amount over the totals they print.
 */
function matchPrintedTotal(
  doc: PdfDocument,
  items: Map<Row, ItemRow>,
  candidates: { value: number; items: number }[],
): TotalMatch | null {
  const printed = printedAmounts(doc, items);
  for (const candidate of candidates) {
    if (printed.some((p) => Math.abs(Math.abs(p) - candidate.value) <= TOTAL_TOLERANCE)) {
      return { items: candidate.items, adjustment: null, gap: 0 };
    }
  }
  for (const adjustment of printedAdjustments(doc)) {
    for (const candidate of candidates) {
      const p = printed.find((p) => Math.abs(Math.abs(p) - candidate.value) <= Math.abs(adjustment) + TOTAL_TOLERANCE);
      if (p != null) return { items: candidate.items, adjustment, gap: round2(Math.abs(Math.abs(p) - candidate.value)) };
    }
  }
  return null;
}

/** A rounding or general-discount amount is at most this (₪); larger ones are real discounts. */
const MAX_ADJUSTMENT = 1;
/** An amount can print a few points off its label's row. */
const ADJUSTMENT_REACH = 4;

/** Small amounts printed beside "הנחה כללית", "עיגול" or "הפרש". */
function printedAdjustments(doc: PdfDocument): number[] {
  const labels = doc.rows.filter((r) => ADJUSTMENT_ROW.test(r.text));
  return labels
    .flatMap((label) => doc.rows.filter((r) => r.page === label.page && Math.abs(r.y - label.y) <= ADJUSTMENT_REACH))
    .flatMap((r) => r.cells)
    .filter((c) => /\d\.\d{2}$/.test(c.text.trim()))
    .map((c) => readAmount(c.text))
    .filter((v): v is number => v != null && v !== 0 && Math.abs(v) <= MAX_ADJUSTMENT);
}

/** For a refusal: the printed total nearest the lines, and the pallets left out. */
function totalsHint(doc: PdfDocument, items: Map<Row, ItemRow>, sum: number, pallets: number): string {
  const printed = printedAmounts(doc, items);
  if (printed.length === 0) return " (לא נמצא סה\"כ מודפס)";
  const nearest = printed.reduce((best, p) => (Math.abs(Math.abs(p) - sum) < Math.abs(Math.abs(best) - sum) ? p : best));
  return ` (הקרוב ביותר: ${nearest}, הפרש ${round2(Math.abs(nearest) - sum)}; משטחים/פיקדונות שזוהו: ${round2(pallets)})`;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
