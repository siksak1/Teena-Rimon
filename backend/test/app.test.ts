import { beforeEach, describe, expect, it } from "vitest";
import { granotParser } from "../../core/src/parsers/granot.js";
import { loadPdf } from "../../core/src/pdf/layout.js";
import { rowsPayload, type RowsPayload } from "../../core/src/remote.js";
import { readingFrom } from "../../core/test/aiReadings.js";
import { PAIRS, readSample } from "../../core/test/helpers.js";
import { AiUnreadable, type AiResult } from "../src/ai.js";
import { afterAiCall, ConsoleSink, parseThresholds } from "../src/alerts.js";
import { handle, type Deps, type Request } from "../src/app.js";
import { MemoryStore } from "../src/store.js";

/**
 * The backend's request handling with a fake AI (the reading Granot's
 * dedicated parser makes) and an in-memory store: tokens, the daily cap,
 * learning a layout, and the alert e-mails.
 */
const TOKEN = "teena-rimon-abcdefgh12345678";
let rows: RowsPayload;
let perfect: AiResult;

beforeEach(async () => {
  const doc = await loadPdf(await readSample(PAIRS.granot.supplier));
  rows = rowsPayload(doc);
  perfect = { reading: readingFrom(granotParser.parse(doc)), usage: { inputTokens: 20_000, outputTokens: 6_000 } };
});

function setup(overrides: Partial<Deps> = {}) {
  const sink = new ConsoleSink();
  const store = new MemoryStore();
  const logs: Record<string, unknown>[] = [];
  let aiCalls = 0;
  const deps: Deps = {
    customerOf: async (t) => (t === TOKEN ? "teena-rimon" : null),
    store,
    readInvoice: async () => {
      aiCalls++;
      return structuredClone(perfect);
    },
    alerts: { sink, config: { thresholds: [2, 3], newFormats: true } },
    dailyLimit: 5,
    now: () => new Date("2026-10-20T10:00:00Z"),
    log: (e) => logs.push(e),
    ...overrides,
  };
  return { deps, sink, store, logs, aiCallCount: () => aiCalls };
}

const parseRequest = (token = TOKEN): Request => ({
  method: "POST",
  path: "/parse",
  query: {},
  headers: { "x-customer-token": token },
  body: JSON.stringify({ pdf: "JVBERi0".padEnd(200, "A"), fileName: "granot.pdf", scanned: false, rows, vatHint: "570063362" }),
});
const profilesRequest = (vat: string): Request => ({
  method: "GET",
  path: "/profiles",
  query: { vat },
  headers: { "x-customer-token": TOKEN },
  body: null,
});

describe("POST /parse", () => {
  it("reads the invoice, learns the supplier's layout and e-mails that a new format was learned", async () => {
    const { deps, sink, store } = setup();
    const res = await handle(parseRequest(), deps);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ verified: true, learned: true, newFormat: true, invoice: { generic: "ai", vatId: "570063362" } });
    expect(store.data.profiles["570063362"]).toMatchObject({ firstCustomer: "teena-rimon", profile: { version: 1 } });
    expect(sink.sent.map((s) => s.subject)).toEqual(["LedgerMatch: new supplier format — חקלאי גרנות"]);
  });

  it("learns the layout again (version 2) without calling it a new format", async () => {
    const { deps, store } = setup();
    await handle(parseRequest(), deps);
    const res = await handle(parseRequest(), deps);
    expect(res.body).toMatchObject({ learned: true, newFormat: false });
    expect(store.data.profiles["570063362"].profile.version).toBe(2);
  });

  it("returns an unverified reading without learning anything from it", async () => {
    const wrong = () => {
      const r = structuredClone(perfect);
      r.reading.lines[0].quantity += 1;
      return r;
    };
    const { deps, store } = setup({ readInvoice: async () => wrong() });
    const res = await handle(parseRequest(), deps);
    expect(res.body).toMatchObject({ verified: false, learned: false, newFormat: false });
    expect(store.data.profiles).toEqual({});
  });

  it("refuses unknown tokens without reading anything", async () => {
    const { deps, aiCallCount } = setup();
    expect((await handle(parseRequest("someone-else-12345678"), deps)).status).toBe(404);
    expect((await handle(parseRequest("x"), deps)).status).toBe(404);
    expect(aiCallCount()).toBe(0);
  });

  it("stops at the customer's daily cap", async () => {
    const { deps, aiCallCount } = setup({ dailyLimit: 2 });
    for (let i = 0; i < 2; i++) expect((await handle(parseRequest(), deps)).status).toBe(200);
    expect(await handle(parseRequest(), deps)).toEqual({ status: 429, body: { error: "AI_RATE_LIMITED" } });
    expect(aiCallCount()).toBe(2);
  });

  it("reports an AI that declined or answered nonsense, and an AI that is down, differently", async () => {
    const unreadable = setup({ readInvoice: async () => Promise.reject(new AiUnreadable("declined")) });
    expect(await handle(parseRequest(), unreadable.deps)).toEqual({ status: 422, body: { error: "AI_UNREADABLE" } });
    const down = setup({ readInvoice: async () => Promise.reject(new Error("ECONNRESET")) });
    expect(await handle(parseRequest(), down.deps)).toEqual({ status: 502, body: { error: "AI_UNAVAILABLE" } });
  });

  it("rejects a malformed request", async () => {
    const { deps } = setup();
    expect((await handle({ ...parseRequest(), body: "{}" }, deps)).status).toBe(400);
    expect((await handle({ ...parseRequest(), body: "not json" }, deps)).status).toBe(400);
  });

  it("logs counts only: no invoice text, file name or token", async () => {
    const { deps, logs } = setup();
    await handle(parseRequest(), deps);
    const logged = JSON.stringify(logs);
    for (const secret of [TOKEN, "granot.pdf", "570063362", "פיטאיה", "SI26602203"]) expect(logged).not.toContain(secret);
  });
});

describe("GET /profiles", () => {
  it("returns the learned layout by VAT number, and nothing for unknown ones", async () => {
    const { deps } = setup();
    expect((await handle(profilesRequest("570063362,515175354"), deps)).body).toEqual({ profiles: [] });
    await handle(parseRequest(), deps);
    const res = await handle(profilesRequest("570063362,515175354,bad"), deps);
    expect(res.body).toMatchObject({ profiles: [{ vatId: "570063362", version: 1 }] });
  });
});

describe("alert thresholds", () => {
  it("sends one e-mail when the month's AI calls reach each threshold", async () => {
    const { deps, sink } = setup({ alerts: { sink: new ConsoleSink(), config: { thresholds: [2, 3], newFormats: false } } });
    const alerts = deps.alerts.sink as ConsoleSink;
    for (let i = 0; i < 4; i++) await handle(parseRequest(), deps);
    expect(alerts.sent.map((s) => s.subject)).toEqual([
      "LedgerMatch: 2 AI extractions in 2026-10",
      "LedgerMatch: 3 AI extractions in 2026-10",
    ]);
    expect(alerts.sent[0].message).toContain("Estimated AI cost this month: $0.");
    expect(sink.sent).toHaveLength(0);
  });

  it("fires at exactly the threshold: 24 → 25 sends, 26 does not", async () => {
    const sink = new ConsoleSink();
    const config = { thresholds: [25, 50], newFormats: false };
    const call = (allMonth: number) => afterAiCall(sink, config, { slug: "teena-rimon", allMonth, customerMonth: 1, allMonthCost: 1, month: "2026-10" });
    expect(await call(24)).toBe(false);
    expect(await call(25)).toBe(true);
    expect(await call(26)).toBe(false);
    expect(sink.sent).toHaveLength(1);
  });

  it("reads thresholds from the stack's setting", () => {
    expect(parseThresholds("100, 25,50,x,-3")).toEqual([25, 50, 100]);
    expect(parseThresholds(undefined)).toEqual([]);
  });
});
