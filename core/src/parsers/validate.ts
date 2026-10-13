import { round2 } from "../pdf/text.js";

const TOTAL_TOLERANCE = 0.05;

/** Warn when the parsed lines do not add up to the total printed on the PDF. */
export function checkTotal(
  label: string,
  parsed: number,
  printed: number | null,
  warnings: string[],
): void {
  if (printed == null) {
    warnings.push(`${label}: לא נמצא סה"כ מודפס לבדיקה`);
    return;
  }
  if (Math.abs(parsed - printed) > TOTAL_TOLERANCE) {
    warnings.push(
      `${label}: סכום השורות שחולצו (${round2(parsed)}) שונה מהסה"כ המודפס (${printed}) — ייתכן שחסרות שורות`,
    );
  }
}

/** One scanned row's linked amounts — quantity × unitPrice = total — as read; null where OCR found nothing. */
export type ReadAmounts = { quantity: number | null; unitPrice: number | null; total: number | null };
type AmountField = keyof ReadAmounts;

export type ConfirmedAmounts = {
  quantity: number;
  unitPrice: number;
  total: number;
  /** Fields replaced by the value the rest of the row and the printed totals prove. */
  corrected: AmountField[];
  /** Fields that could not be confirmed. */
  uncertain: AmountField[];
};

/** More misread rows than this are not worth searching: they are all left uncertain. */
const MAX_ROWS_TO_CORRECT = 8;

/**
 * Check every OCR'd row (quantity × unitPrice = total) and fix misreads, but
 * only where the invoice itself proves the fix: among all the ways to repair
 * the failing rows from their other two amounts, exactly one must make the
 * columns add up to the printed quantity and amount totals. Anything else is
 * left as read and marked uncertain — never guessed.
 */
export function confirmAmounts(
  rows: ReadAmounts[],
  printed: { quantity: number | null; total: number | null },
): ConfirmedAmounts[] {
  const ok = (r: ReadAmounts) =>
    r.quantity != null &&
    r.unitPrice != null &&
    r.total != null &&
    Math.abs(r.quantity * r.unitPrice - r.total) <= TOTAL_TOLERANCE;

  const failing = rows.flatMap((r, i) => (ok(r) ? [] : [i]));
  const options = failing.map((i) => repairs(rows[i]));
  const result = rows.map((r) => ({
    quantity: r.quantity ?? 0,
    unitPrice: r.unitPrice ?? 0,
    total: r.total ?? 0,
    corrected: [] as AmountField[],
    uncertain: [] as AmountField[],
  }));
  if (failing.length === 0) return result;

  const markUncertain = () => {
    for (const i of failing) result[i].uncertain = ["quantity", "unitPrice", "total"];
    return result;
  };
  if (printed.quantity == null || printed.total == null) return markUncertain();
  if (failing.length > MAX_ROWS_TO_CORRECT || options.some((o) => o.length === 0)) return markUncertain();

  // Try every combination of one repair per failing row.
  const valid: Repair[][] = [];
  const pick: Repair[] = [];
  const search = (k: number) => {
    if (k === failing.length) {
      const fixed = rows.map((r) => ({ ...r }));
      pick.forEach((p, j) => (fixed[failing[j]][p.field] = p.value));
      const sum = (f: AmountField) => fixed.reduce((s, r) => s + (r[f] ?? 0), 0);
      if (
        Math.abs(sum("quantity") - printed.quantity!) <= TOTAL_TOLERANCE &&
        Math.abs(sum("total") - printed.total!) <= TOTAL_TOLERANCE
      ) {
        valid.push([...pick]);
      }
      return;
    }
    for (const option of options[k]) {
      pick.push(option);
      search(k + 1);
      pick.pop();
    }
  };
  search(0);

  const distinct = new Set(valid.map((v) => JSON.stringify(v)));
  if (distinct.size !== 1) return markUncertain();
  valid[0].forEach(({ field, value }, j) => {
    const row = result[failing[j]];
    row[field] = value;
    row.corrected = [field];
  });
  return result;
}

type Repair = { field: AmountField; value: number };

/** The values a row's amounts would have if exactly one of them was misread. */
function repairs({ quantity: q, unitPrice: p, total: t }: ReadAmounts): Repair[] {
  const out: Repair[] = [];
  if (q != null && p != null) out.push({ field: "total", value: round2(q * p) });
  // Quantities and prices are printed in agorot: a division that doesn't
  // come out even can't be the printed value.
  const even = (v: number) => Number.isFinite(v) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
  if (t != null && p) {
    const v = t / p;
    if (even(v)) out.push({ field: "quantity", value: round2(v) });
  }
  if (t != null && q) {
    const v = t / q;
    if (even(v)) out.push({ field: "unitPrice", value: round2(v) });
  }
  // A null amount can only be filled in, not traded for another.
  const missing = (["quantity", "unitPrice", "total"] as const).filter((f) => ({ quantity: q, unitPrice: p, total: t })[f] == null);
  return missing.length === 0 ? out : out.filter((r) => missing.includes(r.field as never));
}
