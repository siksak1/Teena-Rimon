import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { readInvoice } from "./ai.js";
import { ConsoleSink, parseThresholds } from "./alerts.js";
import { handle } from "./app.js";
import { MemoryStore } from "./store.js";

/**
 * The backend on this machine, for the app's dev server (`npm run dev` with
 * VITE_AI_ENDPOINT=http://localhost:43124): the same request handling, with
 * learned layouts and counters in backend/.dev-store.json and alerts printed
 * here. Any token is accepted as customer DEV_CUSTOMER (default "ai-test").
 * The AI is called for real: set ANTHROPIC_API_KEY (or `ant auth login`).
 *
 *   AI_ALERT_THRESHOLDS=2 npm run dev --prefix backend
 */
const PORT = Number(process.env.PORT || 43124);
const store = new MemoryStore(fileURLToPath(new URL("../.dev-store.json", import.meta.url)));
const sink = new ConsoleSink();
const anthropic = new Anthropic({ timeout: 280_000, maxRetries: 1 });

createServer(async (req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, x-customer-token");
  res.setHeader("access-control-allow-methods", "GET, POST");
  if (req.method === "OPTIONS") return void res.writeHead(204).end();
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const response = await handle(
    {
      method: req.method ?? "GET",
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: { "x-customer-token": String(req.headers["x-customer-token"] ?? "") },
      body: chunks.length ? Buffer.concat(chunks).toString("utf8") : null,
    },
    {
      customerOf: async () => process.env.DEV_CUSTOMER || "ai-test",
      store,
      readInvoice: (input) => readInvoice(anthropic, input, { effort: (process.env.AI_EFFORT as "low") || "low" }),
      alerts: { sink, config: { thresholds: parseThresholds(process.env.AI_ALERT_THRESHOLDS || "25,50,100"), newFormats: true } },
      dailyLimit: Number(process.env.AI_DAILY_LIMIT || 30),
      now: () => new Date(),
      log: (event) => console.log(JSON.stringify(event)),
    },
  ).catch((err) => {
    console.error(err);
    return { status: 500, body: { error: "INTERNAL" } };
  });
  res.writeHead(response.status, { "content-type": "application/json" }).end(JSON.stringify(response.body));
}).listen(PORT, () => console.log(`LedgerMatch backend (dev) on http://localhost:${PORT}`));
