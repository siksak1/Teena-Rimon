import type { ExtractionResult, ParseMode } from "@core/model.js";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export class ExtractApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractApiError";
  }
}

/**
 * Where PDFs are parsed: "server" (the /api/extract Lambda) or "client"
 * (in this browser tab). Build-time default from VITE_PARSE_MODE, overridable
 * per visit with `?parse=client` / `?parse=server`.
 */
export function getParseMode(): ParseMode {
  const fromUrl = new URLSearchParams(window.location.search).get("parse");
  if (fromUrl === "client" || fromUrl === "server") return fromUrl;
  return import.meta.env.VITE_PARSE_MODE === "client" ? "client" : "server";
}

export async function extractInvoices(
  trFile: File,
  supplierFile: File,
  mode: ParseMode,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  return mode === "client"
    ? extractInBrowser(trFile, supplierFile)
    : extractOnServer(trFile, supplierFile, signal);
}

async function extractOnServer(
  trFile: File,
  supplierFile: File,
  signal?: AbortSignal,
): Promise<ExtractionResult> {
  const body = new FormData();
  body.append("trInvoice", trFile);
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
        : `קריאת הקבצים נכשלה (${response.status})`;
    throw new ExtractApiError(message);
  }

  return payload as ExtractionResult;
}

/** Same parsers as the API, loaded on demand so pdf.js stays out of the main bundle. */
async function extractInBrowser(trFile: File, supplierFile: File): Promise<ExtractionResult> {
  const { extractInvoices: extract } = await import("@core/extract.js");
  try {
    return await extract({
      trPdf: new Uint8Array(await trFile.arrayBuffer()),
      supplierPdf: new Uint8Array(await supplierFile.arrayBuffer()),
      trFileName: trFile.name,
      supplierFileName: supplierFile.name,
      parseMode: "client",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "ExtractionError") throw new ExtractApiError(err.message);
    throw err;
  }
}
