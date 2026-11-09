import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type { AiReading } from "../../core/src/ai/verify.js";
import type { RowsPayload } from "../../core/src/remote.js";
import { AiUnreadable, MAX_PARALLEL_CALLS, pageChunks, readInvoice } from "../src/ai.js";

/**
 * How one invoice is split across AI calls, with a fake client: CloudFront
 * gives the whole request 60 s, so a multi-page invoice (a 5-page scanned
 * statement once took longer) is read one page per call, in parallel.
 */
type Line = AiReading["lines"][number];
const line = (page: number, lineTotal: number): Line => ({
  page,
  date: "01/10/2026",
  docNumber: "1",
  bookRef: null,
  description: "מלפפון",
  sku: null,
  packages: 1,
  quantity: 1,
  unit: 'ק"ג',
  unitPrice: lineTotal,
  discountPct: 0,
  lineTotal,
});
const reading = (lines: Line[], name = "ספק"): AiReading => ({
  supplierName: name,
  vatId: "511051815",
  invoiceNumber: "133",
  invoiceDate: "31/10/2026",
  printedItemsTotal: 600,
  lines,
  profile: {
    headers: [],
    amountColumns: { quantity: "כמות", unitPrice: "מחיר", total: 'סה"כ', discount: null },
    totalLabel: 'סה"כ',
    invoiceNumberLabel: null,
    dateLabel: null,
    discountSource: "none",
    amountUnits: [],
    skipRows: [],
  },
});
const rowsOn = (pageCount: number): RowsPayload =>
  Array.from({ length: pageCount }, (_, i) => ({ page: i + 1, y: 100, cells: [{ text: `עמוד ${i + 1}`, xMin: 10, xMax: 50 }] }));

/** A client whose answer depends on which pages the prompt asks for; records every prompt. */
function fakeClient(answer: (prompt: string) => AiReading | "refusal") {
  const prompts: string[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: { messages: { content: { type: string; text?: string }[] }[] }) {
          const prompt = params.messages[0].content.find((c) => c.type === "text")!.text!;
          prompts.push(prompt);
          const out = answer(prompt);
          return {
            finalMessage: async () => ({
              stop_reason: out === "refusal" ? "refusal" : "end_turn",
              usage: { input_tokens: 1000, output_tokens: 100 },
              content: out === "refusal" ? [] : [{ type: "text", text: JSON.stringify(out) }],
            }),
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, prompts };
}
const input = (pageCount: number) => ({ pdfBase64: "x", rows: rowsOn(pageCount), scanned: true, vatHint: null });
const askedPage = (prompt: string) => Number(/printed on page (\d+)/.exec(prompt)?.[1]);

describe("reading an invoice with the AI", () => {
  it("reads a one-page invoice in a single call", async () => {
    const { client, prompts } = fakeClient(() => reading([line(1, 100)]));
    const { reading: out, usage } = await readInvoice(client, input(1));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).not.toContain("other calls read the rest");
    expect(out.lines.map((l) => l.lineTotal)).toEqual([100]);
    expect(usage).toEqual({ inputTokens: 1000, outputTokens: 100 });
  });

  it("reads each page of a multi-page invoice in its own call and joins the rows in page order", async () => {
    // Each call answers its own page, plus a stray row from another page that must be dropped.
    const { client, prompts } = fakeClient((prompt) => {
      const page = askedPage(prompt);
      return reading([line(page, page * 100), line(page === 1 ? 2 : 1, 999)], `ספק ${page}`);
    });
    const { reading: out, usage } = await readInvoice(client, input(3));
    expect(prompts).toHaveLength(3);
    expect(prompts.map(askedPage).sort()).toEqual([1, 2, 3]);
    expect(prompts[0]).toContain("The invoice has 3 pages");
    expect(out.lines.map((l) => [l.page, l.lineTotal])).toEqual([
      [1, 100],
      [2, 200],
      [3, 300],
    ]);
    expect(out.supplierName).toBe("ספק 1");
    expect(usage).toEqual({ inputTokens: 3000, outputTokens: 300 });
  });

  it("refuses the whole invoice if any page's call does", async () => {
    const { client } = fakeClient((prompt) => (askedPage(prompt) === 2 ? "refusal" : reading([])));
    await expect(readInvoice(client, input(3))).rejects.toBeInstanceOf(AiUnreadable);
  });

  it("groups pages so no invoice makes more than the maximum number of calls", () => {
    expect(pageChunks(2)).toEqual([[1], [2]]);
    expect(pageChunks(MAX_PARALLEL_CALLS)).toHaveLength(MAX_PARALLEL_CALLS);
    const many = pageChunks(25);
    expect(many.length).toBeLessThanOrEqual(MAX_PARALLEL_CALLS);
    expect(many.flat()).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});
