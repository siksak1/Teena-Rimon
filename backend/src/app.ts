import { z } from "zod";
import { verifyAiReading } from "../../core/src/ai/verify.js";
import { documentFromRows, type RowsPayload } from "../../core/src/remote.js";
import { AiUnreadable, costOf, type AiResult } from "./ai.js";
import { afterAiCall, newFormatLearned, type AlertConfig, type AlertSink } from "./alerts.js";
import { month, type Store } from "./store.js";

export type Request = {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body: string | null;
};
export type Response = { status: number; body: unknown };

export type Deps = {
  /** The customer slug a secret URL token belongs to, or null. */
  customerOf(token: string): Promise<string | null>;
  store: Store;
  readInvoice(input: { pdfBase64: string; rows: RowsPayload; scanned: boolean; vatHint: string | null }): Promise<AiResult>;
  alerts: { sink: AlertSink; config: AlertConfig };
  /** AI calls one customer may make per day. */
  dailyLimit: number;
  now(): Date;
  /** Counts and outcomes only: never invoice text, file names or tokens. */
  log(event: Record<string, string | number | boolean>): void;
};

/** 6 MB is the Lambda request limit; base64 adds a third. */
const MAX_PDF_BASE64 = 5_500_000;

const parseBody = z.strictObject({
  pdf: z.string().min(100).max(MAX_PDF_BASE64),
  fileName: z.string().max(300),
  scanned: z.boolean(),
  rows: z
    .array(
      z.strictObject({
        page: z.number().int().min(1).max(500),
        y: z.number(),
        cells: z.array(z.strictObject({ text: z.string().max(500), xMin: z.number(), xMax: z.number() })).max(80),
      }),
    )
    .max(20_000),
  vatHint: z.string().regex(/^\d{8,9}$/).nullable(),
});

/**
 * The backend's two routes:
 *
 *   GET  /profiles?vat=a,b   learned layouts for these VAT numbers (labels only, no invoice data)
 *   POST /parse              read one invoice with the AI; check it; learn the layout
 *
 * Both need the customer's secret URL token in `X-Customer-Token`.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  const token = req.headers["x-customer-token"] ?? "";
  const slug = /^[a-z0-9-]{8,80}$/.test(token) ? await deps.customerOf(token) : null;
  if (!slug) return { status: 404, body: { error: "NOT_FOUND" } };

  if (req.method === "GET" && req.path === "/profiles") {
    const vatIds = [...new Set((req.query.vat ?? "").split(","))].filter((v) => /^\d{8,9}$/.test(v)).slice(0, 20);
    const stored = await deps.store.profiles(vatIds);
    if (stored.length > 0) await deps.store.recordLookup(slug, stored.map((s) => s.profile.vatId), deps.now());
    deps.log({ route: "profiles", customer: slug, asked: vatIds.length, found: stored.length });
    return { status: 200, body: { profiles: stored.map((s) => s.profile) } };
  }

  if (req.method === "POST" && req.path === "/parse") return parse(req, slug, deps);

  return { status: 404, body: { error: "NOT_FOUND" } };
}

async function parse(req: Request, slug: string, deps: Deps): Promise<Response> {
  let input: z.infer<typeof parseBody>;
  try {
    input = parseBody.parse(JSON.parse(req.body ?? ""));
  } catch {
    return { status: 400, body: { error: "BAD_REQUEST" } };
  }
  const now = deps.now();
  if ((await deps.store.aiCallsToday(slug, now)) >= deps.dailyLimit) {
    deps.log({ route: "parse", customer: slug, outcome: "rate_limited" });
    return { status: 429, body: { error: "AI_RATE_LIMITED" } };
  }

  const started = Date.now();
  let result: AiResult;
  try {
    result = await deps.readInvoice({ pdfBase64: input.pdf, rows: input.rows, scanned: input.scanned, vatHint: input.vatHint });
  } catch (err) {
    const unreadable = err instanceof AiUnreadable;
    deps.log({ route: "parse", customer: slug, outcome: unreadable ? "unreadable" : "ai_error", ms: Date.now() - started });
    return unreadable ? { status: 422, body: { error: "AI_UNREADABLE" } } : { status: 502, body: { error: "AI_UNAVAILABLE" } };
  }

  const doc = documentFromRows(input.rows, input.scanned);
  const { invoice, verified, profile } = verifyAiReading(result.reading, doc, { scanned: input.scanned, vatHint: input.vatHint, now });
  const saved = profile ? await deps.store.saveProfile(profile, slug, now) : null;
  const newFormat = saved?.newFormat ?? false;
  const cost = costOf(result.usage);
  const counts = await deps.store.recordAiCall(
    slug,
    { newFormat, verified, learned: saved != null, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cost },
    now,
  );
  deps.log({
    route: "parse",
    customer: slug,
    outcome: "read",
    verified,
    learned: saved != null,
    newFormat,
    lines: invoice.lines.length,
    unconfirmed: invoice.lines.filter((l) => l.ocrUncertain).length,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    ms: Date.now() - started,
  });

  // Alerts never fail the request.
  await afterAiCall(deps.alerts.sink, deps.alerts.config, { slug, ...counts, month: month(now) }).catch(() => {});
  if (newFormat && profile) {
    await newFormatLearned(deps.alerts.sink, deps.alerts.config, { slug, supplierName: profile.name, vatId: profile.vatId, verified }).catch(
      () => {},
    );
  }
  return { status: 200, body: { invoice, verified, learned: saved != null, newFormat } };
}
