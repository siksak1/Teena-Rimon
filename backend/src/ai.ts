import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { aiReadingSchema, type AiReading } from "../../core/src/ai/verify.js";
import type { RowsPayload } from "../../core/src/remote.js";

/** Chosen for cost (see DEPLOY.md); every reading is checked against the PDF anyway. */
export const MODEL = "claude-sonnet-5-5";
/** $ per million tokens, for the usage counters and alert e-mails. */
export const PRICE = { input: 2, output: 10 };

export type AiUsage = { inputTokens: number; outputTokens: number };
export type AiResult = { reading: AiReading; usage: AiUsage };

/** Why the AI gave no reading: the model declined, or its answer was cut off or malformed. */
export class AiUnreadable extends Error {}

const SYSTEM = `You read Israeli produce suppliers' consolidated invoices (Hebrew, right to left) for a wholesaler who checks them against its own records. A program, not a person, uses your answer, and every number you give is checked against the PDF: copy amounts exactly as printed and never compute, round or guess one. If a value is not printed, use null.

Return:
- supplierName, vatId (the supplier's "עוסק מורשה" / "ח.פ" number, digits only — not the customer's), invoiceNumber, invoiceDate (DD/MM/YYYY).
- lines: every item row of the item table, in printed order, across all pages. Not pallets, deposits, empty packaging or other charges that are not produce ("משטח", "פקדון", "מכל ריק"); not subtotal rows. For each: page (1-based), date (DD/MM/YYYY; rows under a group heading take its date), docNumber (the delivery note, "תעודה"/"משלוח"), bookRef (booklet reference, "פנקס"), description, sku, packages (number of packages/cartons, or null), quantity (the weight in kg, or units when sold by unit), unit (as printed, e.g. ק"ג or יח'), unitPrice (the list price per unit, before discount), discountPct (a fraction, 0.12 for 12%; 0 if none), lineTotal (after the row's discount).
  If the invoice prints a single discount in its footer that applies to all lines (e.g. "הנחה 12%") and the line totals are printed before it, set each line's discountPct to that rate and its lineTotal to the printed total × (1 − rate), rounded to 2 decimals.
- printedItemsTotal: the produce items total consistent with your lines (after discounts): usually the VAT-exempt amount ("סכום פטור ממע"מ") or the items total, not the amount to pay.
- profile: how to find these fields in this supplier's layout, for a program that will read the supplier's next invoices without you.
  headers: each column header of the item table exactly as printed (joined top to bottom if stacked over lines) with its field, one of: date, doc, bookRef, sku, description, variety, packageType, packages, quantity, unit, unitPrice, discount, netPrice (a price after discount), total, pallet.
  amountColumns: the headers of the quantity, unit price and line total columns (and discount, or null).
  totalLabel: the label printed beside printedItemsTotal (or beside the gross total when a footer discount applies). invoiceNumberLabel, dateLabel: the labels beside them, or null.
  discountSource: "row" (a percentage on each row), "footer" (one rate in the footer), "netPriceColumn" (a second, discounted price column), or "none".
  amountUnits: unit marks printed beside amounts other than ק"ג, ש"ח, יח' (e.g. "₪"); usually empty. skipRows: regular expressions matching rows in the item table that are not items (e.g. "משטח"); usually empty.
  Use labels exactly as they appear in the extracted text rows given below, which is what the program sees.`;

/** JSON schema for structured outputs: every object closed, every field required. */
const nullable = (type: string) => ({ type: [type, "null"] });
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["supplierName", "vatId", "invoiceNumber", "invoiceDate", "printedItemsTotal", "lines", "profile"],
  properties: {
    supplierName: { type: "string" },
    vatId: nullable("string"),
    invoiceNumber: { type: "string" },
    invoiceDate: nullable("string"),
    printedItemsTotal: nullable("number"),
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["page", "date", "docNumber", "bookRef", "description", "sku", "packages", "quantity", "unit", "unitPrice", "discountPct", "lineTotal"],
        properties: {
          page: { type: "integer" },
          date: nullable("string"),
          docNumber: nullable("string"),
          bookRef: nullable("string"),
          description: { type: "string" },
          sku: nullable("string"),
          packages: nullable("number"),
          quantity: { type: "number" },
          unit: { type: "string" },
          unitPrice: { type: "number" },
          discountPct: { type: "number" },
          lineTotal: { type: "number" },
        },
      },
    },
    profile: {
      type: "object",
      additionalProperties: false,
      required: ["headers", "amountColumns", "totalLabel", "invoiceNumberLabel", "dateLabel", "discountSource", "amountUnits", "skipRows"],
      properties: {
        headers: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "field"],
            properties: {
              label: { type: "string" },
              field: {
                type: "string",
                enum: ["date", "doc", "bookRef", "sku", "description", "variety", "packageType", "packages", "quantity", "unit", "unitPrice", "discount", "netPrice", "total", "pallet"],
              },
            },
          },
        },
        amountColumns: {
          type: "object",
          additionalProperties: false,
          required: ["quantity", "unitPrice", "total", "discount"],
          properties: { quantity: { type: "string" }, unitPrice: { type: "string" }, total: { type: "string" }, discount: nullable("string") },
        },
        totalLabel: { type: "string" },
        invoiceNumberLabel: nullable("string"),
        dateLabel: nullable("string"),
        discountSource: { type: "string", enum: ["row", "footer", "netPriceColumn", "none"] },
        amountUnits: { type: "array", items: { type: "string" } },
        skipRows: { type: "array", items: { type: "string" } },
      },
    },
  },
};

/**
 * The extracted rows of the first and last pages (where the headers and the
 * totals are), plus any pages one call reads, as "x:text" cells, so the
 * profile's labels match what the parser sees.
 */
export function rowsForPrompt(rows: RowsPayload, extraPages: number[] = []): string {
  const pages = [...new Set(rows.map((r) => r.page))];
  const keep = new Set([pages[0], pages.at(-1), ...extraPages]);
  return rows
    .filter((r) => keep.has(r.page))
    .map((r) => `p${r.page} y${Math.round(r.y)} | ${r.cells.map((c) => `${Math.round(c.xMin)}:${c.text}`).join(" | ")}`)
    .join("\n");
}

export type AiOptions = { effort?: "low" | "medium" | "high" };
export type AiInput = { pdfBase64: string; rows: RowsPayload; scanned: boolean; vatHint: string | null };

/**
 * Most parallel calls for one invoice. CloudFront waits 60 s for the whole
 * request, and a call takes roughly as long as the rows it writes out, so a
 * multi-page invoice is read one page per call, all at once; past this many
 * pages, a call reads several.
 */
export const MAX_PARALLEL_CALLS = 15;

/** The pages each call reads: one page per call, or consecutive runs of pages when there are more than `MAX_PARALLEL_CALLS`. */
export function pageChunks(pageCount: number): number[][] {
  const size = Math.ceil(pageCount / MAX_PARALLEL_CALLS);
  const chunks: number[][] = [];
  for (let first = 1; first <= pageCount; first += size) {
    chunks.push(Array.from({ length: Math.min(size, pageCount - first + 1) }, (_, i) => first + i));
  }
  return chunks;
}

/** A gap between the rows and the printed items total small enough to be rounding. */
const TOTAL_SLACK = 1;

/**
 * Read one supplier invoice with Claude. A multi-page invoice is read by
 * parallel calls that each list the rows of their own pages (see
 * `MAX_PARALLEL_CALLS`); the first call's header fields, total and profile
 * are kept, since every call sees the whole PDF. Throws `AiUnreadable` if
 * any call does, or the SDK's errors (network, rate limits).
 *
 * A call sometimes answers with no rows for a page that has them (an empty
 * list, or rows numbered as another page's, which are dropped). When the rows
 * then fall short of the printed items total, each page left without rows is
 * read again, one page per call. This second round costs time only on an
 * invoice that would otherwise come back with rows missing.
 */
export async function readInvoice(client: Anthropic, input: AiInput, options: AiOptions = {}): Promise<AiResult> {
  const pageCount = Math.max(1, ...input.rows.map((r) => r.page));
  if (pageCount === 1) return readOnce(client, input, options, null, { base64: input.pdfBase64, pages: null });
  const source = await loadPdf(input.pdfBase64);
  const readPages = (chunks: number[][]) =>
    Promise.all(
      chunks.map(async (pages) => {
        const pdf = await pdfFor(source, input.pdfBase64, pages, pageCount);
        const result = await readOnce(client, input, options, { pages, of: pageCount }, pdf);
        return { ...result, lines: result.reading.lines.filter((l) => pages.includes(l.page)) };
      }),
    );

  const first = await readPages(pageChunks(pageCount));
  const lines = first.flatMap((r) => r.lines);
  const total = first[0].reading.printedItemsTotal;
  const sum = lines.reduce((s, l) => s + l.lineTotal, 0);
  const emptyPages = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => !lines.some((l) => l.page === p));
  const short = total == null || Math.abs(sum - total) > TOTAL_SLACK;
  const second = short && emptyPages.length > 0 ? await readPages(retryChunks(emptyPages)) : [];

  const all = [...first, ...second];
  return {
    reading: {
      ...first[0].reading,
      lines: [...lines, ...second.flatMap((r) => r.lines)].sort((a, b) => a.page - b.page),
    },
    usage: {
      inputTokens: all.reduce((n, r) => n + r.usage.inputTokens, 0),
      outputTokens: all.reduce((n, r) => n + r.usage.outputTokens, 0),
    },
  };
}

/** The PDF one call is sent: the whole file, or only some of its pages (by their number in the whole file). */
type CallPdf = { base64: string; pages: number[] | null };

/** The supplier's PDF, parsed once per invoice; null if pdf-lib cannot read it (then every call gets the whole file). */
async function loadPdf(base64: string): Promise<PDFDocument | null> {
  try {
    return await PDFDocument.load(Buffer.from(base64, "base64"), { ignoreEncryption: true, updateMetadata: false });
  } catch {
    return null;
  }
}

/**
 * The pages one call reads, plus the first and last page (the table headers,
 * the invoice number and the totals), as a PDF of their own. Every call used
 * to get the whole file: a 14-page scan sent about 270,000 input tokens in
 * one burst, which ran into the API's per-minute token limit on a retry.
 */
async function pdfFor(source: PDFDocument | null, whole: string, pages: number[], pageCount: number): Promise<CallPdf> {
  const keep = [...new Set([1, ...pages, pageCount])].sort((a, b) => a - b);
  if (!source || keep.length >= pageCount || source.getPageCount() !== pageCount) return { base64: whole, pages: null };
  try {
    const part = await PDFDocument.create();
    for (const page of await part.copyPages(source, keep.map((p) => p - 1))) part.addPage(page);
    return { base64: Buffer.from(await part.save()).toString("base64"), pages: keep };
  } catch {
    return { base64: whole, pages: null };
  }
}

/** The pages to read again, one per call while they fit in `MAX_PARALLEL_CALLS`. */
function retryChunks(pages: number[]): number[][] {
  return pageChunks(pages.length).map((chunk) => chunk.map((i) => pages[i - 1]));
}

function pagesText(pages: number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`;
  // A re-read of pages left without rows may skip pages in between.
  const consecutive = pages.every((p, i) => i === 0 || p === pages[i - 1] + 1);
  return consecutive ? `pages ${pages[0]}–${pages.at(-1)}` : `pages ${pages.join(", ")}`;
}

async function readOnce(
  client: Anthropic,
  input: AiInput,
  options: AiOptions,
  part: { pages: number[]; of: number } | null,
  pdf: CallPdf,
): Promise<AiResult> {
  const hint = input.vatHint ? `\nThe wholesaler's records name the supplier's VAT number as ${input.vatHint}.` : "";
  const source = input.scanned
    ? "The PDF is a scan; the rows below were read from it by OCR in the browser and may contain misreadings — read the numbers from the image."
    : "The rows below are the PDF's own text layer, as the program extracted it.";
  const scope = part
    ? `\n\nThe invoice has ${part.of} pages, and other calls read the rest.${
        pdf.pages
          ? ` To save time, the PDF attached holds only pages ${pdf.pages.join(", ")} of the invoice, in that order; give every row the page number it has in the whole invoice, not its position in this PDF.`
          : ""
      } In lines, list only the item rows printed on ${pagesText(part.pages)}, with their page numbers counted from the first page of the invoice; return an empty list if there are none. Fill every other field from the invoice as usual (the first and last pages carry the headers and totals).`
    : "";
  const shown = part ? "first and last page, and the pages you read" : "first and last page";
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: options.effort ?? "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.base64 } },
          { type: "text", text: `${source}${hint}${scope}\n\nExtracted rows (${shown}):\n${rowsForPrompt(input.rows, part?.pages)}` },
        ],
      },
    ],
  });
  const message = await stream.finalMessage();
  const usage = {
    inputTokens: (message.usage.iterations ?? []).reduce((n, it) => n + (it.input_tokens ?? 0), 0) || message.usage.input_tokens,
    outputTokens: (message.usage.iterations ?? []).reduce((n, it) => n + (it.output_tokens ?? 0), 0) || message.usage.output_tokens,
  };
  if (message.stop_reason === "refusal") throw new AiUnreadable("declined");
  if (message.stop_reason === "max_tokens") throw new AiUnreadable("answer cut off");
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiUnreadable("not JSON");
  }
  const parsed = aiReadingSchema.safeParse(json);
  if (!parsed.success) throw new AiUnreadable("unexpected shape");
  return { reading: parsed.data, usage };
}

/** Cost in dollars of one call, for the counters. */
export function costOf(usage: AiUsage): number {
  return (usage.inputTokens * PRICE.input + usage.outputTokens * PRICE.output) / 1_000_000;
}
