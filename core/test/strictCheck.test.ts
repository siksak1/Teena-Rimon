import { describe, expect, it } from "vitest";
import { checkReading, unreadLines } from "../src/parsers/coverage.js";
import { documentDiscounts, findItemRows } from "../src/parsers/generic.js";
import { leviParser } from "../src/parsers/levi.js";
import { loadPdf } from "../src/pdf/layout.js";
import { reconcile } from "../src/reconcile/reconcile.js";
import { extractCase, readSample, TEENA_RIMON } from "./helpers.js";

const LEVI_CREDITS = { supplier: "sample_data/צדוק לוי.pdf", own: "sample_data/צדוק לוי טיוטה 09.26.pdf" };
const HASOR_WITH_DRAFT = {
  supplier: "sample_data/78508ace614a2892b42f0032fd56c0db.pdf",
  own: "sample_data/הדפסת טיוטת חש' מגדל_4481 (43).pdf",
};
const sum = (lines: { lineTotal: number }[]) => Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;

describe("strict reading check", () => {
  it("finds the rows a reader missed, credits included, and adds them back as unread lines", async () => {
    const doc = await loadPdf(await readSample(LEVI_CREDITS.supplier));
    const invoice = leviParser.parse(doc);
    expect(checkReading(doc, invoice).ok).toBe(true);

    // A reader that misses the credit rows (as the Levi parser once did).
    const missed = { ...invoice, lines: invoice.lines.filter((l) => l.lineTotal >= 0) };
    const check = checkReading(doc, missed);
    expect(check.ok).toBe(false);
    expect(check.reasons[0]).toBe("2 שורות בחשבונית לא נקראו");

    const unread = unreadLines(doc, check.uncovered, 1);
    expect(unread.map((l) => [l.docNumber, l.lineTotal, l.unread])).toEqual([
      ["118245", -50, true],
      ["119239", -1720, true],
    ]);
  });

  it("keeps a reading that accounts for every printed row, credits and containers included", async () => {
    const extraction = await extractCase(LEVI_CREDITS, TEENA_RIMON);
    const { supplier } = extraction;
    expect(supplier.supplierId).toBe("levi");
    expect(supplier.warnings).toEqual([]);

    // Every item row printed on the invoice is a line, or a pallet row listed apart.
    const doc = await loadPdf(await readSample(LEVI_CREDITS.supplier));
    const printed = findItemRows(doc, documentDiscounts(doc)).rows;
    expect(supplier.lines.length + supplier.excludedRows!.length).toBe(printed.length);
    expect(supplier.lines.some((l) => l.unread)).toBe(false);
    expect(sum(supplier.lines)).toBe(261589.55);
    expect(supplier.printedItemsTotal).toBe(261589.55);

    const result = reconcile(extraction, TEENA_RIMON);
    const groupOf = (total: number) => result.groups.find((g) => g.supplierLines.some((l) => l.lineTotal === total));
    expect(groupOf(-50)).toMatchObject({ ownLines: [{ id: "T91" }], netDiff: 0 });
    expect(groupOf(-1720)).toMatchObject({ ownLines: [{ id: "T155" }], netDiff: 0 });
    expect(result.ownOnly).toEqual([]);
  });

  it("skips the wholesaler's own draft attached to the supplier's file, and says so", async () => {
    // Pages 1–4: the Hasor invoice; pages 5–9: Teena-Rimon's AGROLINE draft against it.
    const { supplier } = await extractCase(HASOR_WITH_DRAFT, TEENA_RIMON);
    expect(supplier.supplierId).toBe("hasor");
    expect(supplier.lines).toHaveLength(53);
    expect(supplier.lines.some((l) => l.unread || l.page > 4)).toBe(false);
    expect(sum(supplier.lines)).toBe(219351.09);
    expect(supplier.printedItemsTotal).toBe(219351.09);
    expect(supplier.warnings).toEqual([
      'עמודים 5–9 בקובץ "sample_data/78508ace614a2892b42f0032fd56c0db.pdf" הם חשבונית טיוטה של תאנה ורימון — הם לא נקראו כחלק מחשבונית הספק',
    ]);
  });
});
