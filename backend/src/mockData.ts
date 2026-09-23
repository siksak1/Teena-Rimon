import type { ExtractionResult } from "./schema.js";

/**
 * Hardcoded extraction payload for local development.
 * Designed to exercise: exact matches, price mismatch, quantity mismatch,
 * and name-normalization via the frontend dictionary (ונוס → פיטאיה).
 */
export function getMockExtraction(
  ourFileName: string,
  supplierFileName: string,
): ExtractionResult {
  return {
    ourInvoice: {
      invoiceNumber: "INV-2026-0841",
      date: "2026-03-18",
      vendorName: "מחסן הפירות שלנו",
      currency: "ILS",
      grandTotal: 1842.5,
      items: [
        {
          name: "פיטאיה",
          quantity: 12.5,
          unit: "kg",
          unitPrice: 28,
          lineTotal: 350,
        },
        {
          name: "מנגו קטמן",
          quantity: 20,
          unit: "kg",
          unitPrice: 18.5,
          lineTotal: 370,
        },
        {
          name: "אבוקדו הס",
          quantity: 15,
          unit: "kg",
          unitPrice: 22,
          lineTotal: 330,
        },
        {
          name: "בננה אקוודור",
          quantity: 40,
          unit: "kg",
          unitPrice: 6.2,
          lineTotal: 248,
        },
        {
          name: "תות שדה",
          quantity: 8,
          unit: "kg",
          unitPrice: 42,
          lineTotal: 336,
        },
        {
          name: "לימון סיציליאני",
          quantity: 10,
          unit: "kg",
          unitPrice: 9.5,
          lineTotal: 95,
        },
        {
          name: "אפרסמון חאצ'יה",
          quantity: 6,
          unit: "kg",
          unitPrice: 18.9,
          lineTotal: 113.4,
        },
      ],
    },
    supplierInvoice: {
      invoiceNumber: "S-77821",
      date: "2026-03-18",
      vendorName: "ספק פירות גליל",
      currency: "ILS",
      grandTotal: 1910.8,
      items: [
        {
          // Maps to "פיטאיה" via frontend normalization dictionary
          name: "ונוס (אדום)",
          quantity: 12.5,
          unit: "kg",
          unitPrice: 29.5,
          lineTotal: 368.75,
        },
        {
          name: "מנגו קטמן",
          quantity: 20,
          unit: "kg",
          unitPrice: 18.5,
          lineTotal: 370,
        },
        {
          name: "אבוקדו הס",
          // Quantity / weight mismatch
          quantity: 14.2,
          unit: "kg",
          unitPrice: 22,
          lineTotal: 312.4,
        },
        {
          name: "בננה אקוודור",
          quantity: 40,
          unit: "kg",
          // Price mismatch
          unitPrice: 6.8,
          lineTotal: 272,
        },
        {
          name: "תות שדה",
          quantity: 8,
          unit: "kg",
          unitPrice: 42,
          lineTotal: 336,
        },
        {
          name: "לימון סיציליאני",
          quantity: 10,
          unit: "kg",
          unitPrice: 9.5,
          lineTotal: 95,
        },
        // Supplier has an extra line not on our invoice
        {
          name: "קיווי זהוב",
          quantity: 5,
          unit: "kg",
          unitPrice: 31.33,
          lineTotal: 156.65,
        },
        // Our "אפרסמון חאצ'יה" is missing from supplier — unmatched on our side
      ],
    },
    meta: {
      mode: "mock",
      ourFileName,
      supplierFileName,
    },
  };
}
