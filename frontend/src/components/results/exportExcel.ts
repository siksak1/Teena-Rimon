import { type SummaryRow, summarizeExcel } from "@core/excel/summary.js";
import type { ExtractionResult, MatchGroup, OwnLine, ReconciliationResult, SupplierLine } from "@core/model.js";
import customer from "@customer-config";
import writeXlsxFile, { type Cell, type Row, type Sheet } from "write-excel-file/browser";
import { FLAG_LABEL, ownItem, ownNet, shownDateDelta, supplierItemMarked, supplierRef } from "./format";

const MONEY = "#,##0.00";
const SIGNED_MONEY = "+#,##0.00;-#,##0.00;0";
const SIGNED_NUM = "+#,##0.###;-#,##0.###;0";
const NUM = "#,##0.###";
const PERCENT = "0.##%";

const header = (titles: string[]): Row =>
  titles.map((value) => ({ value, fontWeight: "bold", backgroundColor: "#EEF3F0" }));

/** ISO "2026-09-01" → a date cell (the library writes dates as UTC). */
function date(iso: string | null): Cell {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return { value: new Date(Date.UTC(y, m - 1, d)), format: "dd/mm/yy" };
}

const number = (value: number | null, format = NUM): Cell => (value == null ? null : { value, format });
const text = (value: string | null): Cell => (value ? value : null);

function sheet(name: string, data: Row[], widths: number[]): Sheet<Blob> {
  return { sheet: name, data, columns: widths.map((width) => ({ width })), rightToLeft: true, stickyRowsCount: 1 };
}

const GROUP_HEADERS = [
  "קבוצה",
  "צד",
  "תאריך",
  "תעודה / אסמכתא",
  "פריט",
  "אריזות",
  'ק"ג',
  "מחיר",
  "הנחה",
  'סה"כ נטו',
  "סטטוס",
  "הערות",
  "הפרש אריזות",
  'הפרש ק"ג',
  "הפרש ימים",
  'הפרש ₪',
];
const GROUP_WIDTHS = [8, 10, 10, 20, 32, 9, 10, 9, 8, 12, 18, 50, 11, 10, 10, 12];

/** Each line of each group, then a summary row with the group's status and differences. */
function groupRows(groups: MatchGroup[], ownDiscountPct: number): Row[] {
  const rows: Row[] = [header(GROUP_HEADERS)];
  const push = (row: Row) => rows.push(row);
  for (const g of groups) {
    for (const l of g.supplierLines) {
      push([
        g.id,
        "ספק",
        date(l.date),
        text(supplierRef(l)),
        supplierItemMarked(l),
        number(l.packages),
        number(l.quantity),
        number(l.unitPrice),
        number(l.discountPct, PERCENT),
        number(l.lineTotal, MONEY),
      ]);
    }
    for (const l of g.ownLines) {
      push([
        g.id,
        customer.shortName,
        date(l.date),
        text(l.supplierRef),
        ownItem(l),
        number(l.packages),
        number(l.quantity),
        number(l.unitPrice),
        number(ownDiscountPct, PERCENT),
        number(ownNet(l, ownDiscountPct), MONEY),
      ]);
    }
    const fill = g.netDiff !== 0 ? "#FBE9E7" : g.flags.length ? "#FFF6E5" : "#EAF5EE";
    const cell = (value?: string | number | null, format?: string): Cell => ({
      value: value ?? undefined,
      // The library rejects a format on an empty cell.
      ...(value == null ? {} : { format }),
      fontWeight: "bold",
      backgroundColor: fill,
      wrap: true,
    });
    rows.push([
      cell(g.id),
      cell("סיכום קבוצה"),
      ...Array.from({ length: 8 }, () => cell()),
      cell(g.flags.length ? g.flags.map((f) => FLAG_LABEL[f]).join(", ") : "תואם"),
      cell(g.notes.join("\n")),
      cell(g.packagesDiff || null, SIGNED_NUM),
      cell(g.quantityDiff || null, SIGNED_NUM),
      cell(shownDateDelta(g.dateDelta), SIGNED_NUM),
      cell(g.netDiff, SIGNED_MONEY),
    ]);
  }
  return rows;
}

function supplierOnlyRows(lines: SupplierLine[]): Row[] {
  return [
    header(["שורה", "תאריך", "תעודה", "פנקס", "פריט", "אריזות", 'ק"ג', "מחיר", "הנחה", 'סה"כ נטו']),
    ...lines.map((l): Row => [
      l.id,
      date(l.date),
      text(l.docNumber),
      text(l.bookRef),
      supplierItemMarked(l),
      number(l.packages),
      number(l.quantity),
      number(l.unitPrice),
      number(l.discountPct, PERCENT),
      number(l.lineTotal, MONEY),
    ]),
  ];
}

function ownOnlyRows(lines: OwnLine[]): Row[] {
  return [
    header(["שורה", "תאריך", `מסמך ${customer.shortName}`, "אסמכתא", "פריט", "אריזות", 'ק"ג', "מחיר", "סכום (לפני הנחה)"]),
    ...lines.map((l): Row => [
      l.id,
      date(l.date),
      l.ownDocNumber,
      text(l.supplierRef),
      ownItem(l),
      number(l.packages),
      number(l.quantity),
      number(l.unitPrice),
      number(l.lineTotal, MONEY),
    ]),
  ];
}

function summaryRows(extraction: ExtractionResult, result: ReconciliationResult, mainGroups: MatchGroup[]): Row[] {
  const { supplier, own } = extraction;
  const { totals } = result;
  const ownName = customer.displayName;
  const label = (value: string): Cell => ({ value, fontWeight: "bold" });
  const head: Row[] = [
    [label("ספק"), supplier.supplierName],
    [label("חשבונית ספק"), supplier.invoiceNumber],
    [label("תאריך חשבונית"), date(supplier.invoiceDate)],
    [label(`מסמך ${ownName}`), own.documentNumber],
    [label("כנגד חשבונית"), text(own.againstInvoice)],
    [],
    [label('ספק — סה"כ פריטים נטו'), number(totals.supplierNet, MONEY)],
    [label(`${ownName} — סה"כ לפני הנחה`), number(totals.ownGross, MONEY)],
    [label(`${ownName} — הנחה מסחרית`), number(totals.ownDiscountPct, PERCENT)],
    [label(`${ownName} — סה"כ נטו`), number(totals.ownNet, MONEY)],
  ];
  return [
    ...head,
    [label(`פער (${ownName} פחות ספק)`), number(totals.diff, SIGNED_MONEY)],
    [],
    [label("קבוצות שהוצמדו"), result.groups.length],
    [label("עם פערים"), result.groups.filter((g) => g.flags.length > 0).length],
    [label("עם פער כספי"), mainGroups.filter((g) => g.netDiff !== 0).length],
    [label("רק אצל הספק"), result.supplierOnly.length],
    [label(`רק אצל ${ownName}`), result.ownOnly.length],
    [label("קיזוז פערים"), result.offset.applies ? `כן (${result.offset.groups.length} קבוצות)` : "לא"],
    ...(result.warnings.length ? [[], [label("אזהרות קריאה")], ...result.warnings.map((w): Row => [w])] : []),
  ];
}

/** PDF invoices: writes the whole comparison — every table, regardless of what is collapsed or filtered on screen. */
export async function exportReconciliation(extraction: ExtractionResult, result: ReconciliationResult): Promise<void> {
  const ownDiscountPct = result.totals.ownDiscountPct;
  const offsetIds = new Set(result.offset.groups.map((g) => g.id));
  const mainGroups = result.groups.filter((g) => !offsetIds.has(g.id));

  const sheets = [
    sheet("סיכום", summaryRows(extraction, result, mainGroups), [30, 40]),
    sheet("שורות שהוצמדו", groupRows(mainGroups, ownDiscountPct), GROUP_WIDTHS),
    sheet("רק אצל הספק", supplierOnlyRows(result.supplierOnly), [8, 10, 14, 12, 32, 9, 10, 9, 8, 12]),
    sheet(`רק אצל ${customer.shortName}`, ownOnlyRows(result.ownOnly), [8, 10, 12, 14, 32, 9, 10, 9, 16]),
  ];
  if (result.offset.applies && result.offset.groups.length) {
    sheets.push(sheet("קיזוז", groupRows(result.offset.groups, ownDiscountPct), GROUP_WIDTHS));
  }

  const name = `התאמה - ${extraction.supplier.supplierName} - ${extraction.supplier.invoiceNumber}`;
  await writeXlsxFile(sheets).toFile(`${fileName(name)}.xlsx`);
}

const fileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_");

/* Excel reports: one row per delivery note and product, both reports side by side. */

/** Accounting format: thousands, no decimals shown, zero as "-". */
const ACCOUNTING = '_ * #,##0_ ;_ * \\-#,##0_ ;_ * "-"??_ ;_ @_ ';
const BORDER = { borderStyle: "thin", borderColor: "#000000" } as const;
/** A cost that can't be totalled because a price is 0: the user has to fill it in. */
const MISSING_PRICE = { value: "-", align: "center", backgroundColor: "#FFF2CC", ...BORDER } as const;
const SUMMARY_WIDTHS = [10, 10, 27, 18, 11, 14, 11, 13, 12, 12];

function summaryHeader(): Row {
  const ownName = customer.displayName;
  return [
    "תאריך",
    "אסמכתא",
    "מגדל",
    "תוצרת",
    "סך הכל משקל אצל הספק",
    `סך הכל משקל ${ownName}`,
    "הפרש משקלים",
    "סך הכל עלות הספק",
    `סך הכל עלות ${ownName}`,
    "הפרש סך הכל עלות",
  ].map((value) => ({
    value,
    fontWeight: "bold",
    backgroundColor: "#E2EFDA",
    align: "center",
    alignVertical: "center",
    wrap: true,
    height: 45,
    ...BORDER,
  }));
}

function summaryRow(r: SummaryRow): Row {
  const amount = (value: number | null): Cell =>
    value == null ? MISSING_PRICE : { value, format: ACCOUNTING, ...BORDER };
  const ref = /^\d+$/.test(r.ref) ? Number(r.ref) : r.ref;
  return [
    r.date ? { ...date(r.date)!, format: "dd/mm/yyyy", ...BORDER } : { value: undefined, ...BORDER },
    ref === "" ? { value: undefined, ...BORDER } : { value: ref, ...BORDER },
    { value: r.grower || undefined, ...BORDER },
    { value: r.product || undefined, ...BORDER },
    amount(r.supplier.weight),
    amount(r.own.weight),
    amount(r.weightDiff),
    amount(r.supplier.cost),
    amount(r.own.cost),
    amount(r.costDiff),
  ];
}

function summarySheet(name: string, rows: SummaryRow[]): Sheet<Blob> {
  const data = [summaryHeader(), ...rows.map(summaryRow)];
  if (rows.length) {
    const last = rows.length + 1;
    const bold = { fontWeight: "bold", ...BORDER } as const;
    data.push([
      { value: 'סה"כ', ...bold },
      { value: undefined, ...bold },
      { value: undefined, ...bold },
      { value: undefined, ...bold },
      ...["E", "F", "G", "H", "I", "J"].map(
        (col): Cell => ({ type: "Formula", value: `SUM(${col}2:${col}${last})`, format: ACCOUNTING, ...bold }),
      ),
    ]);
  }
  return sheet(name, data, SUMMARY_WIDTHS);
}

/** Excel reports: the side-by-side comparison, plus Teena-Rimon rows from outside the supplier's period. */
export async function exportExcelSummary(extraction: ExtractionResult): Promise<void> {
  const { rows, outOfPeriod } = summarizeExcel(extraction, customer);
  const sheets = [summarySheet("השוואה מרוכזת", rows)];
  if (outOfPeriod.length) sheets.push(summarySheet("מחוץ לתקופה", outOfPeriod));
  const name = `השוואת ספק - ${extraction.meta.supplierFileName.replace(/\.xlsx$/i, "")}`;
  await writeXlsxFile(sheets).toFile(`${fileName(name)}.xlsx`);
}
