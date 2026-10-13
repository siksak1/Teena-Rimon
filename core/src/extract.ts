import { ExtractionError } from "./errors.js";
import type { CustomerConfig } from "./customer.js";
import type { ExtractionResult, OwnInvoice, SupplierInvoice } from "./model.js";
import { missingDiscountWarning } from "./parsers/agrolineDraft.js";
import { DIGITS } from "./ocr/table.js";
import type { GrayImage, ScanSupport } from "./ocr/types.js";
import { loadPdf, type PdfDocument } from "./pdf/layout.js";
import { crop, loadScan } from "./pdf/scan.js";
import { round2 } from "./pdf/text.js";
import {
  detectSupplier,
  ownDocumentParser,
  supplierParsersFor,
  UNSUPPORTED_SUPPLIERS,
} from "./parsers/registry.js";
import type { ScannedSupplierParser, SupplierParser } from "./parsers/types.js";

export type ExtractInput = {
  /** The wholesaler's own document (Teena-Rimon: the AGROLINE draft). */
  ownPdf: Uint8Array;
  supplierPdf: Uint8Array;
  ownFileName: string;
  supplierFileName: string;
};

/**
 * Parse both PDFs deterministically. Runs in the browser (the app) and in
 * Node (the tests); invoice files are never sent anywhere. `scan` supplies
 * the image decoder and OCR for suppliers who send scanned invoices; without
 * it those invoices are rejected.
 */
export async function extractInvoices(
  input: ExtractInput,
  config: CustomerConfig,
  scan?: ScanSupport,
): Promise<ExtractionResult> {
  const ownParser = ownDocumentParser(config.ownDocument.format);
  const supplierParsers = supplierParsersFor(config);
  const [ownDoc, supplierDoc] = await Promise.all([
    loadPdf(input.ownPdf).catch(() => {
      throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.ownFileName}" כ-PDF`, "NOT_PDF");
    }),
    loadPdf(input.supplierPdf).catch(() => {
      throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.supplierFileName}" כ-PDF`, "NOT_PDF");
    }),
  ]);

  if (!ownParser.detect(ownDoc)) {
    throw ownParser.detect(supplierDoc)
      ? new ExtractionError(
          `נראה שהקבצים הוחלפו — חשבונית ${config.displayName} הועלתה במקום חשבונית הספק`,
          "FILES_SWAPPED",
        )
      : new ExtractionError(
          `הקובץ "${input.ownFileName}" אינו ${config.ownDocument.label} של ${config.displayName}`,
          "OWN_DOC_NOT_RECOGNIZED",
        );
  }

  let pages: GrayImage[] | null = null;
  const readPages = async () => {
    if (!scan) throw new Error("Scanned invoices need ScanSupport");
    pages ??= await loadScan(input.supplierPdf, { "jbig2.wasm": await scan.jbig2Wasm() });
    return pages;
  };

  let parser: SupplierParser | null = detectSupplier(supplierDoc, supplierParsers);
  if (!parser && scan && hasNoText(supplierDoc)) parser = await detectScanned(supplierParsers, readPages, scan);
  if (!parser) {
    const known = UNSUPPORTED_SUPPLIERS.find((u) => supplierDoc.text.includes(u.vatId));
    if (known) {
      throw new ExtractionError(`חשבונית ${known.name} אינה נתמכת: ${known.reason}`, "UNSUPPORTED_SUPPLIER");
    }
    const supported = supplierParsers.map((p) => p.displayName).join(", ");
    throw new ExtractionError(
      `הספק בקובץ "${input.supplierFileName}" אינו נתמך עדיין. ספקים נתמכים: ${supported}`,
      "UNSUPPORTED_SUPPLIER",
    );
  }

  let supplier: SupplierInvoice;
  if (parser.scanned) {
    if (!scan) {
      throw new ExtractionError(`חשבונית ${parser.displayName} סרוקה, וקריאת סריקות אינה זמינה כאן`, "UNSUPPORTED_SUPPLIER");
    }
    const [scanned, ocr] = await Promise.all([readPages(), scan.ocr()]);
    if (!scanned) {
      throw new ExtractionError(
        `הקובץ "${input.supplierFileName}" אינו חשבונית ${parser.displayName} סרוקה כפי שהיא נשלחת בדרך כלל`,
        "SCAN_UNREADABLE",
      );
    }
    scan.onProgress?.(0, scanned.length);
    supplier = await parser.parseScan(scanned, ocr, (done) => scan.onProgress?.(done, scanned.length));
  } else {
    supplier = parser.parse(supplierDoc);
  }
  if (supplier.lines.length === 0) {
    throw new ExtractionError(`לא נמצאו שורות פריטים בחשבונית ${parser.displayName}`, "NO_LINES");
  }
  const own = ownParser.parse(ownDoc, config.displayName);
  const unprinted = config.unprintedDiscounts?.[parser.id];
  if (unprinted != null) applyUnprintedDiscount(supplier, own, unprinted, config.displayName);

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

/** A scan with no text layer at all (the scanner ran no OCR of its own). */
function hasNoText(doc: PdfDocument): boolean {
  return doc.text.replace(/\s/g, "").length < 50;
}

/** Find the VAT number of a scanned-invoice supplier in the top quarter of page 1. */
export async function detectScanned(
  parsers: SupplierParser[],
  readPages: () => Promise<GrayImage[] | null>,
  scan: ScanSupport,
): Promise<ScannedSupplierParser | null> {
  const scanned = parsers.filter((p): p is ScannedSupplierParser => p.scanned === true);
  if (scanned.length === 0) return null;
  const [pages, ocr] = await Promise.all([readPages(), scan.ocr()]);
  if (!pages) return null;
  const top = crop(pages[0], { left: 0, right: pages[0].width - 1, top: 0, bottom: Math.round(pages[0].height / 4) });
  const lines = await ocr.readLines(top, { model: "eng", whitelist: DIGITS });
  const digits = lines.map((l) => l.text).join(" ");
  return scanned.find((p) => digits.includes(p.vatId)) ?? null;
}

/**
 * Some suppliers (Bananot Carmel) print prices that are already discounted and
 * never name the rate, and the own document for them has no "הנחה מסחרית".
 * Restate the supplier lines as list price less the agreed rate (their printed
 * totals stay as they are) and apply the same rate to the own document, so
 * both sides compare like any other supplier.
 */
function applyUnprintedDiscount(supplier: SupplierInvoice, own: OwnInvoice, rate: number, customerName: string): void {
  for (const line of supplier.lines) {
    if (line.discountPct !== 0) continue;
    line.unitPrice /= 1 - rate;
    line.discountPct = rate;
  }
  if (own.commercialDiscount) return;
  const gross = own.lines.reduce((s, l) => s + l.lineTotal, 0);
  own.commercialDiscount = round2(gross * rate);
  own.discountPct = rate;
  own.warnings = own.warnings.filter((w) => w !== missingDiscountWarning(customerName));
}
