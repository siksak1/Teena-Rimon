import { describe, expect, it } from "vitest";
import { ExtractionError } from "../src/errors.js";
import { extractExcel } from "../src/excel/extract.js";
import { detectExcel, growerSalesReport, missingHeaders, teenaRimonWeighings } from "../src/excel/formats.js";
import type { MatchGroup } from "../src/model.js";
import { nameSimilarity, pairGrowers } from "../src/reconcile/growers.js";
import { reconcile } from "../src/reconcile/reconcile.js";
import { extractSample, PAIRS, readSample, TEENA_RIMON } from "./helpers.js";

const ids = (g: MatchGroup) => `${g.supplierLines.map((l) => l.id).join("+")}→${g.ownLines.map((l) => l.id).join("+")}`;

describe("Excel reports — reading", async () => {
  const { supplier, own, meta } = await extractSample("excel");

  it("reads every row of both reports, money as weight × price", () => {
    expect(meta.format).toBe("excel");
    expect(supplier.lines).toHaveLength(50);
    expect(own.lines).toHaveLength(54);
    expect(supplier.warnings).toEqual([]);
    expect(own.warnings).toEqual([]);
    expect(supplier.lines[0]).toMatchObject({
      date: "2026-08-31",
      docNumber: "1697",
      grower: "יורם פורטל",
      description: "רימון",
      variety: "עמק",
      packages: 72,
      quantity: 550,
      unitPrice: 5,
      discountPct: 0,
      lineTotal: 2750,
      page: 2,
    });
    expect(own.lines[0]).toMatchObject({
      date: "2026-09-02",
      supplierRef: "909805",
      grower: "קושמרו ברק",
      product: "עגבניה",
      packages: null,
      quantity: 574,
      unitPrice: 5.2,
      lineTotal: 2984.8,
    });
    expect(own.discountPct).toBe(0);
  });

  it("joins variety, size and grade into the supplier's name", () => {
    expect(supplier.lines.find((l) => l.docNumber === "909864" && l.quantity === 1829)!.variety).toBe(
      "איקרם שחור XXL פרימיום",
    );
  });

  it("marks products sold by the piece", () => {
    const pineapple = supplier.lines.filter((l) => l.description === "אננס");
    expect(pineapple.every((l) => l.unit === "יח'")).toBe(true);
    expect(supplier.lines.find((l) => l.description === "פטאיה")!.unit).toBe('ק"ג');
  });
});

describe("Excel reports — errors", () => {
  const pair = PAIRS.excel;
  const input = async (own: string, supplier: string) => ({
    ownXlsx: await readSample(own),
    supplierXlsx: await readSample(supplier),
    ownFileName: own,
    supplierFileName: supplier,
  });
  const code = (p: Promise<unknown>) => p.then(() => null, (e: ExtractionError) => e.code);

  it("detects swapped files", async () => {
    expect(await code(extractExcel(await input(pair.supplier, pair.own), TEENA_RIMON))).toBe("FILES_SWAPPED");
  });

  it("rejects a file that is not a workbook", async () => {
    expect(await code(extractExcel(await input(PAIRS.granot.own, pair.supplier), TEENA_RIMON))).toBe("NOT_EXCEL");
  });

  it("names the missing columns", () => {
    const rows = [["מגדל", "תאריך", "אסמכתא", "תוצרת", "משקל"]];
    expect(detectExcel(teenaRimonWeighings, rows)).toBe(false);
    expect(missingHeaders(teenaRimonWeighings, rows)).toEqual(["משקל נטו", "מחיר"]);
    expect(detectExcel(growerSalesReport, rows)).toBe(false);
  });

  it("finds headers written with Hebrew quote marks and extra spaces", () => {
    const rows = [["דוח"], ["מס׳  תעודה משלוח", "שם מגדל", "תאור", "משקל מכירה", "מחיר מכירה", "תאריך"]];
    expect(detectExcel(growerSalesReport, rows)).toBe(true);
  });
});

describe("growers", () => {
  it("pairs differently spelt names, by shared delivery notes and by name", () => {
    const parties = pairGrowers(
      [
        { grower: "פירות דהן ובניו בע\"מ", refs: ["2155", "2159"] },
        { grower: "עדי חדד", refs: ["7921"] },
        { grower: "קושמרו ברק", refs: ["909805"] },
        { grower: "קושמרו יוסי", refs: ["909831"] },
        { grower: "משק מלצר בע\"מ", refs: ["102135"] },
      ],
      [
        { grower: "דהאן פרותס", refs: ["2155"] },
        { grower: "משק חדד שקוף", refs: ["7921"] },
        { grower: "קושמרו יוסי", refs: ["5587"] },
        { grower: "קושמרו ברק", refs: ["909805"] },
        { grower: "משק מלצר", refs: ["999"] },
      ],
      {},
      "תאנה ורימון",
    );
    expect(parties.ownParty("דהאן פרותס")).toBe(parties.supplierParty("פירות דהן ובניו בע\"מ"));
    expect(parties.ownParty("משק חדד שקוף")).toBe(parties.supplierParty("עדי חדד"));
    expect(parties.ownParty("משק מלצר")).toBe(parties.supplierParty("משק מלצר בע\"מ"));
    expect(parties.ownParty("קושמרו יוסי")).toBe(parties.supplierParty("קושמרו יוסי"));
    expect(parties.ownParty("קושמרו ברק")).not.toBe(parties.supplierParty("קושמרו יוסי"));
    expect(parties.warnings).toEqual([]);
  });

  it("keeps unrelated growers apart and reports them", () => {
    const parties = pairGrowers([{ grower: "משק ניסקה", refs: ["87"] }], [{ grower: "יורם פורטל", refs: ["87"] }], {}, "ת\"ר");
    // A shared delivery note alone is enough evidence; without one, nothing pairs.
    expect(parties.ownParty("יורם פורטל")).toBe(parties.supplierParty("משק ניסקה"));
    const apart = pairGrowers([{ grower: "משק ניסקה", refs: ["87"] }], [{ grower: "יורם פורטל", refs: ["1697"] }], {}, "ת\"ר");
    expect(apart.ownParty("יורם פורטל")).not.toBe(apart.supplierParty("משק ניסקה"));
    expect(apart.warnings).toEqual(['המגדל "משק ניסקה" מופיע רק בדוח הספק', 'המגדל "יורם פורטל" מופיע רק בדוח של ת"ר']);
  });

  it("follows configured aliases", () => {
    const parties = pairGrowers([{ grower: "א. כהן", refs: [] }], [{ grower: "משק הגפן", refs: [] }], { "משק הגפן": "א. כהן" }, "");
    expect(parties.ownParty("משק הגפן")).toBe(parties.supplierParty("א. כהן"));
  });

  it("compares names without vowel letters and noise words", () => {
    expect(nameSimilarity("דהאן פרותס", "פירות דהן ובניו בע\"מ")).toBe(1);
    expect(nameSimilarity("קושמרו ברק", "קושמרו יוסי")).toBe(0.5);
  });
});

describe("Excel reports — reconciliation", async () => {
  const extraction = await extractSample("excel");
  const result = reconcile(extraction, TEENA_RIMON);
  const bySupplierQty = (doc: string, qty: number) =>
    result.groups.find((g) => g.supplierLines.some((l) => l.docNumber === doc && l.quantity === qty))!;

  it("finds the one delivery missing on Teena-Rimon's side", () => {
    expect(result.supplierOnly.map((l) => [l.docNumber, l.description, l.quantity])).toEqual([["2146", "תפוז", 844]]);
    expect(result.ownOnly).toEqual([]);
  });

  it("totals weight × price; no discount, and gaps don't offset", () => {
    expect(result.totals).toMatchObject({ supplierNet: 144245.6, ownNet: 145834.8, ownDiscountPct: 0, diff: 1589.2 });
    expect(result.offset.applies).toBe(false);
  });

  it("matches a sale to the weighings that add up to it, by grade", () => {
    expect(bySupplierQty("909831", 1975).ownLines.map((l) => l.quantity)).toEqual([655, 651, 650]);
    expect(bySupplierQty("909831", 1007).ownLines.map((l) => l.quantity)).toEqual([508, 481]);
    expect(bySupplierQty("909864", 1829).ownLines.map((l) => l.quantity)).toEqual([614, 609, 609]);
    expect(bySupplierQty("909864", 530).ownLines.map((l) => l.quantity)).toEqual([529]);
  });

  it("groups same-product leftovers whose weights add up (n:m)", () => {
    const g = bySupplierQty("94", 57);
    expect(ids(g)).toBe("S10+S11→T50+T51");
    expect(g.flags).toEqual(["price"]);
  });

  it("pairs the evenly spread pitaya rows with one weighing", () => {
    expect(bySupplierQty("99", 53).supplierLines).toHaveLength(4);
    expect(bySupplierQty("92", 164).ownLines.map((l) => l.quantity)).toEqual([329]);
  });

  it("pairs mistyped references by content, within the same grower", () => {
    expect(bySupplierQty("520", 661).flags).toEqual(["doc_ref"]);
    expect(bySupplierQty("909813", 458).ownLines[0].supplierRef).toBe("5587");
    expect(bySupplierQty("909813", 458).flags).toContain("doc_ref");
  });

  it("says pieces, not weight, for pineapples", () => {
    expect(bySupplierQty("87", 58).notes).toContain("יחידות: ספק 58, תאנה ורימון 53 (-5)");
  });

  it("leaves the PDF path untouched (no grower parties)", async () => {
    const pdf = reconcile(await extractSample("granot"), TEENA_RIMON);
    expect(pdf.warnings.some((w) => w.includes("מגדל"))).toBe(false);
  });
});
