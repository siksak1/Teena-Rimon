import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseCustomerConfig } from "../src/customer.js";
import { extractInvoices } from "../src/extract.js";
import type { ExtractionResult } from "../src/model.js";

const SAMPLES = fileURLToPath(new URL("../../sample_data/", import.meta.url));

/** The sample invoices are Teena-Rimon's, so the tests run under its config. */
export const TEENA_RIMON = parseCustomerConfig(
  JSON.parse(readFileSync(new URL("../../customers/teena-rimon/config.json", import.meta.url), "utf8")),
  "customers/teena-rimon/config.json",
);

export const PAIRS = {
  granot: { own: "גרנות אצל תאנה ורימון.pdf", supplier: "גרנות 17.09.pdf" },
  shivuk: { own: "שיווק החוף אצל תאנה ורימון.pdf", supplier: "שיווק החוף.pdf" },
  dhai: { own: "ד. חי אצל תאנה ורימון.pdf", supplier: "ד. חי תוצרת חקלאית.pdf" },
  menashri: { own: "אחים מנשרי אצל תאנה ורימון.pdf", supplier: "אחים מנשרי.pdf" },
  haklaim: { own: "החקלאים אצל תאנה ורימון.pdf", supplier: "החקלאים.pdf" },
  galil: { own: "גליל שוק מקומי אצל תאנה ורימון.pdf", supplier: "גליל שוק מקומי.pdf" },
  hasor: { own: "שיווק העשור אצל תאנה ורימון.pdf", supplier: "שיווק העשור.pdf" },
  carmel: { own: "בננות כרמל אצל תאנה ורימון.pdf", supplier: "בננות כרמל.pdf" },
  harKor: { own: "הר הקור אצל תאנה ורימון.pdf", supplier: "הר-קור.pdf" },
} as const;

export async function extractSample(pair: keyof typeof PAIRS): Promise<ExtractionResult> {
  const { own, supplier } = PAIRS[pair];
  return extractInvoices(
    {
      ownPdf: new Uint8Array(await readFile(SAMPLES + own)),
      supplierPdf: new Uint8Array(await readFile(SAMPLES + supplier)),
      ownFileName: own,
      supplierFileName: supplier,
    },
    TEENA_RIMON,
  );
}

export async function readSample(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(SAMPLES + name));
}
