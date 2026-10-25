import { ExtractionError } from "./errors.js";
import type { CustomerConfig } from "./customer.js";
import type { ExtractionResult, OwnInvoice, SupplierInvoice } from "./model.js";
import { missingDiscountWarning } from "./parsers/agrolineDraft.js";
import { DIGITS } from "./ocr/table.js";
import type { GrayImage, ScanSupport } from "./ocr/types.js";
import { loadPdf, type PdfDocument } from "./pdf/layout.js";
import { ocrDocument } from "./pdf/ocrDocument.js";
import { checkReading, unreadLines, type ReadingCheck } from "./parsers/coverage.js";
import { parseWithProfile } from "./parsers/generic.js";
import { vatCandidates } from "./parsers/profile.js";
import { rowsPayload, type RemoteSupport } from "./remote.js";
import { repairMissingText } from "./pdf/repair.js";
import { crop, loadScan } from "./pdf/scan.js";
import { round2 } from "./pdf/text.js";
import {
  detectSupplier,
  FALLBACK_PARSERS,
  ownDocumentParser,
  parsersToTry,
  UNSUPPORTED_SUPPLIERS,
} from "./parsers/registry.js";
import type { OwnDocumentParser, ScannedSupplierParser, SupplierParser, TextSupplierParser } from "./parsers/types.js";

export type ExtractInput = {
  /** The wholesaler's own document (Teena-Rimon: the AGROLINE draft). */
  ownPdf: Uint8Array;
  supplierPdf: Uint8Array;
  ownFileName: string;
  supplierFileName: string;
};

/**
 * Parse both PDFs. Runs in the browser (the app) and in Node (the tests).
 * `scan` supplies the image decoder and OCR for scanned invoices; without it
 * those invoices are rejected. The supplier invoice is tried, in order, by:
 *
 * 1. the parser written for its supplier, then the generic parsers;
 * 2. a scan from a supplier with no parser of its own: OCR of the whole page,
 *    then the generic parsers on the text it read;
 * 3. with `remote` and `config.aiFallback`: the supplier's learned layout
 *    (a profile fetched by VAT number, applied here);
 * 4. the AI, through `remote` — the only step that sends the invoice out.
 *
 * Every reader refuses unless the lines add up to a printed total, so each
 * step runs only when the ones before it could not read the invoice. On a
 * digital PDF every reading is also checked against the invoice itself
 * (`checkReading`): one that misses a printed row, or has no printed total to
 * add up to, is passed over for the next step. When no step passes, the
 * reading that missed the fewest rows is used, with the missed rows added as
 * `unread` lines — no item row is ever left out unseen.
 */
export async function extractInvoices(
  input: ExtractInput,
  config: CustomerConfig,
  scan?: ScanSupport,
  remote?: RemoteSupport,
): Promise<ExtractionResult> {
  const ownParser = ownDocumentParser(config.ownDocument.format);
  const supplierParsers = parsersToTry(config);
  const [ownLoaded, supplierLoaded] = await Promise.all([
    loadPdf(input.ownPdf).catch(() => {
      throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.ownFileName}" כ-PDF`, "NOT_PDF");
    }),
    loadPdf(input.supplierPdf).catch(() => {
      throw new ExtractionError(`לא ניתן לקרוא את הקובץ "${input.supplierFileName}" כ-PDF`, "NOT_PDF");
    }),
  ]);

  const ownDoc = await withMissingText(ownLoaded, input.ownPdf, input.ownFileName, scan);
  const supplierFile = await withMissingText(supplierLoaded, input.supplierPdf, input.supplierFileName, scan);

  if (!ownParser.detect(ownDoc)) {
    throw ownParser.detect(supplierFile)
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

  const own = ownParser.parse(ownDoc, config.displayName);
  // A copy of the wholesaler's own draft printed into the supplier's file is not part of the invoice.
  const { doc: supplierDoc, skipped: draftPages } = withoutOwnDraftPages(supplierFile, ownParser);
  const generic = config.genericFallback !== false;

  let parser: SupplierParser | null = detectSupplier(supplierDoc, supplierParsers);
  if (!parser && scan && hasNoText(supplierDoc)) parser = await detectScanned(supplierParsers, readPages, scan);

  let supplier: SupplierInvoice | null = null;
  /** The document the text parsers read: the PDF's text, or what OCR read from a scan. */
  let textDoc = supplierDoc;
  /** Why the generic parsers refused, shown when nothing else reads the invoice. */
  let refusal: ExtractionError | null = null;
  /** Readings of the digital PDF that failed `checkReading`, best first once sorted. */
  const rejected: { reader: string; invoice: SupplierInvoice; check: ReadingCheck }[] = [];
  /** The check of the reading kept, for its pallet rows. */
  let passed: ReadingCheck | null = null;
  /** Keep a reading of the digital PDF only if it accounts for every printed row. */
  const gate = (invoice: SupplierInvoice, reader: string): SupplierInvoice | null => {
    const check = checkReading(supplierDoc, invoice);
    if (check.ok) {
      passed = check;
      return invoice;
    }
    rejected.push({ reader, invoice, check });
    return null;
  };
  const tryParse = (p: TextSupplierParser, doc: PdfDocument) => {
    try {
      const invoice = p.parse(doc);
      supplier = doc === supplierDoc ? gate(invoice, p.displayName) : invoice;
    } catch (err) {
      // A generic parser refusing is expected: the next step may read the invoice.
      if (!p.fallback || !(err instanceof ExtractionError)) throw err;
      refusal = err;
    }
  };

  if (parser?.scanned) {
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
    const scannedParser = parser;
    supplier = await scannedParser.parseScan(scanned, ocr, (done) => scan.onProgress?.(done, scanned.length));
  } else if (parser) {
    tryParse(parser, supplierDoc);
  }

  // The supplier's own parser missed rows: the generic parsers read the same text.
  if (!supplier && rejected.length > 0 && generic) {
    const fallback = detectSupplier(supplierDoc, FALLBACK_PARSERS.filter((p) => p !== parser));
    if (fallback && !fallback.scanned) tryParse(fallback, supplierDoc);
  }

  // A scan from a supplier with no parser of its own: read the whole page by OCR, then the generic parsers.
  if (!supplier && rejected.length === 0 && !parser?.scanned && generic && scan && !UNSUPPORTED_SUPPLIERS.some((u) => supplierDoc.text.includes(u.vatId))) {
    const scanned = await readPages();
    if (scanned) {
      textDoc = await ocrDocument(scanned, await scan.ocr(), (done, total) => scan.onProgress?.(done, total));
      const fallback = detectSupplier(textDoc, FALLBACK_PARSERS);
      if (fallback && !fallback.scanned) tryParse(fallback, textDoc);
      if (supplier) (supplier as SupplierInvoice).scanned = true;
    }
  }

  // The backend: the supplier's learned layout, then the AI.
  if (!supplier && remote && config.aiFallback && !UNSUPPORTED_SUPPLIERS.some((u) => textDoc.text.includes(u.vatId))) {
    // A scan the generic parsers did not try (they are off): its layout is learned from what OCR reads.
    const scanned = textDoc !== supplierDoc ? true : scan ? await readPages() : null;
    if (scanned && scanned !== true && scan) {
      textDoc = await ocrDocument(scanned, await scan.ocr(), (done, total) => scan.onProgress?.(done, total));
    }
    const invoice = await readRemotely(remote, input, textDoc, own, textDoc !== supplierDoc);
    supplier = textDoc === supplierDoc ? gate(invoice, invoice.generic === "ai" ? "AI" : "מבנה שנלמד") : invoice;
  }

  // No reading accounts for every row: the one that missed the fewest, with those rows added.
  if (!supplier && rejected.length > 0) {
    const best = [...rejected].sort((a, b) => a.check.uncovered.length - b.check.uncovered.length)[0];
    const invoice = best.invoice;
    invoice.lines.push(...unreadLines(supplierDoc, best.check.uncovered, invoice.lines.length + 1));
    passed = best.check;
    if (best.check.uncovered.length > 0) {
      invoice.warnings.push(
        `${best.check.uncovered.length} שורות בחשבונית לא נקראו אוטומטית ונוספו לפי החשבון שבהן — הן מסומנות, ויש לבדוק אותן מול החשבונית`,
      );
    }
    supplier = invoice;
  }

  if (!supplier) {
    const known = UNSUPPORTED_SUPPLIERS.find((u) => supplierDoc.text.includes(u.vatId));
    if (known) {
      throw new ExtractionError(`חשבונית ${known.name} אינה נתמכת: ${known.reason}`, "UNSUPPORTED_SUPPLIER");
    }
    if (refusal) throw refusal;
    const supported = supplierParsers.filter((p) => !("fallback" in p && p.fallback)).map((p) => p.displayName).join(", ");
    throw new ExtractionError(
      generic
        ? `לא ניתן לקרוא את חשבונית הספק בקובץ "${input.supplierFileName}" באופן אוטומטי: לא נמצאה בה טבלת פריטים שסכומיה מתאימים לסה"כ המודפס. ספקים עם פורמט ייעודי: ${supported}`
        : `הספק בקובץ "${input.supplierFileName}" אינו נתמך עדיין. ספקים נתמכים: ${supported}`,
      "UNSUPPORTED_SUPPLIER",
    );
  }

  const invoice: SupplierInvoice = supplier;
  const kept = passed as ReadingCheck | null;
  if (kept) invoice.excludedRows = kept.excludedRows;
  // Say which readers were passed over, and why: it names the parser to fix.
  for (const r of rejected) {
    invoice.warnings.push(`הקורא "${r.reader}" לא שימש לחשבונית זו: ${r.check.reasons.join("; ")}`);
  }
  if (invoice.lines.length === 0) {
    throw new ExtractionError(`לא נמצאו שורות פריטים בחשבונית ${parser?.displayName ?? "הספק"}`, "NO_LINES");
  }
  if (invoice.generic) nameFromOwnDocument(invoice, own, textDoc);
  if (draftPages.length > 0) {
    invoice.warnings.push(draftPagesWarning(draftPages, input.supplierFileName, config.displayName));
  }
  if (ownDoc.repairedByOcr) own.warnings.push(ocrRepairWarning(input.ownFileName));
  if (supplierDoc.repairedByOcr) invoice.warnings.push(ocrRepairWarning(input.supplierFileName));
  if (textDoc !== supplierDoc && invoice.generic !== "ai") invoice.warnings.push(ocrScanWarning(input.supplierFileName));
  const unprinted = parser && !invoice.generic ? config.unprintedDiscounts?.[parser.id] : undefined;
  if (unprinted != null) applyUnprintedDiscount(invoice, own, unprinted, config.displayName);
  supplier = invoice;

  const digits = (s: string | null) => (s ?? "").replace(/\D/g, "");
  if (own.againstInvoice && !digits(invoice.invoiceNumber).endsWith(digits(own.againstInvoice))) {
    own.warnings.push(
      `חשבונית הטיוטה הופקה כנגד חשבונית ${own.againstInvoice}, אבל חשבונית הספק היא ${invoice.invoiceNumber}`,
    );
  }

  return {
    supplier: invoice,
    own,
    meta: {
      ownFileName: input.ownFileName,
      supplierFileName: input.supplierFileName,
    },
  };
}

/**
 * Steps 3 and 4: the supplier's learned layout if the backend has one for a
 * VAT number on the invoice (the draft's addressee first), else the AI.
 */
async function readRemotely(
  remote: RemoteSupport,
  input: ExtractInput,
  doc: PdfDocument,
  own: OwnInvoice,
  scanned: boolean,
): Promise<SupplierInvoice> {
  const vatHint = own.counterparty?.vatId ?? null;
  const digits = doc.rows.map((r) => r.text).join("\n");
  const vatIds = [...new Set([vatHint, ...vatCandidates(digits)].filter((v): v is string => v != null))];
  for (const profile of await remote.profiles(vatIds).catch(() => [])) {
    try {
      const invoice = parseWithProfile(doc, profile);
      if (scanned) invoice.scanned = true;
      return invoice;
    } catch (err) {
      if (!(err instanceof ExtractionError)) throw err;
      // The layout changed: the AI reads the invoice and learns it again.
    }
  }
  remote.onAiStart?.();
  const invoice = await remote.readWithAi({
    pdf: input.supplierPdf,
    fileName: input.supplierFileName,
    scanned,
    rows: rowsPayload(doc),
    vatHint,
  });
  if (scanned) invoice.scanned = true;
  return invoice;
}

/**
 * A generic parser knows the supplier by VAT number at best (AGROLINE prints
 * the name inside the logo). The wholesaler's draft is addressed to the
 * supplier by name and VAT number: use them when the invoice carries that
 * VAT number.
 */
function nameFromOwnDocument(supplier: SupplierInvoice, own: OwnInvoice, supplierDoc: PdfDocument): void {
  const party = own.counterparty;
  if (!party?.vatId || !supplierDoc.text.includes(party.vatId)) return;
  if (supplier.vatId && supplier.vatId !== party.vatId) return;
  supplier.supplierName = party.name;
  supplier.vatId = party.vatId;
  if (supplier.generic === "table") supplier.supplierId = `generic-${party.vatId}`;
}

/**
 * Blank out the pages of the supplier's file that are the wholesaler's own
 * draft (a supplier may send the invoice with the draft attached). The pages
 * stay as empty pages, so page numbers still match the PDF. A file that is
 * all draft is left alone: the swapped-files check deals with it.
 */
function withoutOwnDraftPages(
  doc: PdfDocument,
  ownParser: OwnDocumentParser,
): { doc: PdfDocument; skipped: number[] } {
  const isDraft = doc.pages.map((rows) =>
    ownParser.detect({ pages: [rows], rows, text: rows.map((r) => r.text).join("\n"), repairedByOcr: doc.repairedByOcr }),
  );
  if (!isDraft.includes(true) || !isDraft.includes(false)) return { doc, skipped: [] };
  const pages = doc.pages.map((rows, i) => (isDraft[i] ? [] : rows));
  const rows = pages.flat();
  return {
    doc: { ...doc, pages, rows, text: rows.map((r) => r.text).join("\n") },
    skipped: isDraft.flatMap((draft, i) => (draft ? [i + 1] : [])),
  };
}

/** "עמודים 5–9" / "עמוד 3" / "עמודים 2, 6–7". */
function draftPagesWarning(pages: number[], fileName: string, customerName: string): string {
  const ranges: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    ranges.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
    i = j + 1;
  }
  const label = pages.length === 1 ? `עמוד ${ranges[0]}` : `עמודים ${ranges.join(", ")}`;
  return `${label} בקובץ "${fileName}" ${pages.length === 1 ? "הוא" : "הם"} חשבונית טיוטה של ${customerName} — ${pages.length === 1 ? "הוא לא נקרא" : "הם לא נקראו"} כחלק מחשבונית הספק`;
}

/**
 * A PDF printed with "Microsoft Print to PDF" (and the like) keeps its digits
 * but loses every Hebrew letter. Read the Hebrew back by OCR when OCR is
 * available; otherwise say how to save the file properly.
 */
async function withMissingText(
  doc: PdfDocument,
  data: Uint8Array,
  fileName: string,
  scan: ScanSupport | undefined,
): Promise<PdfDocument> {
  if (!doc.missingText) return doc;
  if (!scan) {
    throw new ExtractionError(
      `הטקסט העברי בקובץ "${fileName}" אינו קריא (הקובץ הודפס כנראה דרך "Microsoft Print to PDF"). ` +
        `יש לשמור אותו מחדש דרך "שמירה כ-PDF" בחלון ההדפסה`,
      "TEXT_LAYER_BROKEN",
    );
  }
  const ocr = await scan.ocr();
  scan.onProgress?.(0, doc.missingText.items.length);
  return repairMissingText(doc, data, ocr, (done, total) => scan.onProgress?.(done, total));
}

export function ocrScanWarning(fileName: string): string {
  return (
    `החשבונית בקובץ "${fileName}" סרוקה ונקראה ב-OCR. הסכומים אומתו מול הסה"כ המודפס, ` +
    `אך שמות המוצרים ומספרי התעודות עלולים להכיל שגיאות קריאה`
  );
}

export function ocrRepairWarning(fileName: string): string {
  return (
    `הטקסט העברי בקובץ "${fileName}" נקרא ב-OCR (הקובץ הודפס דרך "Microsoft Print to PDF"), ולכן שמות המוצרים עלולים להכיל שגיאות. ` +
    `הסכומים והכמויות נקראו במדויק. בפעם הבאה עדיף לשמור דרך "שמירה כ-PDF"`
  );
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
