import { describe, expect, it } from "vitest";
import { browserFamily, completedEvent, failedEvent, posthogBody, type AnalyticsContext } from "../src/analytics.js";
import { ExtractionError } from "../src/errors.js";
import { reconcile } from "../src/reconcile/reconcile.js";
import { extractSample, PAIRS, TEENA_RIMON } from "./helpers.js";

const ctx: AnalyticsContext = { config: TEENA_RIMON, appVersion: "1.0.0+abc1234", browser: "chrome-129" };

/** The complete list of what may be sent. Adding a property means changing this test (and the privacy statement). */
const COMPLETED_KEYS = [
  "customer", "app_version", "config_version", "browser",
  "supplier_lines", "own_lines", "matched_groups", "discrepancy_count",
  "unmatched_supplier", "unmatched_own", "discrepancy_amount_nis",
  "offset_applied", "parser_warnings", "parse_ms", "reconcile_ms",
  "$process_person_profile",
].sort();
const FAILED_KEYS = ["customer", "app_version", "config_version", "browser", "error_code", "$process_person_profile"].sort();
/** The only strings allowed in a payload. */
const ALLOWED_STRINGS = new Set(["phc_test", "reconciliation_completed", "reconciliation_failed", "teena-rimon", "1.0.0+abc1234", "chrome-129"]);

describe("analytics payloads", () => {
  for (const pair of Object.keys(PAIRS).filter((p) => p !== "harKor")) {
    it(`${pair}: sends only whitelisted counts`, async () => {
      const extraction = await extractSample(pair);
      const result = reconcile(extraction, TEENA_RIMON);
      const body = posthogBody(
        "phc_test",
        completedEvent(ctx, result, { supplier: extraction.supplier.lines.length, own: extraction.own.lines.length }, { parseMs: 812.4, reconcileMs: 40.6 }),
      );

      expect(Object.keys(body).sort()).toEqual(["api_key", "distinct_id", "event", "properties"]);
      expect(Object.keys(body.properties).sort()).toEqual(COMPLETED_KEYS);
      for (const value of Object.values(body.properties)) {
        expect(["number", "boolean"].includes(typeof value) || ALLOWED_STRINGS.has(value as string)).toBe(true);
      }
      expect(body.distinct_id).toBe("teena-rimon");
      expect((body.properties as { discrepancy_amount_nis: number }).discrepancy_amount_nis % 10).toBe(0);

      // Nothing read from the invoices appears anywhere in the body.
      const json = JSON.stringify(body);
      const fromInvoices = [
        extraction.supplier.supplierName,
        extraction.supplier.invoiceNumber,
        extraction.own.documentNumber,
        extraction.meta.ownFileName,
        extraction.meta.supplierFileName,
        ...extraction.supplier.lines.map((l) => l.description),
      ].filter((s) => s.length >= 3);
      for (const text of fromInvoices) expect(json).not.toContain(text);
    });
  }

  it("leaves the amount out when the customer has not opted in", async () => {
    const extraction = await extractSample("shivuk");
    const config = { ...TEENA_RIMON, analytics: { sendDiscrepancyAmount: false } };
    const e = completedEvent({ ...ctx, config }, reconcile(extraction, config), { supplier: 1, own: 1 }, { parseMs: 1, reconcileMs: 1 });
    expect(e.properties).not.toHaveProperty("discrepancy_amount_nis");
  });

  it("rounds the amount to ₪10", async () => {
    const extraction = await extractSample("shivuk"); // net gap −814.25
    const e = completedEvent(ctx, reconcile(extraction, TEENA_RIMON), { supplier: 1, own: 1 }, { parseMs: 1, reconcileMs: 1 });
    expect(e.properties).toMatchObject({ discrepancy_amount_nis: 810 });
  });

  it("reports a failure by code only, never the message (which holds file names)", async () => {
    const err = await extractSample("harKor").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    const body = posthogBody("phc_test", failedEvent(ctx, (err as ExtractionError).code));
    expect(Object.keys(body.properties).sort()).toEqual(FAILED_KEYS);
    expect(body.properties).toMatchObject({ error_code: "UNSUPPORTED_SUPPLIER" });
    expect(JSON.stringify(body)).not.toContain("הר");
  });
});

describe("browserFamily", () => {
  it("keeps only the family and major version", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.90 Safari/537.36";
    expect(browserFamily(chrome)).toBe("chrome-129");
    expect(browserFamily(`${chrome} Edg/129.0.2792.79`)).toBe("edge-129");
    expect(browserFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("firefox-131");
    expect(browserFamily("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("safari-18");
    expect(browserFamily("curl/8.0")).toBe("other");
  });
});
