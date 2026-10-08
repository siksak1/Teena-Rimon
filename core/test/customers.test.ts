import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCustomerConfig } from "../src/customer.js";
import { extractInvoices } from "../src/extract.js";
import { OWN_DOCUMENT_PARSERS, supplierParsersFor } from "../src/parsers/registry.js";
import { PAIRS, readSample, TEENA_RIMON } from "./helpers.js";

const CUSTOMERS = new URL("../../customers/", import.meta.url);
const slugs = readdirSync(CUSTOMERS, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe("customer configs", () => {
  it("finds at least one customer", () => {
    expect(slugs).toContain("teena-rimon");
  });

  for (const slug of slugs) {
    it(`${slug}: is valid and only references formats that exist`, () => {
      const file = `customers/${slug}/config.json`;
      const config = parseCustomerConfig(JSON.parse(readFileSync(new URL(`${slug}/config.json`, CUSTOMERS), "utf8")), file);
      expect(config.slug).toBe(slug);
      expect(Object.keys(OWN_DOCUMENT_PARSERS)).toContain(config.ownDocument.format);
      expect(() => supplierParsersFor(config)).not.toThrow();
      expect(new Set(config.suppliers).size).toBe(config.suppliers.length);
    });
  }

  it("rejects misspelt keys and out-of-range values", () => {
    expect(() => parseCustomerConfig({ ...TEENA_RIMON, ofsetting: "off" }, "x")).toThrow(/ofsetting/);
    expect(() =>
      parseCustomerConfig({ ...TEENA_RIMON, tolerances: { ...TEENA_RIMON.tolerances, maxGroupSize: 0 } }, "x"),
    ).toThrow(/maxGroupSize/);
    expect(() => parseCustomerConfig({ ...TEENA_RIMON, referenceRules: ["pnkas"] }, "x")).toThrow(/referenceRules/);
  });

  it("rejects a supplier id that has no parser", () => {
    expect(() => supplierParsersFor({ ...TEENA_RIMON, suppliers: ["granot", "nope"] })).toThrow('"nope"');
  });

  it("treats a supplier the customer has not enabled as unsupported", async () => {
    const promise = extractInvoices(
      {
        ownPdf: await readSample(PAIRS.granot.own),
        supplierPdf: await readSample(PAIRS.granot.supplier),
        ownFileName: "a.pdf",
        supplierFileName: "b.pdf",
      },
      { ...TEENA_RIMON, suppliers: ["shivuk-hahof"] },
    );
    await expect(promise).rejects.toThrow("אינו נתמך עדיין. ספקים נתמכים: שיווק החוף");
  });
});
