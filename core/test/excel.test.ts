import { describe, expect, it } from "vitest";
import { ExtractionError } from "../src/errors.js";
import { extractExcel } from "../src/excel/extract.js";
import { detectPair, MissingColumnsError, readLayout } from "../src/excel/columns.js";
import type { Cell } from "../src/excel/read.js";
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

describe("Excel reports — other layouts (October pair)", async () => {
  const { supplier, own, meta } = await extractSample("excelOct");

  it("finds the columns whatever they are called", () => {
    expect(meta.excelColumns).toEqual({
      own: { date: "תאריך", product: "תוצרת", grower: "מגדל", weight: "משקל נטו", price: "מחיר", packages: "כמות", doc: "אסמכתא", ownDoc: "מספר תעודה" },
      supplier: { date: "תאריך", product: "תאור", grower: "שם מגדל", weight: "משקל מכירה", price: "מחיר מכירה", packages: "כמות", doc: "תעודה" },
    });
    expect([...supplier.warnings, ...own.warnings]).toEqual([]);
  });

  it("links by the reference both reports share; Teena-Rimon's own number is its document", () => {
    expect(supplier.lines).toHaveLength(141);
    expect(own.lines).toHaveLength(168);
    expect(own.lines[0]).toMatchObject({
      grower: "מארק ערדום",
      date: "2026-10-08",
      supplierRef: "823",
      ownDocNumber: "24017",
      product: "מלון",
      packages: 66,
      quantity: 593,
      unitPrice: 3,
    });
    expect(supplier.lines[0]).toMatchObject({ docNumber: "20955", grower: "אופיר בן יוסף", description: "פפאיה", variety: "תאילנדית ירוקה", packages: 34, quantity: 200, unitPrice: 5 });
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

  it("names the fields it could not find", async () => {
    const own = await readSample(pair.own);
    const noPrice = async () => {
      const { readDataSheet } = await import("../src/excel/read.js");
      const rows = (await readDataSheet(own))!.map((r) => r.slice(0, 6)); // drops מחיר
      return detectPair(readLayout(rows), readLayout((await readDataSheet(await readSample(pair.supplier)))!));
    };
    // With one figure left, weight and price cannot be told apart.
    await expect(noPrice()).rejects.toMatchObject({ side: "own", fields: ["weight", "price"] });
    await expect(noPrice()).rejects.toBeInstanceOf(MissingColumnsError);
  });
});

/* Made-up reports: three growers, a few deliveries each. */
type Delivery = { grower: string; date: Date; doc: number; ownDoc: number; product: string; price: number; weights: number[] };
const DELIVERIES: Delivery[] = [
  { grower: "יורם פורטל", date: new Date("2026-09-01"), doc: 1697, ownDoc: 23001, product: "רימון", price: 5.5, weights: [532, 535, 541] },
  { grower: "יורם פורטל", date: new Date("2026-09-03"), doc: 1702, ownDoc: 23017, product: "רימון", price: 5, weights: [528, 519] },
  { grower: "קושמרו ברק", date: new Date("2026-09-02"), doc: 909805, ownDoc: 23005, product: "עגבניה", price: 5.2, weights: [574, 567] },
  { grower: "קושמרו ברק", date: new Date("2026-09-02"), doc: 909805, ownDoc: 23005, product: "פלפל אדום", price: 9.2, weights: [455] },
  { grower: "קושמרו ברק", date: new Date("2026-09-06"), doc: 909839, ownDoc: 23040, product: "חציל", price: 4.8, weights: [655, 651, 650] },
  { grower: "משק מלצר", date: new Date("2026-09-05"), doc: 102135, ownDoc: 23031, product: "מלון", price: 3.5, weights: [593, 564, 596] },
  { grower: "משק מלצר", date: new Date("2026-09-07"), doc: 102140, ownDoc: 23052, product: "מלון", price: 3, weights: [576, 601] },
];
const PACK_KG: Record<string, number> = { רימון: 7.4, עגבניה: 15.6, "פלפל אדום": 5.2, חציל: 9.1, מלון: 9 };

/** One row per weighing; columns in the given order. */
function ownSheet(columns: string[], header = true): Cell[][] {
  const value = (d: Delivery, w: number, c: string): Cell =>
    ({
      ספק: d.grower,
      מגדל: d.grower,
      תאריך: d.date,
      "מספר קליטה": d.ownDoc,
      אסמכתא: d.doc,
      תיאור: d.product,
      ארגזים: Math.round(w / PACK_KG[d.product]),
      משקל: w,
      מחיר: d.price,
    })[c] ?? null;
  const rows = DELIVERIES.flatMap((d) => d.weights.map((w) => columns.map((c) => value(d, w, c))));
  return header ? [columns, ...rows] : rows;
}

/** One row per delivery and product, as a marketer's sales report. */
function supplierSheet(columns: string[], header = true): Cell[][] {
  const value = (d: Delivery, c: string): Cell => {
    const w = d.weights.reduce((s, x) => s + x, 0);
    return (
      {
        תעודה: d.doc,
        יעד: "תאנה ורימון",
        "שם מגדל": d.grower,
        תוצרת: d.product,
        איכות: d.weights.length > 2 ? "א" : "ב",
        כמות: Math.round(w / PACK_KG[d.product]),
        "משקל מכירה": w,
        "משקל ברוטו": w + d.weights.length * 2,
        "מחיר מכירה": d.price,
        תאריך: d.date,
      } as Record<string, Cell>
    )[c] ?? null;
  };
  const rows = DELIVERIES.map((d) => columns.map((c) => value(d, c)));
  return header ? [columns, ...rows] : rows;
}

const OWN = ["ספק", "תאריך", "אסמכתא", "תיאור", "ארגזים", "משקל", "מחיר"];
const SUPPLIER = ["תעודה", "יעד", "שם מגדל", "תוצרת", "איכות", "כמות", "משקל מכירה", "מחיר מכירה", "תאריך"];
const detect = (own: Cell[][], supplier: Cell[][]) => detectPair(readLayout(own), readLayout(supplier));
const at = (columns: string[], ...names: string[]) => Object.fromEntries(names.map((n) => [n, columns.indexOf(n)]));

describe("Excel reports — finding columns by their values", () => {
  it("reads other column names and orders", () => {
    const own = ["מחיר", "תיאור", "משקל", "ספק", "ארגזים", "אסמכתא", "תאריך"];
    const { own: o, supplier: s } = detect(ownSheet(own), supplierSheet(SUPPLIER));
    expect(o.fields).toEqual({
      price: own.indexOf("מחיר"),
      product: own.indexOf("תיאור"),
      weight: own.indexOf("משקל"),
      grower: own.indexOf("ספק"),
      packages: own.indexOf("ארגזים"),
      doc: own.indexOf("אסמכתא"),
      date: own.indexOf("תאריך"),
    });
    expect(s.fields).toMatchObject({ doc: 0, grower: 2, product: 3, packages: 5, weight: 6, price: 7, date: 8 });
    expect([...o.warnings, ...s.warnings]).toEqual([]);
  });

  it("needs no header row at all", () => {
    const withHeaders = detect(ownSheet(OWN), supplierSheet(SUPPLIER));
    const without = detect(ownSheet(OWN, false), supplierSheet(SUPPLIER, false));
    expect(without.own.fields).toEqual(withHeaders.own.fields);
    expect(without.supplier.fields).toEqual(withHeaders.supplier.fields);
    expect(without.own.used.grower).toBe("עמודה A");
  });

  it("takes the delivery note from the column the other report shares; the other is the own document", () => {
    const own = ["מגדל", "תאריך", "מספר קליטה", "אסמכתא", "תיאור", "משקל", "מחיר"];
    const { own: o } = detect(ownSheet(own, false), supplierSheet(SUPPLIER, false));
    expect(o.fields).toMatchObject(at(own, "אסמכתא", "מספר קליטה") && { doc: 3, ownDoc: 2 });
  });

  it("does without a package count", () => {
    const own = ["מגדל", "תאריך", "אסמכתא", "תיאור", "משקל", "מחיר"];
    const { own: o } = detect(ownSheet(own), supplierSheet(SUPPLIER));
    expect(o.fields.packages).toBeUndefined();
    expect(o.fields).toMatchObject({ weight: 4, price: 5 });
  });

  it("ignores a column holding one value (the report's destination)", () => {
    const { supplier: s } = detect(ownSheet(OWN), supplierSheet(SUPPLIER, false));
    expect(s.fields.grower).toBe(2);
    expect(s.extras).toEqual([4]); // the grade, not the destination
  });

  it("guesses between near-identical columns, with a warning", () => {
    const supplier = ["תעודה", "שם מגדל", "תוצרת", "משקל ברוטו", "משקל מכירה", "מחיר מכירה", "תאריך"];
    const { supplier: s } = detect(ownSheet(OWN), supplierSheet(supplier, false));
    expect([3, 4]).toContain(s.fields.weight);
    expect(s.warnings.some((w) => w.includes("לא בוודאות"))).toBe(true);
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
