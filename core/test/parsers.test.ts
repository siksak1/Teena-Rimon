import { describe, expect, it } from "vitest";
import { extractInvoices } from "../src/extract.js";
import { ExtractionError } from "../src/errors.js";
import { extractSample, PAIRS, readSample } from "./helpers.js";

const sum = (xs: { lineTotal: number }[]) => Math.round(xs.reduce((a, x) => a + x.lineTotal, 0) * 100) / 100;

describe("Granot parser", () => {
  it("reads every item line and matches the printed totals", async () => {
    const { supplier, teenaRimon } = await extractSample("granot");
    expect(supplier.supplierId).toBe("granot");
    expect(supplier.invoiceNumber).toBe("SI26602203");
    expect(supplier.lines).toHaveLength(29);
    expect(sum(supplier.lines)).toBe(77379.76);
    expect(supplier.printedItemsTotal).toBe(77379.76);
    expect(supplier.warnings).toEqual([]);

    expect(teenaRimon.lines).toHaveLength(25);
    expect(sum(teenaRimon.lines)).toBe(84684.1);
    expect(teenaRimon.commercialDiscount).toBe(10162.11);
    expect(teenaRimon.discountPct).toBeCloseTo(0.12, 5);
    expect(teenaRimon.againstInvoice).toBe("26602203");
    expect(teenaRimon.warnings).toEqual([]);
  });

  it("inherits date / doc / book reference from earlier rows", async () => {
    const { supplier } = await extractSample("granot");
    const s5 = supplier.lines[4];
    expect(s5).toMatchObject({ date: "2026-09-01", docNumber: "SH2610275", bookRef: "9374037" });
    expect(s5.description).toBe("מנגו 20 פרימיום מפיות");
    expect(s5.variety).toBe("שלי");
    expect(supplier.lines[0].variety).toBe("ונוס (אדום)");
  });

  it("splits Teena-Rimon's doc number from the supplier reference", async () => {
    const { teenaRimon } = await extractSample("granot");
    expect(teenaRimon.lines[0]).toMatchObject({ trDocNumber: "23103", supplierRef: "2610231", product: "פיטאיה", size: "מיקס" });
  });
});

describe("Shivuk HaHof parser", () => {
  it("reads every item line, across pages, and matches the printed totals", async () => {
    const { supplier, teenaRimon } = await extractSample("shivuk");
    expect(supplier.supplierId).toBe("shivuk-hahof");
    expect(supplier.lines).toHaveLength(28);
    expect(sum(supplier.lines)).toBe(138544.89);
    expect(supplier.warnings).toEqual([]);
    expect(teenaRimon.lines).toHaveLength(37);
    expect(sum(teenaRimon.lines)).toBe(156512.1);
  });

  it("detects the line printed without a discount", async () => {
    const { supplier } = await extractSample("shivuk");
    const noDiscount = supplier.lines.filter((l) => l.discountPct === 0);
    expect(noDiscount).toHaveLength(1);
    expect(noDiscount[0]).toMatchObject({ quantity: 526, unitPrice: 12.9, lineTotal: 6785.4, docNumber: "2SH2605571", page: 2 });
  });

  it("keeps short names out of the SKU column", async () => {
    const { supplier } = await extractSample("shivuk");
    expect(supplier.lines.find((l) => l.sku === "2133")?.description).toBe("שזיף");
  });
});

describe("slot validation", () => {
  it("rejects swapped files with a clear message", async () => {
    const promise = extractInvoices({
      trPdf: await readSample(PAIRS.granot.supplier),
      supplierPdf: await readSample(PAIRS.granot.tr),
      trFileName: "a.pdf",
      supplierFileName: "b.pdf",
      parseMode: "server",
    });
    await expect(promise).rejects.toBeInstanceOf(ExtractionError);
    await expect(promise).rejects.toThrow("הוחלפו");
  });

  it("warns when the draft was issued against a different supplier invoice", async () => {
    const result = await extractInvoices({
      trPdf: await readSample(PAIRS.shivuk.tr),
      supplierPdf: await readSample(PAIRS.granot.supplier),
      trFileName: "a.pdf",
      supplierFileName: "b.pdf",
      parseMode: "server",
    });
    expect(result.teenaRimon.warnings.join()).toContain("כנגד חשבונית");
  });
});
