import { describe, expect, it } from "vitest";
import { summarizeExcel, type SummaryRow } from "../src/excel/summary.js";
import { extractSample, TEENA_RIMON } from "./helpers.js";

/**
 * The October pair against the comparison the customer made by hand
 * (sample_data/excel/השוואת_ספק_מארק_תאנה_ורימון_עד_7_10_26.xlsx), where the
 * supplier is Mark and Teena-Rimon's report is "דוחות עם מחירים".
 */
describe("Excel export — side-by-side comparison (October pair)", async () => {
  const { rows, outOfPeriod } = summarizeExcel(await extractSample("excelOct"), TEENA_RIMON);
  const row = (ref: string, product?: string) =>
    rows.filter((r) => r.ref === ref && (!product || r.product === product));
  const figures = (r: SummaryRow) => [r.supplier.weight, r.own.weight, r.weightDiff, r.supplier.cost, r.own.cost, r.costDiff];

  it("sums weight and weight × price per delivery note and product, Teena-Rimon minus supplier", () => {
    expect(row("94").map(figures)).toEqual([[2427, 2427, 0, 12897, 12820.1, -76.9]]);
    expect(row("1762").map(figures)).toEqual([[3175, 3180, 5, 11112.5, 9540, -1572.5]]);
    expect(row("94")[0]).toMatchObject({ date: "2026-09-09", grower: "ביטן ראובן", product: "חציל" });
  });

  it("keeps different products of one note apart, and merges names of one product", () => {
    expect(row("7988").map((r) => r.product).sort()).toEqual(["עגבניה", "שרי"]);
    expect(row("909907").map((r) => [r.product, r.supplier.weight, r.own.weight])).toEqual([["פלפל", 798, 797]]);
    expect(row("1076").map((r) => [r.product, r.supplier.weight, r.own.weight])).toEqual([["ענב לבן / ענבים", 442, 450]]);
  });

  it("compares the carton watermelons with Teena-Rimon's watermelons on the same note, days apart", () => {
    expect(row("102190").map((r) => [r.product, r.grower, ...figures(r)])).toEqual([
      ["אבטיח", "משק מלצר", 3905, 4051, 146, 13440.5, 12254.8, -1185.7],
    ]);
  });

  it("shows no cost where a price is 0, so the price gets filled in", () => {
    const missing = rows.filter((r) => r.supplier.cost == null || r.own.cost == null).map((r) => r.ref);
    expect(missing).toEqual(["20929", "102324", "102397", "909907", "26009496"]);
    expect(row("909907")[0].costDiff).toBeNull();
  });

  it("names the grower by its shortest spelling in either report", () => {
    expect(row("823")[0].grower).toBe("ערדום");
  });

  it("moves Teena-Rimon-only rows from before the supplier's period to their own list", () => {
    expect(outOfPeriod.map((r) => r.ref)).toEqual(["94", "99", "99", "102", "996", "909839", "909848", "909850", "909850", "909857", "909857", "909864"]);
    expect(outOfPeriod.every((r) => r.supplier.lines === 0 && r.date! < "2026-09-09")).toBe(true);
    // Supplier-only rows after Teena-Rimon's report ends stay in the comparison.
    expect(row("823")[0]).toMatchObject({ date: "2026-10-08", own: { lines: 0 } });
  });

  it("sorts by reference", () => {
    const refs = rows.map((r) => Number(r.ref));
    expect(refs).toEqual([...refs].sort((a, b) => a - b));
    expect(rows).toHaveLength(63);
  });
});
