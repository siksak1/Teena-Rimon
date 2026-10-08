import { ExtractionError } from "./errors.js";
import type { CustomerConfig } from "./customer.js";
import type { ExtractionResult } from "./model.js";
import { loadPdf } from "./pdf/layout.js";
import {
  detectSupplier,
  ownDocumentParser,
  supplierParsersFor,
  UNSUPPORTED_SUPPLIERS,
} from "./parsers/registry.js";

export type ExtractInput = {
  /** The wholesaler's own document (Teena-Rimon: the AGROLINE draft). */
  ownPdf: Uint8Array;
  supplierPdf: Uint8Array;
  ownFileName: string;
  supplierFileName: string;
};

/**
 * Parse both PDFs deterministically. Runs in the browser (the app) and in
 * Node (the tests); invoice files are never sent anywhere.
 */
export async function extractInvoices(
  input: ExtractInput,
  config: CustomerConfig,
): Promise<ExtractionResult> {
  const ownParser = ownDocumentParser(config.ownDocument.format);
  const supplierParsers = supplierParsersFor(config);
  const [ownDoc, supplierDoc] = await Promise.all([
    loadPdf(input.ownPdf).catch(() => {
      throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.ownFileName}" כ-PDF`);
    }),
    loadPdf(input.supplierPdf).catch(() => {
      throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.supplierFileName}" כ-PDF`);
    }),
  ]);

  if (!ownParser.detect(ownDoc)) {
    throw new ExtractionError(
      ownParser.detect(supplierDoc)
        ? `נראה שהקבצים הוחלפו — חשבונית ${config.displayName} הועלתה במקום חשבונית הספק`
        : `הקובץ "${input.ownFileName}" אינו ${config.ownDocument.label} של ${config.displayName}`,
    );
  }

  const parser = detectSupplier(supplierDoc, supplierParsers);
  if (!parser) {
    const known = UNSUPPORTED_SUPPLIERS.find((u) => supplierDoc.text.includes(u.vatId));
    if (known) throw new ExtractionError(`חשבונית ${known.name} אינה נתמכת: ${known.reason}`);
    const supported = supplierParsers.map((p) => p.displayName).join(", ");
    throw new ExtractionError(
      `הספק בקובץ "${input.supplierFileName}" אינו נתמך עדיין. ספקים נתמכים: ${supported}`,
    );
  }

  const supplier = parser.parse(supplierDoc);
  if (supplier.lines.length === 0) {
    throw new ExtractionError(`לא נמצאו שורות פריטים בחשבונית ${parser.displayName}`);
  }
  const own = ownParser.parse(ownDoc, config.displayName);

  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
  if (own.againstInvoice && !digits(supplier.invoiceNumber).endsWith(digits(own.againstInvoice))) {
    own.warnings.push(
      `חשבונית הטיוטה הופקה כנגד חשבונית ${own.againstInvoice}, אבל חשבונית הספק היא ${supplier.invoiceNumber}`,
    );
  }

  return {
    supplier,
    own,
    meta: {
      ownFileName: input.ownFileName,
      supplierFileName: input.supplierFileName,
    },
  };
}
