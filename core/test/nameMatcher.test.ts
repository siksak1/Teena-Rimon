import { describe, expect, it } from "vitest";
import { NameMatcher } from "../src/reconcile/names/NameMatcher.js";

const m = new NameMatcher();
const cmp = (a: string[], b: string[]) => m.compare(m.parse(...a), m.parse(...b));

describe("NameMatcher", () => {
  it.each([
    [["מנגו 20 פרימיום מפיות", "שלי"], ["מנגו שלי", "20"]],
    [["פיטאיה נספק", ""], ["פיטאיה", "סוג ב"]],
    [["פיטאיה בררה", "ונוס (אדום)"], ["פיטאיה", "תפזורת"]],
    [["בצל יבש סוג א", "ריברסייד"], ["בצל לבן", ""]],
    [["סברס - M גלעד"], ["סברס", "קטן"]],
    [["נקטרינה צהובה גודל 5"], ["נקטרינה צהובה", "50"]],
    [["אפרסק צהוב גודל 6.5"], ["אפרסק צהוב", "65"]],
    [["כרם עץ השדה - ג'קט סלוט - מיתוג"], ["ענב אדום", ""]],
    [["כרם יבולי גלעד - סוויט גלוב - ללא מיתוג"], ["ענב לבן", ""]],
    [["תפוח עץ אודם"], ["תפוח עץ אודם", "65"]],
    [["אבוקדו גליל מגש - בני דן"], ["אבוקדו גליל", ""]],
    [["מ קטמנדו"], ["מנגו קטמנדו"]],
  ])("%j matches %j without conflicts", (a, b) => {
    const r = cmp(a, b);
    expect(r.sameFamily).toBe(true);
    expect(r.conflicts).toEqual([]);
    expect(r.score).toBeGreaterThanOrEqual(0.7);
  });

  it("reports attribute conflicts but keeps the family", () => {
    expect(cmp(["מנגו 20 פרימיום מפיות", "שלי"], ["מנגו מאיה", "20"]).conflicts).toEqual(["זן: שלי ≠ מאיה"]);
    expect(cmp(["נקטרינה לבנה גודל 6"], ["נקטרינה צהובה", "60"]).conflicts).toEqual(["צבע: לבן ≠ צהוב"]);
    expect(cmp(["כרם יבולי גלעד - סוויט סלבריישן - מיתוג"], ["ענב לבן"]).conflicts).toEqual(["צבע: אדום ≠ לבן"]);
  });

  it("scores different families as zero", () => {
    expect(cmp(["תפוח עץ אודם"], ["נקטרינה", "60"])).toEqual({ score: 0, sameFamily: false, conflicts: [] });
  });

  it("collects unknown words", () => {
    expect(m.parse("ענב ארלי סוויט").unknown).toEqual(["ארלי", "סוויט"]);
  });
});
