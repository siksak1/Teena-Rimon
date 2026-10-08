/**
 * Product-name dictionary used by `NameMatcher`. Optional enrichment: rows
 * are matched on document, date, weight and price, and a product missing
 * here still compares by the stem of its first word. Entries add what a stem
 * cannot — cultivars, colours, grades, and real conflicts between known
 * families. Seeded from the sample invoices; unknown words on matched rows
 * show up in the result's `dictionarySuggestions`.
 *
 * Multi-word keys are allowed everywhere; longer phrases are matched first.
 */
export type NameDictionary = {
  /** Product families — a family mismatch means "not the same product". */
  families: string[];
  /** Alternative spellings of a family. */
  familyAliases: Record<string, string>;
  /** Cultivar → family (and colour when the cultivar implies one); `as` merges spellings. */
  cultivars: Record<string, { family: string; color?: string; as?: string }>;
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
    "עגבניה",
    "שרי",
    "בננה",
    "פלפל",
    "חציל",
    "מלפפון",
    "רימון",
    "סלק",
    "פסיפלורה",
    "אננס",
    "אבטיח",
    "קולורבי",
    "לוף",
    "דלעת",
    "כרוב",
    "קישוא",
  ],
  familyAliases: {
    ענבים: "ענב",
    עגבניות: "עגבניה",
    "עגבניות שרי": "שרי",
    "עגבניה שרי": "שרי",
    קישואים: "קישוא",
    "תפוח עץ": "תפוח",
    "dragon fruit": "פיטאיה",
    pitaya: "פיטאיה",
    פטאיה: "פיטאיה",
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
    אטינגר: { family: "אבוקדו" },
    קנט: { family: "מנגו" },
    אודם: { family: "תפוח", color: "אדום" },
    זהוב: { family: "תפוח", color: "צהוב" },
    "דולצ'ה": { family: "תפוח", as: "דולציה" },
    דולציה: { family: "תפוח" },
    סמיט: { family: "תפוח" },
    // Cherry tomatoes
    ליקופן: { family: "שרי" },
    לובלו: { family: "שרי" },
  },
  colors: {
    אדום: "אדום",
    אדומה: "אדום",
    לבן: "לבן",
    לבנה: "לבן",
    צהוב: "צהוב",
    צהובה: "צהוב",
    כתום: "כתום",
    כתומה: "כתום",
    ירוק: "ירוק",
    ירוקה: "ירוק",
  },
  grades: {
    "סוג א": "א",
    "סוג ב": "ב",
    תפזורת: "ב",
    בררה: "ב",
    נספק: "ב",
    "אא'": "א",
    אא: "א",
    "א א": "א",
    מובחר: "א",
    // Galil's market tiers (Teena-Rimon abbreviates "שוק מו")
    "שוק מוסדי": "מוסדי",
    "שוק מו": "מוסדי",
    מוסדי: "מוסדי",
    "איכות יצוא": "יצוא",
    יצוא: "יצוא",
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
    "במגש",
    "יבש",
    // growing / market channel and cut — not a different product
    "חממה",
    "על האש",
    "חתוך",
    "אשכולות",
    "באשכולות",
    "שוק",
    "תעשייתית",
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
