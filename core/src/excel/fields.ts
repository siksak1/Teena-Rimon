/** What a report column can hold. Kept free of imports: the results page shows these labels. */
export type ExcelField = "date" | "doc" | "ownDoc" | "grower" | "product" | "packages" | "weight" | "price";

export const FIELD_LABELS: Record<ExcelField, string> = {
  date: "תאריך",
  doc: "תעודת משלוח",
  ownDoc: "מסמך פנימי",
  grower: "מגדל",
  product: "פריט",
  packages: "אריזות",
  weight: "משקל",
  price: "מחיר",
};
