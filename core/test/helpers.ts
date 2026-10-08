import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extractInvoices } from "../src/extract.js";
import type { ExtractionResult } from "../src/model.js";

const SAMPLES = fileURLToPath(new URL("../../sample_data/", import.meta.url));

export const PAIRS = {
  granot: { tr: "גרנות אצל תאנה ורימון.pdf", supplier: "גרנות 17.09.pdf" },
  shivuk: { tr: "שיווק החוף אצל תאנה ורימון.pdf", supplier: "שיווק החוף.pdf" },
  dhai: { tr: "ד. חי אצל תאנה ורימון.pdf", supplier: "ד. חי תוצרת חקלאית.pdf" },
  menashri: { tr: "אחים מנשרי אצל תאנה ורימון.pdf", supplier: "אחים מנשרי.pdf" },
  haklaim: { tr: "החקלאים אצל תאנה ורימון.pdf", supplier: "החקלאים.pdf" },
  galil: { tr: "גליל שוק מקומי אצל תאנה ורימון.pdf", supplier: "גליל שוק מקומי.pdf" },
  hasor: { tr: "שיווק העשור אצל תאנה ורימון.pdf", supplier: "שיווק העשור.pdf" },
  carmel: { tr: "בננות כרמל אצל תאנה ורימון.pdf", supplier: "בננות כרמל.pdf" },
  harKor: { tr: "הר הקור אצל תאנה ורימון.pdf", supplier: "הר-קור.pdf" },
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
