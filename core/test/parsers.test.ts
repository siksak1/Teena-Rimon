import { describe, expect, it } from "vitest";
import { detectScanned, extractInvoices } from "../src/extract.js";
import { ExtractionError } from "../src/errors.js";
import { confirmAmounts } from "../src/parsers/validate.js";
import { supplierParsersFor } from "../src/parsers/registry.js";
import { loadScan } from "../src/pdf/scan.js";
import { parseDate, round2 } from "../src/pdf/text.js";
import { extractSample, PAIRS, readSample, TEENA_RIMON } from "./helpers.js";
import { NODE_SCAN_SUPPORT } from "./scanSupport.js";

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

describe("Levi Tzadok parser", () => {
  it("reads every item line, skipping pallet rows", async () => {
    const { supplier, own } = await extractSample("levi");
    expect(supplier.supplierId).toBe("levi");
    expect(supplier.invoiceNumber).toBe("019614");
    expect(supplier.invoiceDate).toBe("2026-09-30");
    expect(supplier.lines).toHaveLength(53);
    expect(supplier.lines.some((l) => l.description.startsWith("משטח"))).toBe(false);
    expect(supplier.lines[0]).toMatchObject({
      date: "2026-09-02",
      docNumber: "126238",
      description: "קישואים",
      packages: 2,
      quantity: 29,
      unit: 'ק"ג',
      unitPrice: 7.5,
      lineTotal: 217.5,
    });
    // Unit-priced rows have no weight; blank packages stay null.
    expect(supplier.lines.find((l) => l.description === "אננס")).toMatchObject({ packages: 18, quantity: 18, unit: "יח'" });
    expect(supplier.lines.find((l) => l.description === "דלעת")).toMatchObject({ packages: null, quantity: 148 });

    expect(sum(supplier.lines)).toBe(26079.4);
    expect(supplier.printedItemsTotal).toBe(26079.4);
    expect(supplier.warnings).toEqual([]);

    expect(own.againstInvoice).toBe("19614");
    expect(own.lines).toHaveLength(39);
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
  });

  it("applies the agreed 12% that neither Carmel nor the draft prints", async () => {
    const { supplier, own } = await extractSample("carmel");
    // Carmel prints 6.6 ₪/kg, already after the 12% — the list price is 7.5, as on the draft.
    const line = supplier.lines.find((l) => l.date === "2026-09-13" && l.quantity === 504)!;
    expect(line.discountPct).toBe(0.12);
    expect(line.unitPrice).toBeCloseTo(7.5, 10);
    expect(line.lineTotal).toBe(3326.4);
    expect(own.discountPct).toBe(0.12);
    expect(own.commercialDiscount).toBe(9514.24);
    expect(own.warnings).toEqual([]);
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
      discountPct: 0.12,
      lineTotal: 2855.8,
    });
    expect(supplier.lines.find((l) => l.page === 2)).toMatchObject({ date: "2026-09-13", docNumber: "53400", quantity: 504 });
  });
});

describe("Har HaKor (scanned, read by OCR)", () => {
  // Transcribed by eye from the scan: date, delivery note, product as printed,
  // packages, kg, price, total before the 12% discount.
  const PRINTED = `
    29/07/26 3948 ש לריאן 60 630 5.00 3150.00
    04/08/26 3503 סמרסט 60 507 7.50 3802.50
    05/08/26 3541 נ דורינא 46 480 7.80 3744.00
    05/08/26 3541 סמרסט 60 497 7.00 3479.00
    05/08/26 3541 ספדונה 60 629 4.00 2516.00
    05/08/26 3541 ש בלאק דימו 45 483 4.50 2173.50
    07/08/26 3650 סמרסט 60 538 5.00 2690.00
    07/08/26 3650 שזיף 48 508 2.50 1270.00
    09/08/26 3687 נ דורינא 60 516 5.00 2580.00
    09/08/26 3687 קוסטיה 60 548 2.50 1370.00
    09/08/26 3687 ש בלאק דימו 60 625 4.70 2937.50
    09/08/26 3687 שזיף 36 385 4.50 1732.50
    09/08/26 3687 שזיף 35 393 5.00 1965.00
    10/08/26 3749 נ דורינא 60 566 5.00 2830.00
    10/08/26 3749 סמרסט 60 500 5.00 2500.00
    11/08/26 3791 נ דורינא 17 173 5.00 865.00
    11/08/26 3791 נ פלברטופ 43 434 5.00 2170.00
    11/08/26 3791 סמרסט 60 515 9.50 4892.50
    12/08/26 3848 נ דורינא 60 594 5.00 2970.00
    12/08/26 3848 סמרסט 60 605 9.00 5445.00
    12/08/26 3848 ש בלאק דימו 60 617 3.00 1851.00
    12/08/26 3848 ש לטיצה 48 517 5.00 2585.00
    16/08/26 3963 נ דורינא 60 556 4.00 2224.00
    16/08/26 3963 קוסטיה 60 559 4.00 2236.00
    16/08/26 3963 ש בלאק דימו 60 643 3.00 1929.00
    16/08/26 3963 שזיף 48 491 4.00 1964.00
    18/08/26 4070 אפרסק 188 52 516 9.00 4644.00
    21/08/26 4204 1881 60 679 8.00 5432.00
    23/08/26 4261 נ דורינא 60 582 5.50 3201.00
    25/08/26 4329 1881 39 326 8.00 2608.00
    25/08/26 4329 אפרסק שלו 21 182 8.00 1456.00
    26/08/26 4391 1881 21 180 7.30 1314.00
    26/08/26 4391 אפרסק 188 39 334 7.30 2438.20
    27/08/26 4453 1881 63 558 7.50 4185.00`
    .trim()
    .split("\n")
    .map((line) => {
      const [date, doc, ...rest] = line.trim().split(" ");
      const [packages, kg, price, total] = rest.splice(-4).map(Number);
      return { date: parseDate(date), doc, product: rest.join(" "), packages, kg, price, total };
    });

  it("reads every row of the scan exactly", async () => {
    const { supplier } = await extractSample("harKor");
    expect(supplier.lines.map((l) => [l.date, l.docNumber, l.packages, l.quantity, l.unitPrice, round2(l.quantity * l.unitPrice)])).toEqual(
      PRINTED.map((r) => [r.date, r.doc, r.packages, r.kg, r.price, r.total]),
    );
    expect(supplier.lines.filter((l) => l.ocrUncertain)).toEqual([]);
    expect(supplier.lines.at(-1)!.page).toBe(2);
  });

  it("spells out Har-Kor's short product names", async () => {
    const { supplier } = await extractSample("harKor");
    const names = Object.fromEntries(PRINTED.map((r, i) => [r.product, supplier.lines[i].description]));
    expect(names).toEqual({
      "ש לריאן": "שזיף לריאן",
      סמרסט: "אפרסק סמרסט",
      "נ דורינא": "נקטרינה דורינה",
      ספדונה: "אגס ספדונה",
      "ש בלאק דימו": "שזיף בלאק דיימונד",
      שזיף: "שזיף",
      קוסטיה: "אגס קוסטיה",
      "נ פלברטופ": "נקטרינה פלברטופ",
      "ש לטיצה": "שזיף לטיציה",
      "אפרסק 188": "אפרסק 188",
      "1881": "אפרסק 1881",
      "אפרסק שלו": "אפרסק שלו",
    });
  });

  it("reads the header and the footer, and everything adds up", async () => {
    const { supplier, own } = await extractSample("harKor");
    expect(supplier).toMatchObject({
      supplierId: "har-kor",
      invoiceNumber: "111081",
      invoiceDate: "2026-08-31",
      scanned: true,
      // 93,149.70 less the 12% discount of 11,177.96
      printedItemsTotal: 81971.74,
      warnings: [],
    });
    expect(supplier.lines.every((l) => l.discountPct === 0.12)).toBe(true);
    expect(round2(supplier.lines.reduce((s, l) => s + l.quantity, 0))).toBe(16866);
    expect(supplier.lines.reduce((s, l) => s + (l.packages ?? 0), 0)).toBe(1741);
    // The draft is issued against this invoice: no mismatch warning.
    expect(own.againstInvoice).toBe("111081");
    expect(own.warnings.filter((w) => w.includes("111081"))).toEqual([]);
  });

  it("finds the supplier by OCR when the scan has no text layer", async () => {
    const pdf = await readSample(PAIRS.harKor.supplier);
    const pages = () => NODE_SCAN_SUPPORT.jbig2Wasm().then((wasm) => loadScan(pdf, { "jbig2.wasm": wasm }));
    const parser = await detectScanned(supplierParsersFor(TEENA_RIMON), pages, NODE_SCAN_SUPPORT);
    expect(parser?.id).toBe("har-kor");
  });

  it("is rejected without scan support, naming the reason", async () => {
    const pair = PAIRS.harKor;
    const input = { ownPdf: await readSample(pair.own), supplierPdf: await readSample(pair.supplier), ownFileName: pair.own, supplierFileName: pair.supplier };
    await expect(extractInvoices(input, TEENA_RIMON)).rejects.toThrow("סרוקה");
  });
});

describe("confirmAmounts (OCR misreads)", () => {
  const rows = [
    { quantity: 630, unitPrice: 5, total: 3150 },
    { quantity: 507, unitPrice: 7.5, total: 3802.5 },
    { quantity: 480, unitPrice: 7.8, total: 3744 },
  ];
  const printed = { quantity: 1617, total: 10696.5 };

  it("leaves rows that check out alone", () => {
    expect(confirmAmounts(rows, printed).map((r) => [r.corrected, r.uncertain])).toEqual([[[], []], [[], []], [[], []]]);
  });

  it("corrects a misread weight when the printed totals prove it", () => {
    const read = rows.map((r) => ({ ...r }));
    read[1].quantity = 501; // 507 misread
    const [, fixed] = confirmAmounts(read, printed);
    expect(fixed).toMatchObject({ quantity: 507, corrected: ["quantity"], uncertain: [] });
  });

  it("corrects a misread total, and fills in an amount the OCR missed", () => {
    const read = rows.map((r) => ({ ...r })) as { quantity: number | null; unitPrice: number | null; total: number | null }[];
    read[0].total = 3750; // 3150 misread
    read[2].unitPrice = null;
    const result = confirmAmounts(read, printed);
    expect(result[0]).toMatchObject({ total: 3150, corrected: ["total"] });
    expect(result[2]).toMatchObject({ unitPrice: 7.8, corrected: ["unitPrice"] });
  });

  it("corrects a misread price: weight and total are confirmed by the footer", () => {
    const read = rows.map((r) => ({ ...r }));
    read[2].unitPrice = 1.8;
    expect(confirmAmounts(read, printed)[2]).toMatchObject({ unitPrice: 7.8, corrected: ["unitPrice"] });
  });

  it("marks a row uncertain instead of guessing when two amounts are wrong", () => {
    const read = rows.map((r) => ({ ...r }));
    read[1] = { quantity: 501, unitPrice: 7.5, total: 3302.5 };
    const result = confirmAmounts(read, printed);
    expect(result[1]).toMatchObject({ quantity: 501, total: 3302.5, corrected: [], uncertain: ["quantity", "unitPrice", "total"] });
    expect(result[0].uncertain).toEqual([]);
  });

  it("marks failing rows uncertain when no total is printed to check against", () => {
    const read = rows.map((r) => ({ ...r }));
    read[1].quantity = 501;
    expect(confirmAmounts(read, { quantity: null, total: 10696.5 })[1].uncertain).toEqual(["quantity", "unitPrice", "total"]);
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
