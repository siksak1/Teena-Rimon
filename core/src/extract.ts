import { ExtractionError } from "./errors.js";
import type { ExtractionResult, ParseMode } from "./model.js";
import { loadPdf } from "./pdf/layout.js";
import { detectSupplier, SUPPLIER_PARSERS } from "./parsers/registry.js";
import { isTeenaRimonDraft, parseTeenaRimon } from "./parsers/teenaRimon.js";

export type ExtractInput = {
  trPdf: Uint8Array;
  supplierPdf: Uint8Array;
  trFileName: string;
  supplierFileName: string;
  parseMode: ParseMode;
};

/**
 * Parse both PDFs deterministically. Runs unchanged in Node (the API) and in
 * the browser, so the deployment can choose where parsing happens.
 */
export async function extractInvoices(input: ExtractInput): Promise<ExtractionResult> {
  const [trDoc, supplierDoc] = await Promise.all([
    loadPdf(input.trPdf).catch(() => {
      throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.trFileName}" כ-PDF`);
    }),
    loadPdf(input.supplierPdf).catch(() => {
      throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.supplierFileName}" כ-PDF`);
    }),
  ]);

  if (!isTeenaRimonDraft(trDoc)) {
    throw new ExtractionError(
      isTeenaRimonDraft(supplierDoc)
        ? "נראה שהקבצים הוחלפו — חשבונית תאנה ורימון הועלתה במקום חשבונית הספק"
        : `הקובץ "${input.trFileName}" אינו חשבונית טיוטה של תאנה ורימון (AGROLINE)`,
    );
  }

  const parser = detectSupplier(supplierDoc);
  if (!parser) {
    const supported = SUPPLIER_PARSERS.map((p) => p.displayName).join(", ");
    throw new ExtractionError(
      `הספק בקובץ "${input.supplierFileName}" אינו נתמך עדיין. ספקים נתמכים: ${supported}`,
    );
  }

  const supplier = parser.parse(supplierDoc);
  if (supplier.lines.length === 0) {
    throw new ExtractionError(`לא נמצאו שורות פריטים בחשבונית ${parser.displayName}`);
  }
  const teenaRimon = parseTeenaRimon(trDoc);

  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
  if (teenaRimon.againstInvoice && !digits(supplier.invoiceNumber).endsWith(digits(teenaRimon.againstInvoice))) {
    teenaRimon.warnings.push(
      `חשבונית הטיוטה הופקה כנגד חשבונית ${teenaRimon.againstInvoice}, אבל חשבונית הספק היא ${supplier.invoiceNumber}`,
    );
  }

  return {
    supplier,
    teenaRimon,
    meta: {
      parseMode: input.parseMode,
      trFileName: input.trFileName,
      supplierFileName: input.supplierFileName,
    },
  };
}
