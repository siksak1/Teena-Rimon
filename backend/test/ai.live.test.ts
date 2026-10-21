import { mkdirSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { verifyAiReading } from "../../core/src/ai/verify.js";
import { extractInvoices } from "../../core/src/extract.js";
import type { SupplierInvoice } from "../../core/src/model.js";
import { parseWithProfile } from "../../core/src/parsers/generic.js";
import type { AiRequest } from "../../core/src/remote.js";
import { PAIRS, readSample, TEENA_RIMON } from "../../core/test/helpers.js";
import { NODE_SCAN_SUPPORT } from "../../core/test/scanSupport.js";
import { costOf, readInvoice } from "../src/ai.js";

/**
 * "Drop a supplier's parser and check it still reads": every sample supplier
 * invoice goes to the real AI with every reader in the browser skipped, and
 * what comes back must equal what the supplier's own parser reads; the
 * learned layout must then read the same lines alone, without the AI.
 *
 * Costs real money (about $1 for all samples), so it runs only on request:
 *
 *   RUN_AI_TESTS=1 npm test --prefix backend -- ai.live            (all samples)
 *   RUN_AI_TESTS=1 AI_CASES=gilboa,granot npm test --prefix backend -- ai.live
 *
 * Needs ANTHROPIC_API_KEY (or `ant auth login`). Each answer is saved to
 * backend/test/ai-recordings/<case>.json for a look at what the AI said.
 */
const RUN = process.env.RUN_AI_TESTS === "1";
const ONLY = process.env.AI_CASES?.split(",");
const RECORDINGS = new URL("./ai-recordings/", import.meta.url);

const cases = Object.entries(PAIRS).filter(([name, pair]) => pair.format !== "excel" && (!ONLY || ONLY.includes(name)));

describe.skipIf(!RUN)("the AI reads every sample like its dedicated parser (live)", () => {
  const client = new Anthropic({ timeout: 280_000, maxRetries: 1 });
  let total = 0;

  for (const [name, pair] of cases) {
    it(name, async () => {
      // What the browser would send: the AI request, captured from the real extraction with nothing local enabled.
      const config = { ...TEENA_RIMON, suppliers: ["levi"], genericFallback: false, aiFallback: true };
      let request: AiRequest | null = null;
      const expected = await extractInvoices(
        { ownPdf: await readSample(pair.own), supplierPdf: await readSample(pair.supplier), ownFileName: "own.pdf", supplierFileName: `${name}.pdf` },
        TEENA_RIMON,
        NODE_SCAN_SUPPORT,
      );
      await extractInvoices(
        { ownPdf: await readSample(pair.own), supplierPdf: await readSample(pair.supplier), ownFileName: "own.pdf", supplierFileName: `${name}.pdf` },
        config,
        NODE_SCAN_SUPPORT,
        {
          profiles: async () => [],
          readWithAi: async (r) => {
            request = r;
            return expected.supplier;
          },
        },
      ).catch(() => {});
      if (name === "levi") return; // read by its own parser even here
      expect(request, "the invoice reached the AI step").not.toBeNull();
      const req = request as unknown as AiRequest;

      const { reading, usage } = await readInvoice(client, {
        pdfBase64: Buffer.from(req.pdf).toString("base64"),
        rows: req.rows,
        scanned: req.scanned,
        vatHint: req.vatHint,
      });
      total += costOf(usage);
      mkdirSync(RECORDINGS, { recursive: true });
      writeFileSync(new URL(`${name}.json`, RECORDINGS), JSON.stringify({ usage, reading }, null, 2));

      const { documentFromRows } = await import("../../core/src/remote.js");
      const doc = documentFromRows(req.rows, req.scanned);
      const { invoice, verified, profile } = verifyAiReading(reading, doc, { scanned: req.scanned, vatHint: req.vatHint });
      console.info(`${name}: ${invoice.lines.length} lines, verified=${verified}, learned=${profile != null}, $${costOf(usage).toFixed(3)} (total $${total.toFixed(2)})`);

      compare(name, invoice, expected.supplier);
      expect(verified, "every row and the total checked out").toBe(true);
      expect(profile, "a layout that reads the same lines alone").not.toBeNull();
      if (profile) expect(parseWithProfile(doc, profile).lines).toHaveLength(expected.supplier.lines.length);
    }, 300_000);
  }
});

function compare(name: string, got: SupplierInvoice, want: SupplierInvoice) {
  expect(got.lines.length, `${name}: line count`).toBe(want.lines.length);
  expect(got.printedItemsTotal ?? 0).toBeCloseTo(want.printedItemsTotal ?? 0, 0);
  got.lines.forEach((l, i) => {
    const w = want.lines[i];
    const at = `${name} row ${i + 1} (${w.description})`;
    expect(l.quantity, `${at}: quantity`).toBeCloseTo(w.quantity, 2);
    expect(l.unitPrice, `${at}: price`).toBeCloseTo(w.unitPrice, 3);
    expect(l.discountPct, `${at}: discount`).toBeCloseTo(w.discountPct, 3);
    expect(l.lineTotal, `${at}: total`).toBeCloseTo(w.lineTotal, 1);
    expect(l.date, `${at}: date`).toBe(w.date);
  });
}
