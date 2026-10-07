import { describe, expect, it } from "vitest";
import type { ExtractionResult, MatchGroup, SupplierLine, TrLine } from "../src/model.js";
import { reconcile } from "../src/reconcile/reconcile.js";
import { extractSample } from "./helpers.js";

const ids = (g: MatchGroup) => `${g.supplierLines.map((l) => l.id).join("+")}→${g.trLines.map((l) => l.id).join("+")}`;
const find = (groups: MatchGroup[], supplierId: string) =>
  groups.find((g) => g.supplierLines.some((l) => l.id === supplierId))!;

describe("reconcile — Granot", async () => {
  const result = reconcile(await extractSample("granot"));

  it("matches 25 groups, including the 4:1 pitaya group", () => {
    expect(result.groups).toHaveLength(25);
    expect(ids(find(result.groups, "S1"))).toBe("S1+S2+S3+S4→T1");
    expect(ids(find(result.groups, "S13"))).toBe("S13→T13");
    expect(ids(find(result.groups, "S14"))).toBe("S14→T14");
  });

  it("reports the missing mango row and nothing on the Teena-Rimon side", () => {
    expect(result.supplierOnly.map((l) => [l.id, l.quantity, l.lineTotal])).toEqual([["S29", 848, 2611.84]]);
    expect(result.trOnly).toEqual([]);
  });

  it("explains the whole invoice gap", () => {
    expect(result.totals).toMatchObject({ supplierNet: 77379.76, trNet: 74521.99, diff: -2857.77 });
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
  const result = reconcile(await extractSample("shivuk"));

  it("matches every row, with 1:2 and 1:3 groups", () => {
    expect(result.groups).toHaveLength(28);
    expect(result.supplierOnly).toEqual([]);
    expect(result.trOnly).toEqual([]);
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
  const tLine = (id: string, product: string, quantity: number, unitPrice: number): TrLine => ({
    id, page: 1, date: "2026-09-01", trDocNumber: "1", supplierRef: "100", product, size: "", packageType: "קרטון",
    packages: 10, quantity, unitPrice, lineTotal: quantity * unitPrice,
  });
  const extraction: ExtractionResult = {
    supplier: { supplierId: "x", supplierName: "x", invoiceNumber: "1", invoiceDate: null, printedItemsTotal: null, warnings: [],
      lines: [sLine("S1", 100, 10), sLine("S2", 100, 5)] },
    teenaRimon: { draftNumber: "1", againstInvoice: null, printedGrossTotal: null, commercialDiscount: 0, discountPct: 0, warnings: [],
      lines: [tLine("T1", "מנגו", 100, 9), tLine("T2", "אבוקדו", 100, 6)] },
    meta: { parseMode: "server", trFileName: "a", supplierFileName: "b" },
  };

  it("moves price gaps that cancel out to the offset section", () => {
    const result = reconcile(extraction);
    expect(result.totals.diff).toBe(0);
    expect(result.offset.applies).toBe(true);
    expect(result.offset.groups.map((g) => g.netDiff).sort()).toEqual([-100, 100]);
  });
});
