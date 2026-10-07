const DAY_MS = 24 * 60 * 60 * 1000;

/** b − a in whole days; null when either date is unknown. */
export function daysBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

export const DATE_TOLERANCE_DAYS = 2;

export function withinDateTolerance(a: string | null, b: string | null): boolean {
  const d = daysBetween(a, b);
  return d == null || Math.abs(d) <= DATE_TOLERANCE_DAYS;
}
