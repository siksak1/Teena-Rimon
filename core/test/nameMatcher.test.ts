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

  it("rules out two different known families", () => {
    expect(cmp(["תפוח עץ אודם"], ["נקטרינה", "60"])).toEqual({
      score: 0,
      sameFamily: false,
      compatible: false,
      conflicts: [],
    });
    expect(cmp(["מלפפון"], ["עגבניה אשכולות"]).compatible).toBe(false);
  });

  it.each([
    [["עגבניות באשכולות"], ["עגבניה אשכולות"]],
    [["בננה אא' במגש"], ["בננה"]],
    [["אבוקדו גליל שוק מוסדי"], ["אבוקדו גליל", "שוק מו"]],
    [["עגבניות שרי לובלו"], ["שרי לובלו"]],
    [["תפוח דולצ'ה"], ["תפוח עץ דולציה"]],
  ])("%j matches %j (new suppliers)", (a, b) => {
    const r = cmp(a, b);
    expect(r.sameFamily).toBe(true);
    expect(r.conflicts).toEqual([]);
  });

  it("falls back to the word stem for products missing from the dictionary", () => {
    const a = m.parse("גויאבות");
    expect(a).toMatchObject({ family: "גויאב", familySource: "stem" });
    expect(m.compare(a, m.parse("גויאבה")).sameFamily).toBe(true);
  });

  it("keeps unrelated or unknown names compatible, with a neutral score", () => {
    const r = cmp(["איקרם"], ["עגבניה אשכולות"]);
    expect(r).toMatchObject({ sameFamily: false, compatible: true, conflicts: [] });
    expect(r.score).toBeGreaterThan(0);
  });

  it("collects unknown words", () => {
    expect(m.parse("ענב ארלי סוויט").unknown).toEqual(["ארלי", "סוויט"]);
  });
});
