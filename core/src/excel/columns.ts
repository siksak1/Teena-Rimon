/**
 * Finds what each spreadsheet column holds from its values, so reports with
 * any column names and order can be read. Header names only add a small
 * bonus that settles near-ties. The two reports are resolved together: the
 * delivery-note column is the one whose values also appear in the other
 * report (a report may carry its own document numbers too).
 */
import { SUMMARY_ROW } from "../parsers/genericHeaders.js";
import { NameMatcher } from "../reconcile/names/NameMatcher.js";
import { type ExcelField, FIELD_LABELS } from "./fields.js";
import { type Cell, isoDate, normalizeHeader, number, reference, text } from "./read.js";

export { type ExcelField, FIELD_LABELS };

const REQUIRED: ExcelField[] = ["product", "weight", "price"];
const EXPECTED: ExcelField[] = ["grower", "date", "doc"];

/** One sheet read for detection: data rows and a profile per column. */
export type SheetLayout = {
  /** Data rows, with their 1-based row number in the sheet. */
  rows: { cells: Cell[]; sheetRow: number }[];
  columns: ColumnProfile[];
};

export type ColumnProfile = {
  index: number;
  /** Header text, or "" when the sheet has no header row. */
  header: string;
  /** Header text, or the column letter: how warnings name the column. */
  label: string;
  hint: HeaderHint | null;
  values: Cell[];
  fill: number;
  distinct: number;
  /** Shares of the filled cells. */
  numeric: number;
  integer: number;
  date: number;
  /** Share of filled cells repeating the cell above. */
  run: number;
  median: number;
  /** Share of filled cells that the product dictionary recognises. */
  dictionary: number;
};

/** What was found where. Values are column indexes. */
export type ColumnMap = {
  fields: Partial<Record<ExcelField, number>>;
  /** Variety / size / grade columns, in sheet order (joined into the name). */
  extras: number[];
  warnings: string[];
  /** Field → column label, for the "columns used" line. */
  used: Partial<Record<ExcelField, string>>;
};

export class MissingColumnsError extends Error {
  readonly side: "own" | "supplier";
  readonly fields: ExcelField[];

  constructor(side: "own" | "supplier", fields: ExcelField[]) {
    super(fields.map((f) => FIELD_LABELS[f]).join(", "));
    this.side = side;
    this.fields = fields;
  }
}

/* ------------------------------------------------------------------ */
/* Sheet layout                                                        */
/* ------------------------------------------------------------------ */

const isDateCell = (c: Cell) => c instanceof Date || (typeof c === "string" && isoDate(c) != null);
const isNumberCell = (c: Cell) => !isDateCell(c) && number(c) != null;
const isFilled = (c: Cell) => text(c) !== "";
const isLabelCell = (c: Cell) => isFilled(c) && !isDateCell(c) && !isNumberCell(c);
const dataLike = (row: Cell[]) => row.filter((c) => isNumberCell(c) || isDateCell(c)).length >= 2;

/** "A", "B", … "AA": how Excel names a column. */
function columnLetter(index: number): string {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function readLayout(sheet: Cell[][]): SheetLayout {
  // The data starts at the first of two data-like rows in a row (a title row may carry a date).
  let first = sheet.findIndex((row, i) => dataLike(row) && dataLike(sheet[i + 1] ?? row));
  if (first < 0) first = sheet.length;
  // The header is the nearest row above it made only of labels; there may be none.
  let headerIndex = -1;
  for (let i = first - 1; i >= 0 && i >= first - 15; i--) {
    if (sheet[i].some(isFilled)) {
      if (sheet[i].filter(isFilled).every(isLabelCell)) headerIndex = i;
      break;
    }
  }
  const header = headerIndex >= 0 ? sheet[headerIndex] : [];
  const rows = sheet
    .slice(first)
    .map((cells, i) => ({ cells, sheetRow: first + i + 1 }))
    .filter(({ cells }) => cells.some(isFilled))
    .filter(({ cells }) => !cells.some((c) => typeof c === "string" && SUMMARY_ROW.test(c)));
  const width = Math.max(header.length, ...rows.map((r) => r.cells.length), 0);
  const matcher = new NameMatcher();
  const columns = Array.from({ length: width }, (_, index) =>
    profile(index, normalizeHeader(header[index] ?? null), rows.map((r) => r.cells[index] ?? null), matcher),
  );
  return { rows, columns };
}

function profile(index: number, header: string, values: Cell[], matcher: NameMatcher): ColumnProfile {
  const filled = values.filter(isFilled);
  const n = filled.length || 1;
  const numbers = filled.map((c) => (isNumberCell(c) ? number(c) : null)).filter((v): v is number => v != null);
  const keys = values.map(key);
  let runs = 0;
  for (let i = 1; i < keys.length; i++) if (keys[i] && keys[i] === keys[i - 1]) runs++;
  const labels = filled.filter(isLabelCell);
  const known = labels.filter((c) => matcher.parse(text(c)).familySource === "dictionary").length;
  return {
    index,
    header,
    label: header || `עמודה ${columnLetter(index)}`,
    hint: headerHint(header),
    values,
    fill: filled.length / (values.length || 1),
    distinct: new Set(keys.filter(Boolean)).size,
    numeric: numbers.length / n,
    integer: numbers.filter(Number.isInteger).length / n,
    date: filled.filter(isDateCell).length / n,
    run: runs / n,
    median: median(numbers),
    dictionary: known / n,
  };
}

/** A cell as a comparable string: 909805, "909805" and " 909805 " are one value. */
function key(c: Cell): string {
  if (c instanceof Date) return isoDate(c) ?? "";
  return reference(c);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/* ------------------------------------------------------------------ */
/* Header hints (a tie-breaker only)                                   */
/* ------------------------------------------------------------------ */

type HeaderHint = ExcelField | "extra" | "ignore";

const Q = `["'״׳]?`;
/** First match wins. Names seen so far in Excel reports; values decide, these only break near-ties. */
const HEADER_HINTS: [HeaderHint, RegExp][] = [
  ["ignore", /יעד|רכב|הערה/],
  ["extra", /זן|גודל|איכות/],
  ["grower", /מגדל|ספק|לקוח|משק/],
  ["date", /תאריך/],
  ["price", /מחיר/],
  ["weight", /משקל|ק"ג|קילו/],
  ["packages", /כמות|אריזות|ארגזים|קרטונים|יחידות/],
  ["doc", /אסמכתא|תעודה|משלוח/],
  ["product", new RegExp(`תאור|תיאור|תוצרת|מוצר|פריט|סחורה|מק${Q}ט`)],
];

function headerHint(header: string): HeaderHint | null {
  return HEADER_HINTS.find(([, pattern]) => pattern.test(header))?.[0] ?? null;
}

const HINT_BONUS = 0.15;
const bonus = (c: ColumnProfile, field: HeaderHint) => (c.hint === field ? HINT_BONUS : c.hint ? -HINT_BONUS / 3 : 0);

/** Below this margin between the best and the next column the choice is reported as a guess. */
const NEAR_TIE = 0.1;

/* ------------------------------------------------------------------ */
/* One sheet                                                           */
/* ------------------------------------------------------------------ */

type Detection = {
  layout: SheetLayout;
  fields: Partial<Record<ExcelField, number>>;
  /** Columns that look like document numbers, best first. */
  docCandidates: { index: number; score: number }[];
  extras: number[];
  warnings: string[];
};

const textual = (c: ColumnProfile) => c.fill > 0 && c.numeric < 0.5 && c.date < 0.5;

function best<T>(items: T[], score: (t: T) => number): { item: T; score: number; margin: number } | null {
  const ranked = items.map((item) => ({ item, score: score(item) })).sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  return { ...ranked[0], margin: ranked[0].score - (ranked[1]?.score ?? 0) };
}

function detectSheet(layout: SheetLayout): Detection {
  const fields: Partial<Record<ExcelField, number>> = {};
  const warnings: string[] = [];
  const taken = new Set<number>();
  const free = () => layout.columns.filter((c) => !taken.has(c.index) && c.fill > 0 && c.hint !== "ignore");
  const take = (field: ExcelField, pick: { item: ColumnProfile; score: number; margin: number } | null, min: number) => {
    if (!pick || pick.score < min) return;
    fields[field] = pick.item.index;
    taken.add(pick.item.index);
    if (pick.margin < NEAR_TIE) warnings.push(guess(pick.item, field));
  };

  take("date", best(free(), (c) => c.date * c.fill + bonus(c, "date")), 0.6);
  take("product", best(free().filter(textual), (c) => c.dictionary * c.fill + bonus(c, "product")), 0.3);
  // Growers: text the product dictionary doesn't know, in long runs. One value only is
  // more likely the report's destination ("תאנה ורימון") — unless the header says grower.
  take(
    "grower",
    best(
      free().filter((c) => textual(c) && (c.distinct > 1 || c.hint === "grower")),
      (c) => c.fill * (1 - c.dictionary) * (0.5 + 0.5 * c.run) + bonus(c, "grower") - (c.fill < 0.9 ? 0.3 : 0),
    ),
    0.3,
  );

  const numeric = free().filter((c) => c.numeric >= 0.9 && c.fill >= 0.8);
  const assignment = assignNumbers(layout, numeric, fields);
  for (const [field, index] of Object.entries(assignment.fields) as [ExcelField, number][]) {
    fields[field] = index;
    taken.add(index);
  }
  if (assignment.margin < NEAR_TIE && assignment.fields.weight != null) {
    for (const f of ["weight", "price", "packages"] as const) {
      if (assignment.fields[f] != null && assignment.runnerUp[f] !== assignment.fields[f]) {
        warnings.push(guess(layout.columns[assignment.fields[f]], f));
      }
    }
  }

  // Document numbers: whole numbers repeated over a delivery's rows, each value
  // belonging to one grower on one or two dates.
  const docCandidates = free()
    .filter((c) => c.integer >= 0.9 && c.fill >= 0.8 && c.distinct > 1)
    .map((c) => ({ index: c.index, score: docScore(layout, c, fields) + bonus(c, "doc") }))
    .filter((c) => c.score >= 0.4)
    .sort((a, b) => b.score - a.score);
  docCandidates.forEach((c) => taken.add(c.index));

  // Variety, size and grade: leftover text, and small numbers (sizes), in sheet order.
  const extras = free()
    .filter((c) => c.distinct > 1 && c.date < 0.5 && !(c.numeric >= 0.9 && c.median > 100))
    .map((c) => c.index);

  return { layout, fields, docCandidates, extras, warnings };
}

function guess(c: ColumnProfile, field: ExcelField): string {
  return `העמודה "${c.label}" זוהתה כ${FIELD_LABELS[field]} — לא בוודאות`;
}

const MIN_NUMBERS_SCORE = 0.6;

type NumberRoles = Partial<Record<"weight" | "price" | "packages", number>>;

/**
 * Tries every way of giving the number columns the roles weight, price and
 * packages (and "neither"), and keeps the best. What decides: weight ≥ packages
 * on almost every row, packages are whole numbers with a steady weight per
 * package, and the price is the smaller typical value that varies.
 */
function assignNumbers(
  layout: SheetLayout,
  columns: ColumnProfile[],
  known: Partial<Record<ExcelField, number>>,
): { fields: NumberRoles; runnerUp: NumberRoles; margin: number } {
  const roles = ["weight", "price", "packages"] as const;
  const options: { fields: NumberRoles; score: number }[] = [];
  const values = (index: number) => layout.rows.map((r) => number(r.cells[index] ?? null));

  // A column whose every value is one grower's delivery is a document number, not a measure.
  const docnessCache = new Map<number, number>();
  const docness = (index: number) => {
    if (!docnessCache.has(index)) docnessCache.set(index, documentShape(layout, layout.columns[index], known).strength);
    return docnessCache.get(index)!;
  };

  const recurse = (i: number, fields: NumberRoles) => {
    if (i === roles.length) {
      if (fields.weight != null && fields.price != null) options.push({ fields, score: scoreNumbers(fields) });
      return;
    }
    recurse(i + 1, fields); // role left empty
    for (const c of columns) {
      if (Object.values(fields).includes(c.index)) continue;
      recurse(i + 1, { ...fields, [roles[i]]: c.index });
    }
  };

  const scoreNumbers = (f: NumberRoles): number => {
    const w = values(f.weight!);
    const p = values(f.price!);
    const wc = layout.columns[f.weight!];
    const pc = layout.columns[f.price!];
    let score = 0;
    // Weight: mostly distinct values; price: smaller and repeated.
    score += Math.min(1, wc.distinct / Math.max(1, pc.distinct)) * 0.3;
    score += share(w, p, (a, b) => a >= b) * 0.6;
    score += (pc.median < wc.median ? 0.3 : 0) + (pc.median <= 500 ? 0.2 : -0.5);
    // Weight × price is a line's money: a document number in either role makes it absurd.
    score += median(w.map((x, i) => (x != null && p[i] != null ? x * p[i]! : 0))) <= 200000 ? 0.3 : -0.6;
    // Weighings rarely repeat row after row; document numbers do.
    score -= wc.run > 0.5 ? 0.4 : 0;
    score -= Object.values(f).reduce((sum, i) => sum + docness(i), 0);
    score += bonus(wc, "weight") + bonus(pc, "price");
    // Within a delivery the price may change from row to row; a document number never does.
    if (known.grower != null) score -= runWithin(layout, f.price!, known.grower) > 0.95 && pc.distinct < 3 ? 0.2 : 0;
    if (f.packages != null) {
      const k = values(f.packages);
      const kc = layout.columns[f.packages];
      score += kc.integer >= 0.95 ? 0.3 : -0.5;
      score += share(w, k, (a, b) => a >= b - 1e-9) >= 0.95 ? 0.4 : -0.6;
      score += steadyRatio(layout, w, k, known.product) * 0.3;
      // A package weighs something: a "count" just under the weight is a second weight (gross / net).
      score -= share(w, k, (a, b) => b > 0 && a > b && a / b < 1.15) > 0.5 ? 1.5 : 0;
      score += bonus(kc, "packages");
    } else {
      // Every column that could be packages ought to be: an unused whole-number
      // column under the weight is likely the package count.
      score -= 0.05;
    }
    return score;
  };

  recurse(0, {});
  options.sort((a, b) => b.score - a.score);
  // Real reports score above 1; below this no pair of columns reads as weight and price.
  if (options.length === 0 || options[0].score < MIN_NUMBERS_SCORE) return { fields: {}, runnerUp: {}, margin: 1 };
  const differing = options.find((o) => JSON.stringify(o.fields) !== JSON.stringify(options[0].fields));
  return {
    fields: options[0].fields,
    runnerUp: differing?.fields ?? {},
    margin: options[0].score - (differing?.score ?? -Infinity),
  };
}

/** Share of rows (with both values) where `test(a, b)` holds. */
function share(a: (number | null)[], b: (number | null)[], test: (a: number, b: number) => boolean): number {
  let n = 0;
  let yes = 0;
  a.forEach((x, i) => {
    const y = b[i];
    if (x == null || y == null) return;
    n++;
    if (test(x, y)) yes++;
  });
  return n ? yes / n : 0;
}

/** 1 when weight ÷ packages is steady within a product (kg per box), 0 when it is all over. */
function steadyRatio(layout: SheetLayout, w: (number | null)[], k: (number | null)[], product?: number): number {
  const byProduct = new Map<string, number[]>();
  layout.rows.forEach((r, i) => {
    const x = w[i];
    const y = k[i];
    if (x == null || !y) return;
    const name = product != null ? text(r.cells[product] ?? null) : "";
    byProduct.set(name, [...(byProduct.get(name) ?? []), x / y]);
  });
  const spreads = [...byProduct.values()]
    .filter((v) => v.length > 1)
    .map((v) => {
      const m = v.reduce((s, x) => s + x, 0) / v.length;
      const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
      return m > 0 ? sd / m : 1;
    });
  if (spreads.length === 0) return 0.5;
  const avg = spreads.reduce((s, x) => s + x, 0) / spreads.length;
  return Math.max(0, 1 - avg);
}

/** How often a column keeps its value between rows of the same group (grower). */
function runWithin(layout: SheetLayout, index: number, group: number): number {
  let n = 0;
  let same = 0;
  for (let i = 1; i < layout.rows.length; i++) {
    const a = layout.rows[i - 1].cells;
    const b = layout.rows[i].cells;
    if (key(a[group] ?? null) !== key(b[group] ?? null)) continue;
    n++;
    if (key(a[index] ?? null) === key(b[index] ?? null)) same++;
  }
  return n ? same / n : 0;
}

/**
 * How much a column behaves like a document number: each value spans a few
 * rows of a single grower on at most two dates (`pure`), and comes in runs.
 * `strength` needs all three, so measures that happen to repeat stay low.
 */
function documentShape(layout: SheetLayout, c: ColumnProfile, fields: Partial<Record<ExcelField, number>>) {
  const groups = new Map<string, { growers: Set<string>; dates: Set<string> }>();
  for (const r of layout.rows) {
    const k = key(r.cells[c.index] ?? null);
    if (!k) continue;
    const g = groups.get(k) ?? { growers: new Set(), dates: new Set() };
    if (fields.grower != null) g.growers.add(text(r.cells[fields.grower] ?? null));
    if (fields.date != null) g.dates.add(key(r.cells[fields.date] ?? null));
    groups.set(k, g);
  }
  const all = [...groups.values()];
  const pure = all.filter((g) => g.growers.size <= 1 && g.dates.size <= 2).length / (all.length || 1);
  const repeated = Math.min(1, (layout.rows.length / (all.length || 1) - 1) / 0.5);
  const runs = Math.min(1, c.run / 0.5);
  return { pure, repeated, runs, strength: pure * repeated * runs };
}

function docScore(layout: SheetLayout, c: ColumnProfile, fields: Partial<Record<ExcelField, number>>): number {
  const { pure, repeated, runs } = documentShape(layout, c, fields);
  return pure * 0.5 + runs * 0.3 + repeated * 0.2;
}

/* ------------------------------------------------------------------ */
/* Both reports                                                        */
/* ------------------------------------------------------------------ */

export type PairDetection = { own: ColumnMap; supplier: ColumnMap };

/**
 * Detects both sheets' columns. The delivery-note column is chosen as the
 * pair of document-number columns whose values overlap most across the two
 * reports; on the own side a second document column is its own document.
 */
export function detectPair(own: SheetLayout, supplier: SheetLayout): PairDetection {
  const o = detectSheet(own);
  const s = detectSheet(supplier);

  let link: { own: number; supplier: number; overlap: number } | null = null;
  for (const oc of o.docCandidates) {
    for (const sc of s.docCandidates) {
      const overlap = valueOverlap(own, oc.index, supplier, sc.index);
      if (overlap >= 0.2 && (!link || overlap > link.overlap)) link = { own: oc.index, supplier: sc.index, overlap };
    }
  }
  const pickDoc = (d: Detection, linked: number | undefined) => {
    const index = linked ?? d.docCandidates[0]?.index;
    if (index == null) return;
    d.fields.doc = index;
    if (linked == null && d.docCandidates.length > 1) d.warnings.push(guess(d.layout.columns[index], "doc"));
  };
  pickDoc(o, link?.own);
  pickDoc(s, link?.supplier);
  const ownDoc = o.docCandidates.find((c) => c.index !== o.fields.doc);
  if (ownDoc) o.fields.ownDoc = ownDoc.index;

  return { own: finish(o, "own"), supplier: finish(s, "supplier") };
}

function finish(d: Detection, side: "own" | "supplier"): ColumnMap {
  const missing = REQUIRED.filter((f) => d.fields[f] == null);
  if (missing.length) throw new MissingColumnsError(side, missing);
  const warnings = [...d.warnings];
  for (const f of EXPECTED) if (d.fields[f] == null) warnings.push(`לא נמצאה עמודת ${FIELD_LABELS[f]}`);
  const used = Object.fromEntries(
    (Object.entries(d.fields) as [ExcelField, number][]).map(([f, i]) => [f, d.layout.columns[i].label]),
  );
  return { fields: d.fields, extras: d.extras, warnings, used };
}

/** Share of one column's distinct values that also appear in the other column. */
function valueOverlap(a: SheetLayout, ai: number, b: SheetLayout, bi: number): number {
  const av = new Set(a.rows.map((r) => key(r.cells[ai] ?? null)).filter(Boolean));
  const bv = new Set(b.rows.map((r) => key(r.cells[bi] ?? null)).filter(Boolean));
  if (av.size < 2 || bv.size < 2) return 0;
  let shared = 0;
  for (const v of av) if (bv.has(v)) shared++;
  return shared / Math.min(av.size, bv.size);
}
