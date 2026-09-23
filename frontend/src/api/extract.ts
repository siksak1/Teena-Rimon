import type { ExtractionResult } from "../types/invoice";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export class ExtractApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractApiError";
  }
}

/**
 * POST both PDFs to the minimal backend. Returns raw structured JSON only —
 * all comparison happens on the client via `compareInvoices`.
 */
export async function extractInvoices(
  ourFile: File,
  supplierFile: File,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const body = new FormData();
  body.append("ourInvoice", ourFile);
  body.append("supplierInvoice", supplierFile);

  const response = await fetch(`${API_BASE}/api/extract`, {
    method: "POST",
    body,
    signal,
  });

  const payload = (await response.json().catch(() => null)) as
    | ExtractionResult
    | { error?: string }
    | null;

  if (!response.ok) {
    const message =
      payload && "error" in payload && payload.error
        ? payload.error
        : `Extraction failed (${response.status})`;
    throw new ExtractApiError(message);
  }

  return payload as ExtractionResult;
}
