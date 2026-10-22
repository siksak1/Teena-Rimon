/**
 * Column names suppliers print, by field, collected from every supplier
 * format seen so far. The generic table parser finds the quantity, price and
 * total columns by arithmetic; these names only label the other columns
 * (date, delivery document, booklet reference, description…). Order matters:
 * the first field whose pattern matches a header wins.
 */
export type HeaderField =
  | "netPrice"
  | "bookRef"
  | "total"
  | "discount"
  | "unitPrice"
  | "packages"
  | "quantity"
  | "date"
  | "doc"
  | "sku"
  | "packageType"
  | "pallet"
  | "unit"
  | "variety"
  | "description";

const Q = `["'״׳]?`; // the quote in סה"כ / מק"ט, printed in several ways

export const HEADER_FIELDS: [HeaderField, RegExp][] = [
  ["netPrice", /אחרי הנחה|נטו ליח/],
  ["bookRef", /פנקס|אסמכתא נוספת|נוספת/],
  ["total", new RegExp(`^סה${Q}כ|^סכום`)],
  ["discount", /^הנחה/],
  ["unit", /יח' מכירה|^יחידת מידה/],
  ["unitPrice", /^מחיר/],
  ["packages", /אריזות|באריזה|^יחידות|^מס\.? ?אריזות|^קרטונים/],
  ["quantity", /משקל|^כמות/],
  ["date", /תאריך/],
  ["variety", /^קוד איכות|^איכות$/],
  ["sku", new RegExp(`מק${Q}ט|^קוד|מס\\.? ?פריט|^פריט$`)],
  ["doc", /תעודה|משלוח|^אסמכתא$|^מספר$|^מס' ת/],
  ["packageType", /אריזה/],
  ["pallet", /משטח/],
  ["description", /תאור|תיאור|שם פריט|תוצרת|סחורה|מוצר|פריט/],
  ["variety", /^זן|^גודל/],
];

export function headerField(label: string): HeaderField | null {
  const text = label.trim();
  return HEADER_FIELDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

/** Rows that sum up other rows, never items. */
export const SUMMARY_ROW = new RegExp(`סה${Q}כ|יתרה|להעברה|מחיר כולל|לתשלום|ס["'״]ה`);

/** Pallet and deposit rows: charged on the invoice but outside the comparison. */
export const PALLET_ROW = /משטח|פקדון|פלט|מכל ריק|מיכלים/;

/**
 * Labels of rows whose amount may be the printed items total. Produce is
 * exempt from VAT and pallets are not, so the exempt amount is the items total.
 */
export const TOTAL_LABEL = new RegExp(`סה${Q}כ|מחיר כולל|פדיון|לתשלום|ברוטו|נטו|תוצרת|פטור ממע`);

/** Rows whose small amount explains a gap between the lines and a printed total. */
export const ADJUSTMENT_ROW = /הנחה כללית|עיגול|הפרש/;
