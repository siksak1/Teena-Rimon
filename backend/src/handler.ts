import { CloudFrontKeyValueStoreClient, GetKeyCommand } from "@aws-sdk/client-cloudfront-keyvaluestore";
import { SignatureV4a } from "@aws-sdk/signature-v4a";
import { signatureV4aContainer } from "@smithy/signature-v4";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import Anthropic from "@anthropic-ai/sdk";
import type { LambdaFunctionURLEvent, LambdaFunctionURLResult } from "aws-lambda";
import { readInvoice } from "./ai.js";
import { parseThresholds, SnsSink } from "./alerts.js";
import { handle, type Deps } from "./app.js";
import { DynamoStore } from "./store.js";

/**
 * Lambda behind a Function URL, which the page reaches through the site's own
 * /api/ (CloudFront; up to 60 seconds) or, for older builds, directly.
 * Configuration comes from the stack (infra/lib/ledgermatch-stack.ts):
 *
 *   TABLE, KVS_ARN, ALERT_TOPIC_ARN, API_KEY_PARAMETER,
 *   AI_ALERT_THRESHOLDS ("25,50,100"), ALERT_NEW_FORMATS ("1"), AI_DAILY_LIMIT, AI_EFFORT
 */
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

// The KeyValueStore API signs with SigV4A: the pure-JavaScript signer, so the bundle needs no native module.
signatureV4aContainer.SignatureV4a = SignatureV4a;
const kvs = new CloudFrontKeyValueStoreClient({});
const tokens = new Map<string, { slug: string | null; at: number }>();
/** A revoked token stops working within this long on a warm Lambda. */
const TOKEN_CACHE_MS = 60_000;

async function customerOf(token: string): Promise<string | null> {
  const cached = tokens.get(token);
  if (cached && Date.now() - cached.at < TOKEN_CACHE_MS) return cached.slug;
  let slug: string | null = null;
  try {
    const out = await kvs.send(new GetKeyCommand({ KvsARN: env("KVS_ARN"), Key: token }));
    slug = JSON.parse(out.Value ?? "null")?.slug ?? null;
  } catch {
    slug = null; // no such token
  }
  tokens.set(token, { slug, at: Date.now() });
  return slug;
}

let client: Promise<Anthropic> | null = null;
function anthropic(): Promise<Anthropic> {
  client ??= new SSMClient({})
    .send(new GetParameterCommand({ Name: env("API_KEY_PARAMETER"), WithDecryption: true }))
    .then((out) => new Anthropic({ apiKey: out.Parameter!.Value!, timeout: 280_000, maxRetries: 1 }));
  return client;
}

const deps: Deps = {
  customerOf,
  store: new DynamoStore(env("TABLE")),
  readInvoice: async (input) =>
    readInvoice(await anthropic(), input, { effort: (process.env.AI_EFFORT as "low" | "medium" | "high") || "low" }),
  alerts: {
    sink: new SnsSink(env("ALERT_TOPIC_ARN")),
    config: { thresholds: parseThresholds(process.env.AI_ALERT_THRESHOLDS), newFormats: process.env.ALERT_NEW_FORMATS === "1" },
  },
  dailyLimit: Number(process.env.AI_DAILY_LIMIT || 30),
  now: () => new Date(),
  log: (event) => console.log(JSON.stringify(event)),
};

export async function handler(event: LambdaFunctionURLEvent): Promise<LambdaFunctionURLResult> {
  const body = event.body == null ? null : event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  const response = await handle(
    {
      method: event.requestContext.http.method,
      // "/api/parse" through CloudFront, "/parse" from builds that call the Function URL directly.
      path: event.rawPath.replace(/^\/api(?=\/)/, ""),
      query: event.queryStringParameters ?? {},
      headers: event.headers ?? {},
      body,
    },
    deps,
  ).catch((err) => {
    console.log(JSON.stringify({ outcome: "internal_error", error: String((err as Error)?.name ?? "Error") }));
    return { status: 500, body: { error: "INTERNAL" } };
  });
  return {
    statusCode: response.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(response.body),
  };
}
