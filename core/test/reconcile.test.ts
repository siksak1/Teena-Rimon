import { describe, expect, it } from "vitest";
import { normalizeRef } from "../src/reconcile/references.js";
import type { ExtractionResult, MatchGroup, OwnLine, SupplierLine } from "../src/model.js";
import { reconcile } from "../src/reconcile/reconcile.js";
import { extractSample, TEENA_RIMON } from "./helpers.js";

const ids = (g: MatchGroup) => `${g.supplierLines.map((l) => l.id).join("+")}→${g.ownLines.map((l) => l.id).join("+")}`;
const find = (groups: MatchGroup[], supplierId: string) =>
  groups.find((g) => g.supplierLines.some((l) => l.id === supplierId))!;

describe("reconcile — Granot", async () => {
  const result = reconcile(await extractSample("granot"), TEENA_RIMON);

  it("matches 25 groups, including the 4:1 pitaya group", () => {
    expect(result.groups).toHaveLength(25);
    expect(ids(find(result.groups, "S1"))).toBe("S1+S2+S3+S4→T1");
    expect(ids(find(result.groups, "S13"))).toBe("S13→T13");
    expect(ids(find(result.groups, "S14"))).toBe("S14→T14");
  });

  it("reports the missing mango row and nothing on the Teena-Rimon side", () => {
    expect(result.supplierOnly.map((l) => [l.id, l.quantity, l.lineTotal])).toEqual([["S29", 848, 2611.84]]);
    expect(result.ownOnly).toEqual([]);
  });

  it("explains the whole invoice gap", () => {
    expect(result.totals).toMatchObject({ supplierNet: 77379.76, ownNet: 74521.99, diff: -2857.77 });
    const lineGaps = result.groups.reduce((a, g) => a + g.netDiff, 0);
    expect(Math.round((lineGaps - 2611.84) * 100) / 100).toBe(-2857.77);
    expect(result.offset.applies).toBe(false);
  });

  it("flags a different reference, a cultivar conflict and package gaps", () => {
    expect(find(result.groups, "S9").flags).toEqual(expect.arrayContaining(["doc_ref", "quantity"]));
    expect(find(result.groups, "S22").flags).toEqual(["name"]);
    expect(find(result.groups, "S22").notes).toContain("זן: שלי ≠ מאיה");
    expect(find(result.groups, "S15").flags).toEqual(["packages"]);
    expect(find(result.groups, "S16").flags).toEqual(["quantity", "price"]);
  });
});

describe("reconcile — Shivuk HaHof", async () => {
  const result = reconcile(await extractSample("shivuk"), TEENA_RIMON);

  it("matches every row, with 1:2 and 1:3 groups", () => {
    expect(result.groups).toHaveLength(28);
    expect(result.supplierOnly).toEqual([]);
    expect(result.ownOnly).toEqual([]);
    expect(ids(find(result.groups, "S7"))).toBe("S7→T3+T10+T11");
    expect(ids(find(result.groups, "S8"))).toBe("S8→T8+T9");
    expect(ids(find(result.groups, "S10"))).toBe("S10→T7");
    expect(ids(find(result.groups, "S12"))).toBe("S12→T19+T20");
  });

  it("puts the entire gap on the line printed without discount", () => {
    expect(result.totals.diff).toBe(-814.25);
    const gaps = result.groups.filter((g) => g.netDiff !== 0);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].flags).toEqual(["discount"]);
    expect(gaps[0].netDiff).toBe(-814.25);
  });

  it("pairs document 912 with Teena-Rimon's 926 and flags it", () => {
    for (const id of ["S7", "S8", "S9", "S10", "S11"]) {
      expect(find(result.groups, id).flags).toContain("doc_ref");
    }
  });
});

describe("reconcile — offsetting", () => {
  const sLine = (id: string, quantity: number, unitPrice: number): SupplierLine => ({
    id, page: 1, date: "2026-09-01", docNumber: "SH1", bookRef: "100", description: id === "S1" ? "מנגו" : "אבוקדו",
    variety: "", sku: null, packages: 10, quantity, unit: "ק'ג", unitPrice, discountPct: 0, lineTotal: quantity * unitPrice,
  });
  const tLine = (id: string, product: string, quantity: number, unitPrice: number): OwnLine => ({
    id, page: 1, date: "2026-09-01", ownDocNumber: "1", supplierRef: "100", product, size: "", packageType: "קרטון",
    packages: 10, quantity, unitPrice, lineTotal: quantity * unitPrice,
  });
  const extraction: ExtractionResult = {
    supplier: { supplierId: "x", supplierName: "x", invoiceNumber: "1", invoiceDate: null, printedItemsTotal: null, warnings: [],
      lines: [sLine("S1", 100, 10), sLine("S2", 100, 5)] },
    own: { documentNumber: "1", againstInvoice: null, printedGrossTotal: null, commercialDiscount: 0, discountPct: 0, warnings: [],
      lines: [tLine("T1", "מנגו", 100, 9), tLine("T2", "אבוקדו", 100, 6)] },
    meta: { ownFileName: "a", supplierFileName: "b" },
  };

  it("moves price gaps that cancel out to the offset section", () => {
    const result = reconcile(extraction, TEENA_RIMON);
    expect(result.totals.diff).toBe(0);
    expect(result.offset.applies).toBe(true);
    expect(result.offset.groups.map((g) => g.netDiff).sort()).toEqual([-100, 100]);
  });

  it("keeps every gap in the main table when the customer turns offsetting off", () => {
    const result = reconcile(extraction, { ...TEENA_RIMON, offsetting: "off" });
    expect(result.totals.diff).toBe(0);
    expect(result.offset).toEqual({ applies: false, groups: [] });
  });

  it("names the customer in the gap notes", () => {
    const result = reconcile(extraction, { ...TEENA_RIMON, displayName: "לקוח לדוגמה" });
    expect(result.groups.flatMap((g) => g.notes)).toContain("מחיר: ספק 10, לקוח לדוגמה 9");
  });
});

describe("normalizeRef", () => {
  it("keeps the digits Teena-Rimon records for each supplier's document format", () => {
    expect(normalizeRef("SH2610231")).toBe("2610231");
    expect(normalizeRef("2SH2605495")).toBe("2605495");
    expect(normalizeRef("21/265134")).toBe("265134");
    expect(normalizeRef("4503")).toBe("4503");
  });
});

/** Group as "S1+S2→T1+T3", rows sorted by id (absorbed rows are appended). */
const sortedIds = (g: MatchGroup) => {
  const byNum = (l: { id: string }[]) => l.map((x) => x.id).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return `${byNum(g.supplierLines).join("+")}→${byNum(g.ownLines).join("+")}`;
};

describe("reconcile — names are a soft signal", () => {
  it("matches every row of suppliers whose products are missing from the dictionary", async () => {
    for (const pair of ["haklaim", "carmel", "hasor"] as const) {
      const r = reconcile(await extractSample(pair), TEENA_RIMON);
      expect([pair, r.supplierOnly, r.ownOnly]).toEqual([pair, [], []]);
    }
  });

  it("matches on doc and numbers alone and says so, without a gap flag", async () => {
    const r = reconcile(await extractSample("menashri"), TEENA_RIMON);
    const g = find(r.groups, "S31"); // "איקרם" (a tomato cultivar) ↔ "עגבניה אשכולות"
    expect(sortedIds(g)).toBe("S31→T25+T26");
    expect(g.flags).not.toContain("name");
    expect(g.notes.some((n) => n.startsWith("שם:"))).toBe(true);
    expect(r.supplierOnly).toEqual([]);
    expect(r.ownOnly).toEqual([]);
  });
});

describe("reconcile — pairing deliveries by content", () => {
  it("pairs Carmel's look-alike daily banana deliveries by the nearest date", async () => {
    // Carmel's delivery numbers never match Teena-Rimon's, and every day is ~1,000 kg of bananas.
    const r = reconcile(await extractSample("carmel"), TEENA_RIMON);
    expect(new Set(r.groups.map((g) => g.dateDelta))).toEqual(new Set([0, 1]));
  });
});

describe("reconcile — absorbing large splits", () => {
  it("collects a 12-row split that the exact search cannot reach", async () => {
    const r = reconcile(await extractSample("hasor"), TEENA_RIMON);
    const g = find(r.groups, "S11"); // watermelon 7,240 kg
    expect(g.ownLines).toHaveLength(12);
    expect(g.quantityDiff).toBe(0);
  });

  it("keeps Galil's market tiers and sizes apart and leaves truly extra rows unmatched", async () => {
    const r = reconcile(await extractSample("galil"), TEENA_RIMON);
    expect(sortedIds(find(r.groups, "S27"))).toBe("S27+S28+S29+S30+S31→T21"); // 5 × בינוני = 812 kg
    expect(sortedIds(find(r.groups, "S7"))).toBe("S7+S8+S9+S10+S11+S12+S13→T6"); // שוק מוסדי
    expect(r.ownOnly).toEqual([]);
    // Teena-Rimon has no row for these pomegranates.
    expect(r.supplierOnly.map((l) => l.id)).toEqual(["S32", "S33", "S71"]);
  });
});
