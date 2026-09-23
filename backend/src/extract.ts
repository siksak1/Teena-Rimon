import type { ExtractionResult } from "./schema.js";
import { invoiceExtractionSchema } from "./schema.js";
import { getMockExtraction } from "./mockData.js";

/**
 * Extracts structured invoice data from two PDF buffers.
 *
 * In development (NODE_ENV === 'development'), always returns mock JSON
 * so the frontend comparison engine can be tested without AI spend.
 *
 * In production, this is the single place to call Gemini/OpenAI with
 * structured output using `invoiceExtractionSchema`.
 */
export async function extractInvoices(
  ourPdf: Buffer,
  supplierPdf: Buffer,
  ourFileName: string,
  supplierFileName: string,
): Promise<ExtractionResult> {
  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    // Instant free path — no network, no API keys
    return getMockExtraction(ourFileName, supplierFileName);
  }

  return callAiExtraction(ourPdf, supplierPdf, ourFileName, supplierFileName);
}

/**
 * Production AI bridge. Wire Gemini or OpenAI here.
 * Requires GEMINI_API_KEY or OPENAI_API_KEY in the environment.
 */
async function callAiExtraction(
  ourPdf: Buffer,
  supplierPdf: Buffer,
  ourFileName: string,
  supplierFileName: string,
): Promise<ExtractionResult> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!geminiKey && !openaiKey) {
    throw new Error(
      "No AI API key configured. Set GEMINI_API_KEY or OPENAI_API_KEY, " +
        "or run with NODE_ENV=development to use mock extraction.",
    );
  }

  // Placeholder for structured-output call.
  // Keep the schema reference so Lambda packaging includes it.
  void invoiceExtractionSchema;
  void ourPdf;
  void supplierPdf;

  // Intentionally not implemented yet — mock covers local UX.
  // When ready, send both PDFs + invoiceExtractionSchema to the model
  // and map the response into ExtractionResult with meta.mode = "ai".
  throw new Error(
    `AI extraction is not configured yet for files "${ourFileName}" / "${supplierFileName}". ` +
      "Use NODE_ENV=development for mock mode, or implement the Gemini/OpenAI call in extract.ts.",
  );
}
