import Anthropic from "@anthropic-ai/sdk";
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
 * totals are), as "x:text" cells, so the profile's labels match what the
 * parser sees. The PDF itself carries every page.
 */
export function rowsForPrompt(rows: RowsPayload): string {
  const pages = [...new Set(rows.map((r) => r.page))];
  const keep = new Set([pages[0], pages.at(-1)]);
  return rows
    .filter((r) => keep.has(r.page))
    .map((r) => `p${r.page} y${Math.round(r.y)} | ${r.cells.map((c) => `${Math.round(c.xMin)}:${c.text}`).join(" | ")}`)
    .join("\n");
}

export type AiOptions = { effort?: "low" | "medium" | "high" };

/** Read one supplier invoice with Claude. Throws `AiUnreadable`, or the SDK's errors (network, rate limits). */
export async function readInvoice(
  client: Anthropic,
  input: { pdfBase64: string; rows: RowsPayload; scanned: boolean; vatHint: string | null },
  options: AiOptions = {},
): Promise<AiResult> {
  const hint = input.vatHint ? `\nThe wholesaler's records name the supplier's VAT number as ${input.vatHint}.` : "";
  const source = input.scanned
    ? "The PDF is a scan; the rows below were read from it by OCR in the browser and may contain misreadings — read the numbers from the image."
    : "The rows below are the PDF's own text layer, as the program extracted it.";
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
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 } },
          { type: "text", text: `${source}${hint}\n\nExtracted rows (first and last page):\n${rowsForPrompt(input.rows)}` },
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
