import { describe, expect, it } from "vitest";
import { checkReading, unreadLines } from "../src/parsers/coverage.js";
import { documentDiscounts, findItemRows } from "../src/parsers/generic.js";
import { leviParser } from "../src/parsers/levi.js";
import { loadPdf } from "../src/pdf/layout.js";
import { reconcile } from "../src/reconcile/reconcile.js";
import { extractCase, readSample, TEENA_RIMON } from "./helpers.js";

const LEVI_CREDITS = { supplier: "sample_data/צדוק לוי.pdf", own: "sample_data/צדוק לוי טיוטה 09.26.pdf" };
const sum = (lines: { lineTotal: number }[]) => Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;

describe("strict reading check", () => {
  it("finds the rows a reader missed, credits included, and adds them back as unread lines", async () => {
    const doc = await loadPdf(await readSample(LEVI_CREDITS.supplier));
    // This Levi printout has credit rows ("-50.00") and prints ":תוצרת" — the Levi parser misses both.
    const check = checkReading(doc, leviParser.parse(doc));
    expect(check.ok).toBe(false);
    expect(check.reasons).toEqual(["4 שורות בחשבונית לא נקראו", 'לא נמצא סה"כ מודפס לבדיקה']);

    const unread = unreadLines(doc, check.uncovered, 1);
    expect(unread.map((l) => [l.docNumber, l.lineTotal, l.unread])).toEqual([
      ["115988", -500, true],
      ["115998", -500, true],
      ["118245", -50, true],
      ["119239", -1720, true],
    ]);
  });

  it("passes the reading over for one that accounts for every printed row", async () => {
    const extraction = await extractCase(LEVI_CREDITS, TEENA_RIMON);
    const { supplier } = extraction;
    expect(supplier.generic).toBe("table");
    expect(supplier.warnings).toContain('הקורא "לוי צדוק" לא שימש לחשבונית זו: 4 שורות בחשבונית לא נקראו; לא נמצא סה"כ מודפס לבדיקה');

    // Every item row printed on the invoice is a line, or a pallet row listed apart.
    const doc = await loadPdf(await readSample(LEVI_CREDITS.supplier));
    const printed = findItemRows(doc, documentDiscounts(doc)).rows;
    expect(supplier.lines.length + supplier.excludedRows!.length).toBe(printed.length);
    expect(supplier.lines.some((l) => l.unread)).toBe(false);
    expect(sum(supplier.lines)).toBe(261089.55);

    const result = reconcile(extraction, TEENA_RIMON);
    const groupOf = (total: number) => result.groups.find((g) => g.supplierLines.some((l) => l.lineTotal === total));
    expect(groupOf(-50)).toMatchObject({ ownLines: [{ id: "T91" }], netDiff: 0 });
    expect(groupOf(-1720)).toMatchObject({ ownLines: [{ id: "T155" }], netDiff: 0 });
    expect(result.ownOnly).toEqual([]);
  });
});
