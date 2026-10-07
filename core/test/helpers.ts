import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extractInvoices } from "../src/extract.js";
import type { ExtractionResult } from "../src/model.js";

const SAMPLES = fileURLToPath(new URL("../../sample_data/", import.meta.url));

export const PAIRS = {
  granot: { tr: "גרנות אצל תאנה ורימון.pdf", supplier: "גרנות 17.09.pdf" },
  shivuk: { tr: "שיווק החוף אצל תאנה ורימון.pdf", supplier: "שיווק החוף.pdf" },
} as const;

export async function extractSample(pair: keyof typeof PAIRS): Promise<ExtractionResult> {
  const { tr, supplier } = PAIRS[pair];
  return extractInvoices({
    trPdf: new Uint8Array(await readFile(SAMPLES + tr)),
    supplierPdf: new Uint8Array(await readFile(SAMPLES + supplier)),
    trFileName: tr,
    supplierFileName: supplier,
    parseMode: "server",
  });
}

export async function readSample(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(SAMPLES + name));
}
