import { describe, expect, it } from "vitest";
import { extractInvoices } from "../src/extract.js";
import { ExtractionError } from "../src/errors.js";
import { extractSample, PAIRS, readSample, TEENA_RIMON } from "./helpers.js";

const sum = (xs: { lineTotal: number }[]) => Math.round(xs.reduce((a, x) => a + x.lineTotal, 0) * 100) / 100;

describe("Granot parser", () => {
  it("reads every item line and matches the printed totals", async () => {
    const { supplier, own } = await extractSample("granot");
    expect(supplier.supplierId).toBe("granot");
    expect(supplier.invoiceNumber).toBe("SI26602203");
    expect(supplier.lines).toHaveLength(29);
    expect(sum(supplier.lines)).toBe(77379.76);
    expect(supplier.printedItemsTotal).toBe(77379.76);
    expect(supplier.warnings).toEqual([]);

    expect(own.lines).toHaveLength(25);
    expect(sum(own.lines)).toBe(84684.1);
    expect(own.commercialDiscount).toBe(10162.11);
    expect(own.discountPct).toBeCloseTo(0.12, 5);
    expect(own.againstInvoice).toBe("26602203");
    expect(own.warnings).toEqual([]);
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
    const { own } = await extractSample("granot");
    expect(own.lines[0]).toMatchObject({ ownDocNumber: "23103", supplierRef: "2610231", product: "פיטאיה", size: "מיקס" });
  });
});

describe("Shivuk HaHof parser", () => {
  it("reads every item line, across pages, and matches the printed totals", async () => {
    const { supplier, own } = await extractSample("shivuk");
    expect(supplier.supplierId).toBe("shivuk-hahof");
    expect(supplier.lines).toHaveLength(28);
    expect(sum(supplier.lines)).toBe(138544.89);
    expect(supplier.warnings).toEqual([]);
    expect(own.lines).toHaveLength(37);
    expect(sum(own.lines)).toBe(156512.1);
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

describe("D. Hai parser", () => {
  it("reads every item line and matches the printed gross and net totals", async () => {
    const { supplier, own } = await extractSample("dhai");
    expect(supplier.supplierId).toBe("d-hai");
    expect(supplier.invoiceNumber).toBe("32974");
    expect(supplier.invoiceDate).toBe("2026-09-22");
    expect(supplier.lines).toHaveLength(37);
    const gross = supplier.lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
    expect(Math.round(gross * 100) / 100).toBe(131159.3);
    expect(supplier.printedItemsTotal).toBe(115420.24);
    expect(supplier.lines.every((l) => l.discountPct === 0.12)).toBe(true);
    expect(supplier.warnings).toEqual([]);

    expect(own.lines).toHaveLength(40);
    expect(sum(own.lines)).toBe(119547.81);
    expect(own.commercialDiscount).toBe(11338.8);
    expect(own.warnings).toEqual([]);
  });

  it("reads the per-row date, delivery number, size and booklet reference", async () => {
    const { supplier } = await extractSample("dhai");
    expect(supplier.lines.find((l) => l.quantity === 50)).toMatchObject({
      page: 2,
      date: "2026-09-08",
      docNumber: "2827",
      description: "אפרסק 1880",
      variety: "70",
      packages: 6,
      unitPrice: 6,
      lineTotal: 264,
    });
    expect(supplier.lines.find((l) => l.description === "כרוב לבן")?.bookRef).toBe("3803");
  });

  it("is not mistaken for a Teena-Rimon draft although it is printed by AGROLINE", async () => {
    const promise = extractInvoices({
      ownPdf: await readSample(PAIRS.dhai.supplier),
      supplierPdf: await readSample(PAIRS.dhai.own),
      ownFileName: "a.pdf",
      supplierFileName: "b.pdf",
    }, TEENA_RIMON);
    await expect(promise).rejects.toThrow("הוחלפו");
  });
});

describe("Achim Menashri parser (AGROLINE)", () => {
  it("reads every item line and matches the printed gross and net totals", async () => {
    const { supplier, own } = await extractSample("menashri");
    expect(supplier.supplierId).toBe("menashri");
    expect(supplier.invoiceNumber).toBe("70354");
    expect(supplier.invoiceDate).toBe("2026-10-07");
    expect(supplier.lines).toHaveLength(38);
    const gross = supplier.lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
    expect(Math.round(gross * 100) / 100).toBe(81203.24);
    expect(supplier.printedItemsTotal).toBe(71458.8);
    expect(supplier.warnings).toEqual([]);
    expect(supplier.lines[0]).toMatchObject({ date: "2026-07-12", docNumber: "4503", description: "סלק אדום", quantity: 751 });

    expect(own.lines).toHaveLength(33);
    // The sample draft was issued against another Menashri invoice.
    expect(own.warnings).toEqual([expect.stringContaining("כנגד חשבונית 20231")]);
  });
});

describe("HaHaklaim parser", () => {
  it("reads the item lines, leaves out the pallet deposit and matches the printed total", async () => {
    const { supplier, own } = await extractSample("haklaim");
    expect(supplier.supplierId).toBe("haklaim");
    expect(supplier.invoiceNumber).toBe("SI266001908");
    expect(supplier.invoiceDate).toBe("2026-09-17");
    expect(supplier.lines).toHaveLength(5);
    expect(sum(supplier.lines)).toBe(13383.66);
    expect(supplier.printedItemsTotal).toBe(13383.66);
    expect(supplier.warnings).toEqual([]);
    expect(supplier.lines[0]).toMatchObject({
      date: "2026-09-16",
      docNumber: "SH26005303",
      description: "עגבניות שרי לובלו",
      packages: 60,
      quantity: 454,
      unit: 'ק"ג',
      unitPrice: 12,
      discountPct: 0.12,
      lineTotal: 4794.24,
    });

    expect(own.lines).toHaveLength(5);
    expect(own.warnings).toEqual([]);
  });
});

describe("Galil Shuk Mekomi parser", () => {
  it("reads every item line across pages, without pallets, and matches the printed total", async () => {
    const { supplier } = await extractSample("galil");
    expect(supplier.supplierId).toBe("galil");
    expect(supplier.invoiceNumber).toBe("SI266007639");
    expect(supplier.invoiceDate).toBe("2026-09-30");
    expect(supplier.lines).toHaveLength(80);
    expect(sum(supplier.lines)).toBe(131734.15);
    expect(supplier.printedItemsTotal).toBe(131734.15);
    expect(supplier.warnings).toEqual([]);
    expect(supplier.lines.some((l) => l.description.startsWith("משטח"))).toBe(false);
  });

  it("joins product names wrapped above and below their row", async () => {
    const { supplier } = await extractSample("galil");
    expect(supplier.lines[2]).toMatchObject({
      date: "2026-09-13",
      docNumber: "SH2631783",
      sku: "15010111",
      description: "אבוקדו גליל שוק מוסדי",
      quantity: 699,
      unitPrice: 2.3,
      lineTotal: 1607.7,
    });
    expect(supplier.lines.find((l) => l.description === "אבוקדו גליל ברשת")).toBeDefined();
  });
});

describe("Shivuk HaAsor parser", () => {
  it("reads item rows only and matches the printed gross and net totals", async () => {
    const { supplier, own } = await extractSample("hasor");
    expect(supplier.supplierId).toBe("hasor");
    expect(supplier.invoiceNumber).toBe("12/260983");
    expect(supplier.invoiceDate).toBe("2026-09-18");
    expect(supplier.lines).toHaveLength(21);
    const gross = supplier.lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
    expect(Math.round(gross * 100) / 100).toBe(120093.3);
    expect(sum(supplier.lines)).toBe(105682.11);
    expect(supplier.lines.every((l) => l.discountPct === 0.12)).toBe(true);
    expect(supplier.warnings).toEqual([]);
    expect(own.warnings).toEqual([]);
  });

  it("uses the package count for items sold by the unit and joins a wrapped quality code", async () => {
    const { supplier } = await extractSample("hasor");
    expect(supplier.lines.find((l) => l.description === "אננס")).toMatchObject({
      docNumber: "21/265134",
      variety: "8",
      packages: 36,
      quantity: 36,
      unit: "יח'",
      unitPrice: 70,
      lineTotal: 2217.6,
    });
    expect(supplier.lines.find((l) => l.description === "חציל חממה")?.variety).toBe("MADMO N");
  });
});

describe("Bananot Carmel parser", () => {
  it("reads every item line, without pallet deposits, and matches the printed total", async () => {
    const { supplier, own } = await extractSample("carmel");
    expect(supplier.supplierId).toBe("carmel");
    expect(supplier.invoiceNumber).toBe("61345");
    expect(supplier.invoiceDate).toBe("2026-09-18");
    expect(supplier.lines).toHaveLength(25);
    expect(sum(supplier.lines)).toBe(70078.5);
    expect(supplier.printedItemsTotal).toBe(70078.5);
    expect(supplier.warnings).toEqual([]);

    expect(own.lines).toHaveLength(25);
    expect(own.commercialDiscount).toBe(0);
  });

  it("carries the delivery date and number onto its rows, across the page break", async () => {
    const { supplier } = await extractSample("carmel");
    expect(supplier.lines[0]).toMatchObject({
      date: "2026-09-01",
      docNumber: "53215",
      sku: "2",
      description: "בננה אא' במגש",
      packages: 48,
      quantity: 524,
      unitPrice: 5.45,
      lineTotal: 2855.8,
    });
    expect(supplier.lines.find((l) => l.page === 2)).toMatchObject({ date: "2026-09-13", docNumber: "53400", quantity: 504 });
  });
});

describe("Har HaKor", () => {
  it("is rejected as a scanned invoice", async () => {
    await expect(extractSample("harKor")).rejects.toThrow("סרוקה");
  });
});

describe("slot validation", () => {
  it("rejects swapped files with a clear message", async () => {
    const promise = extractInvoices({
      ownPdf: await readSample(PAIRS.granot.supplier),
      supplierPdf: await readSample(PAIRS.granot.own),
      ownFileName: "a.pdf",
      supplierFileName: "b.pdf",
    }, TEENA_RIMON);
    await expect(promise).rejects.toBeInstanceOf(ExtractionError);
    await expect(promise).rejects.toThrow("הוחלפו");
  });

  it("warns when the draft was issued against a different supplier invoice", async () => {
    const result = await extractInvoices({
      ownPdf: await readSample(PAIRS.shivuk.own),
      supplierPdf: await readSample(PAIRS.granot.supplier),
      ownFileName: "a.pdf",
      supplierFileName: "b.pdf",
    }, TEENA_RIMON);
    expect(result.own.warnings.join()).toContain("כנגד חשבונית");
  });
});
