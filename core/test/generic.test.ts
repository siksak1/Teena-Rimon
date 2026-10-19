import { describe, expect, it } from "vitest";
import { agrolineGenericParser } from "../src/parsers/agroline.js";
import { genericTableParser, readAmount, readTable } from "../src/parsers/generic.js";
import { SUPPLIER_PARSERS } from "../src/parsers/registry.js";
import type { TextSupplierParser } from "../src/parsers/types.js";
import { loadPdf } from "../src/pdf/layout.js";
import { round2 } from "../src/pdf/text.js";
import { PAIRS, readSample } from "./helpers.js";

/**
 * The generic table parser against every supplier that has a parser of its
 * own: on each sample invoice it must read exactly the same lines — dates,
 * documents, names, quantities, prices, discounts and totals — without any
 * of that supplier's code. Formats it cannot read are listed with the reason.
 */
const KNOWN_GAPS: Record<string, string> = {
  harKor: "a scan: read by OCR with its own parser",
};
/** Suppliers read only by the generic parser: covered by their fixture and the tests below. */
const GENERIC_ONLY = new Set(["gilboa"]);


describe("generic table parser reproduces the dedicated parsers", () => {
  for (const [name, pair] of Object.entries(PAIRS)) {
    if (pair.format === "excel") continue;
    if (GENERIC_ONLY.has(name)) continue;
    const test = KNOWN_GAPS[name] ? it.skip : it;
    test(name, async () => {
      const doc = await loadPdf(await readSample(pair.supplier));
      // Meshek Dudu has no parser of its own: compare with the AGROLINE one.
      const dedicated = [...SUPPLIER_PARSERS, agrolineGenericParser].find((p): p is TextSupplierParser => !p.scanned && p.detect(doc))!;
      const expected = dedicated.parse(doc);
      expect(genericTableParser.detect(doc)).toBe(true);
      const actual = genericTableParser.parse(doc);

      expect(actual.lines.length, "line count").toBe(expected.lines.length);
      expect(actual.printedItemsTotal).toBeCloseTo(expected.printedItemsTotal!, 1);
      actual.lines.forEach((a, i) => {
        const e = expected.lines[i];
        const at = `${name} ${e.id} ${e.description}`;
        expect(a.discountPct, `${at}: discount`).toBeCloseTo(e.discountPct, 2);
        expect(a.lineTotal, `${at}: total`).toBeCloseTo(e.lineTotal, 2);
        // The unit is only told apart as units ("יח'") or weight (any other text).
        const same = { discountPct: 0, lineTotal: 0, unit: "" };
        expect(a.unit === "יח'", `${at}: unit`).toBe(e.unit === "יח'");
        expect({ ...a, ...same }, at).toEqual({ ...e, ...same });
      });
    });
  }
});

describe("generic table parser refuses rather than guesses", () => {
  it("rejects a table whose rows add up to no printed total", async () => {
    const doc = await loadPdf(await readSample(PAIRS.granot.supplier));
    // Drop every row that prints the items total (77,379.76).
    const rows = doc.rows.filter((r) => !r.text.includes("77,379.76"));
    const pages = doc.pages.map((p) => p.filter((r) => rows.includes(r)));
    const tampered = { ...doc, rows, pages, text: rows.map((r) => r.text).join("\n") };
    expect(() => genericTableParser.parse(tampered)).toThrow(/אינו מתאים לאף סה"כ.*\(הקרוב ביותר: /);
  });

  it("never takes a wholesaler's draft for a supplier invoice", async () => {
    for (const pair of Object.values(PAIRS)) {
      if (pair.format === "excel") continue;
      expect(genericTableParser.detect(await loadPdf(await readSample(pair.own))), pair.own).toBe(false);
    }
  });
});

describe("unknown supplier end to end", () => {
  it("reads Galil's invoice with the generic parser when Galil is not configured, and names it from the draft", async () => {
    const { extractInvoices } = await import("../src/extract.js");
    const { TEENA_RIMON } = await import("./helpers.js");
    const result = await extractInvoices(
      {
        ownPdf: await readSample(PAIRS.galil.own),
        supplierPdf: await readSample(PAIRS.galil.supplier),
        ownFileName: "own.pdf",
        supplierFileName: "supplier.pdf",
      },
      { ...TEENA_RIMON, suppliers: ["granot"] },
    );
    expect(result.supplier).toMatchObject({ generic: "table", supplierName: expect.stringContaining("גליל שוק מקומי"), vatId: "557636909" });
    expect(result.supplier.lines).toHaveLength(80);
  });
});

describe("generic table parser: layout variations", () => {
  it("reads amounts with the unit on either side and its quote mark moved", () => {
    expect(readAmount("'2.00 יח")).toBe(2);
    expect(readAmount("2.00 יח'")).toBe(2);
    expect(readAmount('ש"ח 3.000')).toBe(3);
    expect(readAmount("1,080.00 ק'ג")).toBe(1080);
    expect(readAmount(":39274.95")).toBe(39274.95);
    expect(readAmount("-0.21")).toBe(-0.21);
    for (const notAmount of ["263125", "12.00%", "31/08/26", "משטח טש 110", "12 ש\"ח 3.000"]) {
      expect(readAmount(notAmount), notAmount).toBeNull();
    }
  });

  it("reads Gilboa: pallets by their quantity column, not a row number, and the free line", async () => {
    const doc = await loadPdf(await readSample(PAIRS.gilboa.supplier));
    const { lines, pallets } = readTable(doc);
    // 29 pallets at 24.50; the one numbered "2" with 2 pallets used to be read as 2 × 24.50 by its row number.
    expect(round2(pallets)).toBe(710.5);
    expect(lines).toHaveLength(29);
    expect(lines.find((l) => l.lineTotal === 0)).toMatchObject({ quantity: 1080, unitPrice: 0, bookRef: "263346" });
    expect(genericTableParser.parse(doc).printedItemsTotal).toBe(52878.9);
  });

  it("accepts a gap the invoice explains by a printed rounding amount", async () => {
    const doc = await loadPdf(await readSample(PAIRS.gilboa.supplier));
    // Without "מחיר כולל", only the VAT-exempt amount is left: 52,879.10, which
    // carries 0.20 of the −0.21 "הנחה כללית" printed on its own row.
    const rows = doc.rows.filter((r) => !r.text.includes("מחיר כולל"));
    const pages = doc.pages.map((p) => p.filter((r) => rows.includes(r)));
    const tampered = { ...doc, rows, pages, text: rows.map((r) => r.text).join("\n") };
    const invoice = genericTableParser.parse(tampered);
    expect(invoice.printedItemsTotal).toBe(52878.9);
    expect(invoice.warnings.join(" ")).toContain("הפרש של 0.2");
  });
});
