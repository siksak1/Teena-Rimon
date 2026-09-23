/**
 * Structured output schema for AI invoice extraction.
 * The backend sends this schema to Gemini/OpenAI; the model must return JSON matching it.
 */
export const invoiceExtractionSchema = {
  type: "object",
  required: ["ourInvoice", "supplierInvoice"],
  properties: {
    ourInvoice: { $ref: "#/$defs/invoice" },
    supplierInvoice: { $ref: "#/$defs/invoice" },
  },
  $defs: {
    invoice: {
      type: "object",
      required: ["invoiceNumber", "date", "vendorName", "currency", "items", "grandTotal"],
      properties: {
        invoiceNumber: { type: "string" },
        date: { type: "string", description: "ISO date YYYY-MM-DD" },
        vendorName: { type: "string" },
        currency: { type: "string", description: "e.g. ILS" },
        grandTotal: { type: "number" },
        items: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "quantity", "unit", "unitPrice", "lineTotal"],
            properties: {
              name: { type: "string", description: "Product name as printed on the invoice" },
              quantity: { type: "number" },
              unit: { type: "string", description: "e.g. kg, unit, box" },
              unitPrice: { type: "number" },
              lineTotal: { type: "number" },
            },
          },
        },
      },
    },
  },
} as const;

export type InvoiceItem = {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
};

export type Invoice = {
  invoiceNumber: string;
  date: string;
  vendorName: string;
  currency: string;
  items: InvoiceItem[];
  grandTotal: number;
};

export type ExtractionResult = {
  ourInvoice: Invoice;
  supplierInvoice: Invoice;
  meta: {
    mode: "mock" | "ai";
    ourFileName: string;
    supplierFileName: string;
  };
};
