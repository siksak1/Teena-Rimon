import type Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
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
  /** The PDF (base64) each call was sent, in call order. */
  const documents: string[] = [];
  const client = {
    beta: {
      messages: {
        stream(params: { messages: { content: { type: string; text?: string; source?: { data: string } }[] }[] }) {
          const prompt = params.messages[0].content.find((c) => c.type === "text")!.text!;
          prompts.push(prompt);
          documents.push(params.messages[0].content.find((c) => c.type === "document")!.source!.data);
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
  return { client: client as unknown as Anthropic, prompts, documents };
}
const input = (pageCount: number) => ({ pdfBase64: "x", rows: rowsOn(pageCount), scanned: true, vatHint: null });
const askedPage = (prompt: string) => Number(/printed on page (\d+)/.exec(prompt)?.[1]);
/** The pages a prompt asks for: "page 3", "pages 1–3" or "pages 2, 4". */
function askedPages(prompt: string): number[] {
  const [, list] = /printed on pages? ([\d–, ]+?),? with/.exec(prompt) ?? [];
  const range = /^(\d+)–(\d+)$/.exec(list);
  if (range) return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => Number(range[1]) + i);
  return list.split(", ").map(Number);
}

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

  it("reads again a page whose call came back empty when the rows fall short of the printed total", async () => {
    // Printed total 600 = 100 + 200 + 300; page 2's first call lists nothing.
    let page2Calls = 0;
    const { client, prompts } = fakeClient((prompt) => {
      const page = askedPage(prompt);
      if (page === 2 && ++page2Calls === 1) return reading([]);
      return reading([line(page, page * 100)]);
    });
    const { reading: out, usage } = await readInvoice(client, input(3));
    expect(prompts.map(askedPage)).toEqual([1, 2, 3, 2]);
    expect(out.lines.map((l) => [l.page, l.lineTotal])).toEqual([
      [1, 100],
      [2, 200],
      [3, 300],
    ]);
    expect(usage).toEqual({ inputTokens: 4000, outputTokens: 400 });
  });

  it("reads again a page whose rows came back numbered as another page's", async () => {
    // The 14-page scan that lost pages 5–6: a call's rows were dropped and the invoice came back 24,731.55 short.
    let page2Calls = 0;
    const { client, prompts } = fakeClient((prompt) => {
      const page = askedPage(prompt);
      if (page === 2 && ++page2Calls === 1) return reading([line(3, 200)]);
      return reading([line(page, page * 100)]);
    });
    const { reading: out } = await readInvoice(client, input(3));
    expect(prompts).toHaveLength(4);
    expect(out.lines.map((l) => [l.page, l.lineTotal])).toEqual([
      [1, 100],
      [2, 200],
      [3, 300],
    ]);
  });

  it("does not read again a page with no rows when the rest add up to the printed total", async () => {
    // A last page holding only the footer: 100 + 500 = 600.
    const { client, prompts } = fakeClient((prompt) => {
      const page = askedPage(prompt);
      return reading(page === 3 ? [] : [line(page, page === 1 ? 100 : 500)]);
    });
    const { reading: out } = await readInvoice(client, input(3));
    expect(prompts).toHaveLength(3);
    expect(out.lines.map((l) => l.lineTotal)).toEqual([100, 500]);
  });

  it("names the pages a re-read call covers when they are not consecutive", async () => {
    // 40 pages, read three per call; only odd pages come back with rows, so 20 even pages are read again, two per call.
    const { client, prompts } = fakeClient((prompt) => reading(askedPages(prompt).filter((p) => p % 2 === 1).map((p) => line(p, 100))));
    const { reading: out } = await readInvoice(client, input(40));
    const retries = prompts.slice(pageChunks(40).length);
    const even = Array.from({ length: 20 }, (_, i) => 2 * (i + 1));
    expect(retries).toHaveLength(pageChunks(20).length);
    expect(retries[0]).toContain("printed on pages 2, 4,");
    expect(retries.flatMap(askedPages)).toEqual(even);
    expect(out.lines.map((l) => l.page)).toEqual(even.map((p) => p - 1));
  });

  it("sends each call only its own pages, with the first and last page for the headers and totals", async () => {
    const pdf = await PDFDocument.create();
    for (let i = 1; i <= 10; i++) pdf.addPage([200 + i, 300]); // each page's width tells it apart
    const pdfBase64 = Buffer.from(await pdf.save()).toString("base64");
    const { client, prompts, documents } = fakeClient((prompt) => reading([line(askedPage(prompt), 60)]));
    await readInvoice(client, { ...input(10), pdfBase64 });

    const widths = await Promise.all(
      documents.map(async (d) => (await PDFDocument.load(Buffer.from(d, "base64"))).getPages().map((p) => p.getWidth() - 200)),
    );
    const byPage = new Map(prompts.map((p, i) => [askedPage(p), { prompt: p, pages: widths[i] }]));
    expect(byPage.get(4)!.pages).toEqual([1, 4, 10]);
    expect(byPage.get(4)!.prompt).toContain("holds only pages 1, 4, 10 of the invoice");
    expect(byPage.get(1)!.pages).toEqual([1, 10]);
    expect(byPage.get(10)!.pages).toEqual([1, 10]);
  });

  it("sends the whole file when it cannot split the PDF", async () => {
    const { client, prompts, documents } = fakeClient((prompt) => reading([line(askedPage(prompt), 200)]));
    await readInvoice(client, input(3)); // "x" is not a PDF
    expect(documents).toEqual(["x", "x", "x"]);
    expect(prompts[0]).not.toContain("holds only pages");
  });

  it("groups pages so no invoice makes more than the maximum number of calls", () => {
    expect(pageChunks(2)).toEqual([[1], [2]]);
    expect(pageChunks(MAX_PARALLEL_CALLS)).toHaveLength(MAX_PARALLEL_CALLS);
    const many = pageChunks(25);
    expect(many.length).toBeLessThanOrEqual(MAX_PARALLEL_CALLS);
    expect(many.flat()).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  });
});
