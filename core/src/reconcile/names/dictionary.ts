/**
 * Product-name dictionary used by `NameMatcher`. Seeded from the Granot and
 * Shivuk HaHof samples — extend it as new suppliers / products appear
 * (unknown words show up in the result's `dictionarySuggestions`).
 *
 * Multi-word keys are allowed everywhere; longer phrases are matched first.
 */
export type NameDictionary = {
  /** Product families — a family mismatch means "not the same product". */
  families: string[];
  /** Alternative spellings of a family. */
  familyAliases: Record<string, string>;
  /** Cultivar → family (and colour when the cultivar implies one). */
  cultivars: Record<string, { family: string; color?: string }>;
  colors: Record<string, string>;
  /** Quality grade phrases → "א" | "ב". */
  grades: Record<string, string>;
  /** Named sizes → canonical size code. Numeric sizes are handled in code. */
  sizes: Record<string, string>;
  /** Words that carry no product identity (growers, branding, packaging, marketing). */
  noise: string[];
};

export const DEFAULT_DICTIONARY: NameDictionary = {
  families: [
    "ענב",
    "מנגו",
    "פיטאיה",
    "קלמנטינה",
    "אבוקדו",
    "בצל",
    "סברס",
    "תפוח",
    "נקטרינה",
    "שזיף",
    "אפרסק",
  ],
  familyAliases: {
    ענבים: "ענב",
    "תפוח עץ": "תפוח",
    "dragon fruit": "פיטאיה",
    pitaya: "פיטאיה",
  },
  cultivars: {
    // Grapes
    "סוויט גלוב": { family: "ענב", color: "לבן" },
    "שוגר קריספ": { family: "ענב", color: "לבן" },
    "סוויט סלבריישן": { family: "ענב", color: "אדום" },
    "ג'קט סלוט": { family: "ענב", color: "אדום" },
    // Mango
    שלי: { family: "מנגו" },
    עומר: { family: "מנגו" },
    מאיה: { family: "מנגו" },
    קטמנדו: { family: "מנגו" },
    // Pitaya
    ונוס: { family: "פיטאיה", color: "אדום" },
    // Citrus / avocado / apple
    סצומה: { family: "קלמנטינה" },
    האס: { family: "אבוקדו" },
    גליל: { family: "אבוקדו" },
    אודם: { family: "תפוח", color: "אדום" },
  },
  colors: {
    אדום: "אדום",
    אדומה: "אדום",
    לבן: "לבן",
    לבנה: "לבן",
    צהוב: "צהוב",
    צהובה: "צהוב",
  },
  grades: {
    "סוג א": "א",
    "סוג ב": "ב",
    תפזורת: "ב",
    בררה: "ב",
    נספק: "ב",
  },
  sizes: {
    // Shivuk prints "סברס M" where Teena-Rimon writes "סברס קטן".
    M: "S",
    קטן: "S",
    S: "S",
    בינוני: "M",
    L: "L",
    גדול: "L",
    XL: "XL",
  },
  noise: [
    // packaging / marketing
    "פרימיום",
    "מפיות",
    "ללא מיתוג",
    "מיתוג",
    "מגש",
    "יבש",
    "עץ",
    // a mix of varieties — says nothing about the cultivar
    "מיקס",
    // growers and vineyards
    "כרם",
    "יבולי גלעד",
    "גלעד",
    "דליה",
    "בני דן",
    "ריברסייד",
    "עץ השדה",
    "דרך הפלחה",
  ],
};
