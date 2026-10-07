import type { GapFlag } from "@core/model.js";

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
