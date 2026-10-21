import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  BatchGetItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  type AttributeValue,
} from "@aws-sdk/client-dynamodb";
import { readProfile, type SupplierProfile } from "../../core/src/parsers/profile.js";

/** What one AI call adds to the usage counters. */
export type AiCall = { newFormat: boolean; verified: boolean; learned: boolean; inputTokens: number; outputTokens: number; cost: number };

/** A learned layout with its bookkeeping. */
export type StoredProfile = {
  profile: SupplierProfile;
  firstCustomer: string;
  aiCalls: number;
  lookups: number;
  lastUsed: string;
};

/**
 * Learned supplier layouts and usage counters. One DynamoDB table, keyed by `pk`:
 *
 *   PROFILE#<vat>             the layout, its first customer, AI calls and lookups
 *   USAGE#<slug>#<yyyy-mm-dd> one customer's counters for a day (the daily cap)
 *   USAGE#<slug>#<yyyy-mm>    one customer's counters for a month
 *   USAGE#ALL#<yyyy-mm>       everyone's counters for a month (the alert thresholds)
 *
 * Counters: aiCalls, newFormats, unverified, learned, inputTokens, outputTokens, costMicros, profileLookups.
 * No invoice data is ever stored.
 */
export interface Store {
  profiles(vatIds: string[]): Promise<StoredProfile[]>;
  /** Save a newly learned layout; the version follows the one it replaces. Returns true for a supplier never seen before. */
  saveProfile(profile: SupplierProfile, slug: string, now: Date): Promise<{ newFormat: boolean; version: number }>;
  /** Count an AI call; returns the month's AI calls for everyone and for this customer, after this one. */
  recordAiCall(slug: string, call: AiCall, now: Date): Promise<{ allMonth: number; customerMonth: number; allMonthCost: number }>;
  /** Count a lookup that returned layouts. */
  recordLookup(slug: string, vatIds: string[], now: Date): Promise<void>;
  aiCallsToday(slug: string, now: Date): Promise<number>;
}

export const day = (now: Date) => now.toISOString().slice(0, 10);
export const month = (now: Date) => now.toISOString().slice(0, 7);

/* ------------------------------------------------------------------ */
/* DynamoDB                                                            */
/* ------------------------------------------------------------------ */

export class DynamoStore implements Store {
  constructor(
    private readonly table: string,
    private readonly db = new DynamoDBClient({}),
  ) {}

  async profiles(vatIds: string[]): Promise<StoredProfile[]> {
    if (vatIds.length === 0) return [];
    const out = await this.db.send(
      new BatchGetItemCommand({ RequestItems: { [this.table]: { Keys: vatIds.map((v) => ({ pk: { S: `PROFILE#${v}` } })) } } }),
    );
    return (out.Responses?.[this.table] ?? []).flatMap((item) => {
      const stored = fromItem(item);
      return stored ? [stored] : [];
    });
  }

  async saveProfile(profile: SupplierProfile, slug: string, now: Date) {
    const key = { pk: { S: `PROFILE#${profile.vatId}` } };
    const existing = await this.db.send(new GetItemCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    const previous = existing.Item ? fromItem(existing.Item) : null;
    const version = (previous?.profile.version ?? 0) + 1;
    await this.db.send(
      new PutItemCommand({
        TableName: this.table,
        Item: {
          ...key,
          profile: { S: JSON.stringify({ ...profile, version }) },
          firstCustomer: { S: previous?.firstCustomer ?? slug },
          aiCalls: { N: String((previous?.aiCalls ?? 0) + 1) },
          lookups: { N: String(previous?.lookups ?? 0) },
          lastUsed: { S: now.toISOString() },
        },
      }),
    );
    return { newFormat: previous == null, version };
  }

  async recordAiCall(slug: string, call: AiCall, now: Date) {
    const add = {
      aiCalls: 1,
      newFormats: call.newFormat ? 1 : 0,
      unverified: call.verified ? 0 : 1,
      learned: call.learned ? 1 : 0,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costMicros: Math.round(call.cost * 1_000_000),
    };
    await this.add(`USAGE#${slug}#${day(now)}`, add);
    const customer = await this.add(`USAGE#${slug}#${month(now)}`, add);
    const all = await this.add(`USAGE#ALL#${month(now)}`, add);
    return { allMonth: all.aiCalls, customerMonth: customer.aiCalls, allMonthCost: all.costMicros / 1_000_000 };
  }

  async recordLookup(slug: string, vatIds: string[], now: Date) {
    await this.add(`USAGE#${slug}#${day(now)}`, { profileLookups: 1 });
    for (const vat of vatIds) {
      await this.db.send(
        new UpdateItemCommand({
          TableName: this.table,
          Key: { pk: { S: `PROFILE#${vat}` } },
          UpdateExpression: "ADD lookups :one SET lastUsed = :now",
          ConditionExpression: "attribute_exists(pk)",
          ExpressionAttributeValues: { ":one": { N: "1" }, ":now": { S: now.toISOString() } },
        }),
      ).catch(() => {});
    }
  }

  async aiCallsToday(slug: string, now: Date) {
    const out = await this.db.send(
      new GetItemCommand({ TableName: this.table, Key: { pk: { S: `USAGE#${slug}#${day(now)}` } }, ConsistentRead: true }),
    );
    return Number(out.Item?.aiCalls?.N ?? 0);
  }

  /** Atomically add to counters; returns their new values. */
  private async add(pk: string, counters: Record<string, number>): Promise<Record<string, number>> {
    const names = Object.keys(counters);
    const out = await this.db.send(
      new UpdateItemCommand({
        TableName: this.table,
        Key: { pk: { S: pk } },
        UpdateExpression: `ADD ${names.map((n, i) => `#c${i} :v${i}`).join(", ")}`,
        ExpressionAttributeNames: Object.fromEntries(names.map((n, i) => [`#c${i}`, n])),
        ExpressionAttributeValues: Object.fromEntries(names.map((n, i) => [`:v${i}`, { N: String(counters[n]) }])),
        ReturnValues: "ALL_NEW",
      }),
    );
    return Object.fromEntries(Object.entries(out.Attributes ?? {}).flatMap(([k, v]) => (v.N ? [[k, Number(v.N)]] : [])));
  }
}

function fromItem(item: Record<string, AttributeValue>): StoredProfile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(item.profile?.S ?? "");
  } catch {
    return null;
  }
  const profile = readProfile(raw);
  if (!profile) return null;
  return {
    profile,
    firstCustomer: item.firstCustomer?.S ?? "",
    aiCalls: Number(item.aiCalls?.N ?? 0),
    lookups: Number(item.lookups?.N ?? 0),
    lastUsed: item.lastUsed?.S ?? "",
  };
}

/* ------------------------------------------------------------------ */
/* In memory / JSON file (tests and the local dev server)              */
/* ------------------------------------------------------------------ */

type MemoryData = { profiles: Record<string, StoredProfile>; counters: Record<string, Record<string, number>> };

export class MemoryStore implements Store {
  data: MemoryData;

  /** With `file`, the data is read from and saved to that JSON file (the dev server's). */
  constructor(private readonly file?: string) {
    this.data = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { profiles: {}, counters: {} };
  }

  async profiles(vatIds: string[]) {
    return vatIds.flatMap((v) => (this.data.profiles[v] ? [this.data.profiles[v]] : []));
  }

  async saveProfile(profile: SupplierProfile, slug: string, now: Date) {
    const previous = this.data.profiles[profile.vatId];
    const version = (previous?.profile.version ?? 0) + 1;
    this.data.profiles[profile.vatId] = {
      profile: { ...profile, version },
      firstCustomer: previous?.firstCustomer ?? slug,
      aiCalls: (previous?.aiCalls ?? 0) + 1,
      lookups: previous?.lookups ?? 0,
      lastUsed: now.toISOString(),
    };
    this.save();
    return { newFormat: previous == null, version };
  }

  async recordAiCall(slug: string, call: AiCall, now: Date) {
    const add = {
      aiCalls: 1,
      newFormats: call.newFormat ? 1 : 0,
      unverified: call.verified ? 0 : 1,
      learned: call.learned ? 1 : 0,
      inputTokens: call.inputTokens,
      outputTokens: call.outputTokens,
      costMicros: Math.round(call.cost * 1_000_000),
    };
    this.add(`USAGE#${slug}#${day(now)}`, add);
    const customer = this.add(`USAGE#${slug}#${month(now)}`, add);
    const all = this.add(`USAGE#ALL#${month(now)}`, add);
    this.save();
    return { allMonth: all.aiCalls, customerMonth: customer.aiCalls, allMonthCost: all.costMicros / 1_000_000 };
  }

  async recordLookup(slug: string, vatIds: string[], now: Date) {
    this.add(`USAGE#${slug}#${day(now)}`, { profileLookups: 1 });
    for (const v of vatIds) {
      const stored = this.data.profiles[v];
      if (stored) {
        stored.lookups++;
        stored.lastUsed = now.toISOString();
      }
    }
    this.save();
  }

  async aiCallsToday(slug: string, now: Date) {
    return this.data.counters[`USAGE#${slug}#${day(now)}`]?.aiCalls ?? 0;
  }

  private add(pk: string, counters: Record<string, number>) {
    const row = (this.data.counters[pk] ??= {});
    for (const [k, v] of Object.entries(counters)) row[k] = (row[k] ?? 0) + v;
    return row;
  }

  private save() {
    if (this.file) writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}
