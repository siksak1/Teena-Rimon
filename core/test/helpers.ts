import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type CustomerConfig, parseCustomerConfig } from "../src/customer.js";
import { extractInvoices } from "../src/extract.js";
import type { ExtractionResult } from "../src/model.js";

const REPO = new URL("../../", import.meta.url);

/** One sample pair: paths relative to the repo root. */
export type FixtureCase = { own: string; supplier: string };

/** Every folder under `customers/`. */
export function customerSlugs(): string[] {
  return readdirSync(new URL("customers/", REPO), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

export function loadCustomer(slug: string): CustomerConfig {
  const file = `customers/${slug}/config.json`;
  return parseCustomerConfig(JSON.parse(readFileSync(new URL(file, REPO), "utf8")), file);
}

/** `customers/<slug>/fixtures/cases.json`, or null when the customer has no fixtures yet. */
export function fixtureCases(slug: string): Record<string, FixtureCase> | null {
  const file = new URL(`customers/${slug}/fixtures/cases.json`, REPO);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** The sample invoices are Teena-Rimon's, so most tests run under its config. */
export const TEENA_RIMON = loadCustomer("teena-rimon");
export const PAIRS = fixtureCases("teena-rimon")!;

export async function extractCase(pair: FixtureCase, config: CustomerConfig): Promise<ExtractionResult> {
  return extractInvoices(
    {
      ownPdf: await readSample(pair.own),
      supplierPdf: await readSample(pair.supplier),
      ownFileName: pair.own,
      supplierFileName: pair.supplier,
    },
    config,
  );
}

export async function extractSample(pair: string): Promise<ExtractionResult> {
  return extractCase(PAIRS[pair], TEENA_RIMON);
}

/** Read a file by its path relative to the repo root. */
export async function readSample(path: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(path, REPO)));
}
