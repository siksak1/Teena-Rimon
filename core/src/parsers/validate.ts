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
