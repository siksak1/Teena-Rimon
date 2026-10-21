import type { AiReading } from "../src/ai/verify.js";
import type { SupplierInvoice } from "../src/model.js";

/**
 * A perfect AI reading of Granot's invoice, built from what its dedicated
 * parser reads, with the layout the AI would describe. Tests corrupt copies
 * of it to check that a wrong answer is caught.
 */
const ddmmyyyy = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : null);

export function readingFrom(invoice: SupplierInvoice): AiReading {
  return {
    supplierName: "חקלאי גרנות",
    vatId: "570063362",
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: ddmmyyyy(invoice.invoiceDate),
    printedItemsTotal: invoice.printedItemsTotal,
    lines: invoice.lines.map((l) => ({
      page: l.page,
      date: ddmmyyyy(l.date),
      docNumber: l.docNumber,
      bookRef: l.bookRef,
      description: l.description,
      sku: l.sku,
      packages: l.packages,
      quantity: l.quantity,
      unit: l.unit,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      lineTotal: l.lineTotal,
    })),
    profile: {
      headers: [
        { label: "תאריך", field: "date" },
        { label: "תעודה", field: "doc" },
        { label: "תעודה מפנקס", field: "bookRef" },
        { label: "תאור מוצר", field: "description" },
        { label: "זן", field: "variety" },
        { label: "משטח", field: "pallet" },
        { label: "מס. אריזות", field: "packages" },
        { label: "כמות", field: "quantity" },
        { label: "מחיר ליחידה", field: "unitPrice" },
        { label: "הנחה", field: "discount" },
        { label: "מחיר ליח' אחרי הנחה", field: "netPrice" },
        { label: 'סה"כ מחיר', field: "total" },
      ],
      amountColumns: { quantity: "כמות", unitPrice: "מחיר ליחידה", total: 'סה"כ מחיר', discount: "הנחה" },
      totalLabel: 'סכום פטור ממע"מ',
      invoiceNumberLabel: "חשבונית מס מרכזת",
      dateLabel: "תאריך חשבונית",
      discountSource: "row",
      amountUnits: [],
      skipRows: [],
    },
  };
}
