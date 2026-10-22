import type { GapFlag, OwnLine, SupplierLine } from "@core/model.js";

const moneyFmt = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", maximumFractionDigits: 2 });
const numberFmt = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 3 });

export function money(value: number | null | undefined): string {
  return value == null ? "—" : moneyFmt.format(value);
}

export function num(value: number | null | undefined): string {
  return value == null ? "—" : numberFmt.format(value);
}

/** Signed value for differences; 0 renders as "0". */
export function signedMoney(value: number): string {
  return value > 0 ? `+${moneyFmt.format(value)}` : moneyFmt.format(value);
}

export function signedNum(value: number | null): string {
  if (value == null) return "—";
  return value > 0 ? `+${numberFmt.format(value)}` : numberFmt.format(value);
}

/** Day gaps up to this size are routine (delivery vs. booking day) and not shown. */
const SHOWN_DATE_DELTA_DAYS = 7;

/** The group's day gap when it is worth showing, else null. */
export function shownDateDelta(dateDelta: number | null): number | null {
  return dateDelta != null && Math.abs(dateDelta) > SHOWN_DATE_DELTA_DAYS ? dateDelta : null;
}

/** "2026-09-01" → "01/09/26" */
export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

export function percent(fraction: number): string {
  return `${numberFmt.format(Math.round(fraction * 10000) / 100)}%`;
}

export const FLAG_LABEL: Record<GapFlag, string> = {
  quantity: "משקל",
  packages: "אריזות",
  price: "מחיר",
  discount: "הנחה",
  name: "שם פריט",
  doc_ref: "אסמכתא",
  arithmetic: "חישוב שורה",
};

export function supplierRef(l: SupplierLine): string {
  return [l.bookRef, l.docNumber].filter(Boolean).join(" · ");
}

export function supplierItem(l: SupplierLine): string {
  return [l.description, l.variety].filter(Boolean).join(" · ");
}

/** Scanned invoices: marks a row whose OCR could not be confirmed. */
export const OCR_MARK = "⚠ לבדיקה";

const OCR_FIELDS: Partial<Record<keyof SupplierLine, string>> = {
  date: "תאריך",
  docNumber: "תעודה",
  description: "פריט",
  packages: "אריזות",
  quantity: 'ק"ג',
  unitPrice: "מחיר",
  lineTotal: 'סה"כ',
};

/** "ק"ג, מחיר, סה"כ" — the fields to check against the scan; "" when the row was confirmed. */
export function ocrUncertainFields(l: SupplierLine): string {
  return (l.ocrUncertain ?? []).map((f) => OCR_FIELDS[f] ?? f).join(", ");
}

/** A row the invoice's reader missed, added from the invoice's arithmetic. */
export const UNREAD_MARK = "⚠ לא נקרא";
export const UNREAD_TITLE = "השורה לא נקראה אוטומטית ונוספה לפי החשבון שבה (כמות × מחיר = סה\"כ) — יש לבדוק אותה מול החשבונית";

/** The item, followed by its mark when the row needs checking (plain text: tables and Excel). */
export function supplierItemMarked(l: SupplierLine): string {
  if (l.unread) return `${supplierItem(l)} ${UNREAD_MARK}`;
  return l.ocrUncertain ? `${supplierItem(l)} ${OCR_MARK}` : supplierItem(l);
}

export function ownItem(l: OwnLine): string {
  return [l.product, l.size].filter(Boolean).join(" · ");
}

/** Own lines are printed before the commercial discount; this is the comparable net. */
export function ownNet(l: OwnLine, ownDiscountPct: number): number {
  return Math.round(l.lineTotal * (1 - ownDiscountPct) * 100) / 100;
}
