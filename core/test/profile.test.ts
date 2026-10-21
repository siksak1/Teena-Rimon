import { describe, expect, it } from "vitest";
import type { SupplierInvoice } from "../src/model.js";
import { genericTableParser, parseWithProfile } from "../src/parsers/generic.js";
import { readProfile, vatCandidates, type SupplierProfile } from "../src/parsers/profile.js";
import { SUPPLIER_PARSERS } from "../src/parsers/registry.js";
import type { TextSupplierParser } from "../src/parsers/types.js";
import { loadPdf } from "../src/pdf/layout.js";
import { PAIRS, readSample } from "./helpers.js";

/**
 * Learned layouts (`profile.ts`), written by hand the way the AI writes them:
 * labels as printed, no invoice data. Read with its profile, each invoice must
 * come out exactly as its dedicated parser reads it (Gilboa has none: as the
 * generic parser reads it).
 */
const base = { version: 1, createdAt: "2026-10-20T00:00:00Z", source: "pdf" as const };

const PROFILES: Record<string, SupplierProfile> = {
  granot: {
    ...base,
    vatId: "570063362",
    name: "חקלאי גרנות",
    headers: {
      תאריך: "date",
      תעודה: "doc",
      "תעודה מפנקס": "bookRef",
      "תאור מוצר": "description",
      זן: "variety",
      משטח: "pallet",
      "מס. אריזות": "packages",
      כמות: "quantity",
      "מחיר ליחידה": "unitPrice",
      הנחה: "discount",
      "מחיר ליח' אחרי הנחה": "netPrice",
      'סה"כ מחיר': "total",
    },
    amountColumns: { quantity: "כמות", unitPrice: "מחיר ליחידה", total: 'סה"כ מחיר', discount: "הנחה" },
    totalLabel: 'סכום פטור ממע"מ',
    invoiceNumberLabel: "חשבונית מס מרכזת",
    dateLabel: "תאריך חשבונית",
    discountSource: "row",
  },
  galil: {
    ...base,
    vatId: "570056218",
    name: "גליל שוק מקומי",
    headers: {
      תאריך: "date",
      תעודה: "doc",
      'מק"ט': "sku",
      "תאור מוצר": "description",
      כמות: "quantity",
      "מחיר ליחידה": "unitPrice",
      "מחיר ליח' אחרי הנחה": "netPrice",
      'סה"כ מחיר': "total",
    },
    amountColumns: { quantity: "כמות", unitPrice: "מחיר ליחידה", total: 'סה"כ מחיר' },
    totalLabel: 'סכום פטור ממע"מ',
    invoiceNumberLabel: "חשבונית מס מרכזת",
    dateLabel: "תאריך חשבונית",
    discountSource: "netPriceColumn",
  },
  gilboa: {
    ...base,
    vatId: "570046193",
    name: "גזר בגלבוע",
    headers: {
      תאריך: "date",
      "מספר פנקס": "bookRef",
      'מק"ט': "sku",
      "תאור מוצר": "description",
      כמות: "quantity",
      "מחיר ליחידה": "unitPrice",
      'סה"כ מחיר': "total",
    },
    amountColumns: { quantity: "כמות", unitPrice: "מחיר ליחידה", total: 'סה"כ מחיר' },
    totalLabel: 'סכום פטור ממע"מ',
    invoiceNumberLabel: "חשבונית מס מרכזת",
    dateLabel: "תאריך חשבונית",
    discountSource: "none",
  },
};

/** The reading every profile must reproduce. */
async function expected(name: string): Promise<SupplierInvoice> {
  const doc = await loadPdf(await readSample(PAIRS[name].supplier));
  const dedicated = SUPPLIER_PARSERS.find((p): p is TextSupplierParser => !p.scanned && p.detect(doc));
  return (dedicated ?? genericTableParser).parse(doc);
}

describe("a learned profile reads its supplier's invoice like a dedicated parser", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    it(name, async () => {
      expect(readProfile(profile), "valid profile").not.toBeNull();
      const doc = await loadPdf(await readSample(PAIRS[name].supplier));
      const want = await expected(name);
      const got = parseWithProfile(doc, profile);

      expect(got.generic).toBe("profile");
      expect(got.vatId).toBe(profile.vatId);
      expect(got.invoiceNumber).toBe(want.invoiceNumber);
      expect(got.invoiceDate).toBe(want.invoiceDate);
      expect(got.printedItemsTotal).toBeCloseTo(want.printedItemsTotal!, 1);
      expect(got.lines.length, "line count").toBe(want.lines.length);
      got.lines.forEach((a, i) => {
        const e = want.lines[i];
        const at = `${name} ${e.id} ${e.description}`;
        expect(a.discountPct, `${at}: discount`).toBeCloseTo(e.discountPct, 2);
        expect(a.lineTotal, `${at}: total`).toBeCloseTo(e.lineTotal, 2);
        expect(a.unit === "יח'", `${at}: unit`).toBe(e.unit === "יח'");
        const same = { discountPct: 0, lineTotal: 0, unit: "" };
        expect({ ...a, ...same }, at).toEqual({ ...e, ...same });
      });
    });
  }
});

describe("a profile refuses rather than guesses", () => {
  it("refuses another supplier's invoice (its VAT number is not printed there)", async () => {
    const doc = await loadPdf(await readSample(PAIRS.galil.supplier));
    expect(() => parseWithProfile(doc, PROFILES.granot)).toThrow(/570063362/);
  });

  it("refuses when the supplier changed its layout (the learned headers are gone)", async () => {
    const doc = await loadPdf(await readSample(PAIRS.granot.supplier));
    const moved = { ...PROFILES.granot, amountColumns: { quantity: "משקל נטו", unitPrice: "מחיר לק\"ג", total: "סכום שורה" } };
    expect(() => parseWithProfile(doc, moved)).toThrow();
  });

  it("refuses when the learned total label prints no matching total", async () => {
    const doc = await loadPdf(await readSample(PAIRS.granot.supplier));
    expect(() => parseWithProfile(doc, { ...PROFILES.granot, totalLabel: 'סכום חייב במע"מ' })).toThrow(/אינו מתאים/);
  });

  it("rejects malformed profiles", () => {
    expect(readProfile({ ...PROFILES.granot, vatId: "12" })).toBeNull();
    expect(readProfile({ ...PROFILES.granot, skipRows: ["(unclosed"] })).toBeNull();
    expect(readProfile({ ...PROFILES.granot, extra: 1 })).toBeNull();
  });
});

describe("VAT candidates", () => {
  it("finds the supplier's VAT number in its invoice", async () => {
    const doc = await loadPdf(await readSample(PAIRS.gilboa.supplier));
    expect(vatCandidates(doc.text)).toContain("570046193");
  });
});
