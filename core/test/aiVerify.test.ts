import { describe, expect, it } from "vitest";
import { verifyAiReading, type AiReading } from "../src/ai/verify.js";
import { granotParser } from "../src/parsers/granot.js";
import { loadPdf, type PdfDocument } from "../src/pdf/layout.js";
import { readingFrom } from "./aiReadings.js";
import { PAIRS, readSample } from "./helpers.js";

/**
 * The AI's answer is never taken on trust. A perfect reading of Granot's
 * invoice (built from its dedicated parser) must pass, keep its layout, and
 * the same reading with one wrong digit, a missing row or a wrong layout
 * must not.
 */
async function granot(): Promise<{ doc: PdfDocument; reading: AiReading }> {
  const doc = await loadPdf(await readSample(PAIRS.granot.supplier));
  return { doc, reading: readingFrom(granotParser.parse(doc)) };
}
const options = { scanned: false, vatHint: "570063362", now: new Date("2026-10-20T00:00:00Z") };

describe("checking the AI's reading against the invoice", () => {
  it("accepts a correct reading and keeps the layout it describes", async () => {
    const { doc, reading } = await granot();
    const { invoice, verified, profile } = verifyAiReading(reading, doc, options);
    expect(verified).toBe(true);
    expect(invoice).toMatchObject({ generic: "ai", vatId: "570063362", invoiceDate: "2026-09-10" });
    expect(invoice.lines.some((l) => l.ocrUncertain)).toBe(false);
    expect(profile).toMatchObject({ vatId: "570063362", version: 1, source: "pdf", totalLabel: 'סכום פטור ממע"מ' });
  });

  it("marks a row with a wrong digit, and keeps no layout", async () => {
    const { doc, reading } = await granot();
    reading.lines[3].quantity += 10;
    const { invoice, verified, profile } = verifyAiReading(reading, doc, options);
    expect(verified).toBe(false);
    expect(profile).toBeNull();
    expect(invoice.lines[3].ocrUncertain).toContain("quantity");
    expect(invoice.lines.filter((l) => l.ocrUncertain)).toHaveLength(1);
  });

  it("catches an invented amount that still multiplies out", async () => {
    const { doc, reading } = await granot();
    const line = reading.lines[0];
    line.quantity = 101;
    line.lineTotal = Math.round(101 * line.unitPrice * (1 - line.discountPct) * 100) / 100;
    const { invoice, verified } = verifyAiReading(reading, doc, options);
    expect(verified).toBe(false);
    expect(invoice.lines[0].ocrUncertain).toEqual(expect.arrayContaining(["quantity", "lineTotal"]));
  });

  it("notices a missing row by the printed total", async () => {
    const { doc, reading } = await granot();
    reading.lines.pop();
    const { invoice, verified } = verifyAiReading(reading, doc, options);
    expect(verified).toBe(false);
    expect(invoice.warnings.join(" ")).toContain("ייתכן שחסרות שורות");
  });

  it("keeps the reading but not a layout that does not read the same lines", async () => {
    const { doc, reading } = await granot();
    reading.profile.totalLabel = "סה\"כ לתשלום";
    const { verified, profile } = verifyAiReading(reading, doc, options);
    expect(verified).toBe(true);
    expect(profile).toBeNull();
  });
});
