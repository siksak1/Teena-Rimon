/**
 * Extensible product-name normalization dictionary.
 * Keys are raw names as they appear on invoices (often supplier aliases);
 * values are the canonical names used for matching.
 *
 * Add entries freely — comparison always runs through `normalizeProductName`.
 */
export const PRODUCT_NAME_MAP: Record<string, string> = {
  // Dragon fruit aliases
  "ונוס (אדום)": "פיטאיה",
  "ונוס אדום": "פיטאיה",
  "ונוס": "פיטאיה",
  "פיטאיה אדומה": "פיטאיה",
  "dragon fruit": "פיטאיה",
  "pitaya": "פיטאיה",

  // Mango
  "מנגו כתמן": "מנגו קטמן",
  "מנגו קטמאן": "מנגו קטמן",
  mango: "מנגו קטמן",

  // Avocado
  "אבוקדו האס": "אבוקדו הס",
  "hass avocado": "אבוקדו הס",

  // Banana
  "בננה": "בננה אקוודור",
  banana: "בננה אקוודור",

  // Strawberry
  "תות": "תות שדה",
  strawberry: "תות שדה",

  // Lemon
  "לימון": "לימון סיציליאני",
  lemon: "לימון סיציליאני",

  // Persimmon
  "אפרסמון": "אפרסמון חאצ'יה",
  "חאצ'יה": "אפרסמון חאצ'יה",
  persimmon: "אפרסמון חאצ'יה",

  // Kiwi
  "קיווי זהב": "קיווי זהוב",
  "golden kiwi": "קיווי זהוב",
};

/** Collapse whitespace and trim for dictionary lookup. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Normalize a product name for deterministic matching.
 * 1. Trim / collapse whitespace
 * 2. Look up exact key in PRODUCT_NAME_MAP
 * 3. Fall back to lowercased Latin / as-is Hebrew canonical form
 */
export function normalizeProductName(rawName: string): string {
  const cleaned = collapseWhitespace(rawName);
  if (!cleaned) return "";

  const direct = PRODUCT_NAME_MAP[cleaned];
  if (direct) return direct;

  const lower = cleaned.toLowerCase();
  const lowerHit = PRODUCT_NAME_MAP[lower];
  if (lowerHit) return lowerHit;

  // Case-insensitive scan for Latin keys; Hebrew keys stay exact
  for (const [alias, canonical] of Object.entries(PRODUCT_NAME_MAP)) {
    if (alias.toLowerCase() === lower) return canonical;
  }

  return cleaned;
}

/** Register or override a mapping at runtime (useful for UI-driven dictionaries later). */
export function registerProductAlias(alias: string, canonical: string): void {
  PRODUCT_NAME_MAP[collapseWhitespace(alias)] = collapseWhitespace(canonical);
}
