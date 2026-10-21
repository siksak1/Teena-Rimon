import { describe, expect, it } from "vitest";
import { extractInvoices } from "../src/extract.js";
import { harKorParser } from "../src/parsers/harKor.js";
import { mergeReadings, splitAtRules } from "../src/pdf/ocrDocument.js";
import { loadScan } from "../src/pdf/scan.js";
import { PAIRS, readSample, TEENA_RIMON } from "./helpers.js";
import { NODE_SCAN_SUPPORT } from "./scanSupport.js";

/**
 * A scan from a supplier with no parser of its own is read by OCR of the
 * whole page and then by the generic parsers, before anything is sent out.
 * Har-Kor's scan, with Har-Kor's parser removed, must come out with exactly
 * the amounts its own parser reads (or be refused; never other numbers).
 */
describe("unknown scanned supplier: OCR, then the generic parser", () => {
  it("reads Har-Kor's scan without Har-Kor's parser, amount for amount", async () => {
    const result = await extractInvoices(
      {
        ownPdf: await readSample(PAIRS.harKor.own),
        supplierPdf: await readSample(PAIRS.harKor.supplier),
        ownFileName: "own.pdf",
        supplierFileName: "scan.pdf",
      },
      { ...TEENA_RIMON, suppliers: TEENA_RIMON.suppliers.filter((s) => s !== "har-kor") },
      NODE_SCAN_SUPPORT,
    );
    const supplierPdf = await readSample(PAIRS.harKor.supplier);
    const pages = (await loadScan(supplierPdf, { "jbig2.wasm": await NODE_SCAN_SUPPORT.jbig2Wasm() }))!;
    const dedicated = await harKorParser.parseScan(pages, await NODE_SCAN_SUPPORT.ocr());

    const got = result.supplier;
    expect(got).toMatchObject({ generic: "table", scanned: true, invoiceNumber: dedicated.invoiceNumber, invoiceDate: dedicated.invoiceDate });
    expect(got.printedItemsTotal).toBeCloseTo(dedicated.printedItemsTotal!, 2);
    expect(got.lines).toHaveLength(dedicated.lines.length);
    got.lines.forEach((line, i) => {
      const want = dedicated.lines[i];
      const at = `row ${i + 1}`;
      expect(line.date, at).toBe(want.date);
      expect(line.quantity, at).toBe(want.quantity);
      expect(line.unitPrice, at).toBeCloseTo(want.unitPrice, 3);
      expect(line.discountPct, at).toBeCloseTo(want.discountPct, 4);
      expect(line.lineTotal, at).toBeCloseTo(want.lineTotal, 2);
    });
    // The one row OCR misread is restored from the printed total, and marked for checking.
    expect(got.lines.filter((l) => l.ocrUncertain)).toHaveLength(1);
    expect(got.warnings.join(" ")).toContain("שוחזר לפי הסה\"כ המודפס");
    expect(got.warnings.join(" ")).toContain("סרוקה ונקראה ב-OCR");
  }, 120_000);
});

describe("OCR word handling", () => {
  const word = (text: string, left: number, right: number, confidence = 0.9) => ({ text, left, right, top: 10, bottom: 30, confidence });

  it("splits a word read across an erased column rule into two amounts", () => {
    const parts = splitAtRules(word("7.30180.00", 100, 200), [{ x: 140, top: 0, bottom: 100 }]);
    expect(parts.map((p) => p.text)).toEqual(["7.30", "180.00"]);
    expect(parts[0].right).toBe(140);
  });

  it("keeps a word that no rule crosses, and Hebrew words", () => {
    expect(splitAtRules(word("1,440.00", 100, 160), [{ x: 300, top: 0, bottom: 100 }])).toHaveLength(1);
    expect(splitAtRules(word("סמרסט", 100, 160), [{ x: 130, top: 0, bottom: 100 }])).toHaveLength(1);
  });

  it("takes numbers from the digits-only reading and keeps the other as an alternative", () => {
    const merged = mergeReadings([word("450", 10, 40), word("שזיף", 50, 90)], [word("4.50", 10, 40)]);
    expect(merged.map((w) => [w.text, w.alt])).toEqual([
      ["4.50", "450"],
      ["שזיף", undefined],
    ]);
  });
});
