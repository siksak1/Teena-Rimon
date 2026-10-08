import type { SupplierInvoice, SupplierLine } from "../model.js";
import { amountOnRow, columnsFromHeader, type PdfDocument } from "../pdf/layout.js";
import { parseDate, parseNumber, round2 } from "../pdf/text.js";
import type { SupplierParser } from "./types.js";
import { checkTotal } from "./validate.js";

const HEADER = [
  { key: "sku", header: /^מס\.פריט$/ },
  { key: "description", header: /^שם פריט$/ },
  { key: "total", header: /^סה"כ שורה$/ },
];

/** "01/09/2026 53215 ת.מ משלוח" — opens the rows of one delivery. */
const DELIVERY = /(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d+)\s+ת\.מ משלוח/;
const AMOUNT = /^[\d,]+\.\d{2}$/;

/**
 * Bananot Carmel (בננות כרמל) tax invoice, printed by Integral. Each delivery
 * starts with a row "<date> <number> ת.מ משלוח"; item rows below it read
 * SKU ("2*"), name, packages, weight, unit price, line total. The quantity
 * header is a single merged cell, so the four amounts are taken by position.
 * Pallet-deposit rows ("משטח פקדון") and page carry-overs are left out; the
 * table ends at "סה"כ ש"ח". No discount is printed.
 */
export const carmelParser: SupplierParser = {
  id: "carmel",
  displayName: "בננות כרמל",

  detect(doc) {
    return doc.text.includes("511290579");
  },

  parse(doc: PdfDocument): SupplierInvoice {
    const lines: SupplierLine[] = [];
    const warnings: string[] = [];
    let date: string | null = null;
    let docNumber: string | null = null;

    pages: for (const rows of doc.pages) {
      let inTable = false;
      for (const row of rows) {
        if (!inTable) {
          inTable = columnsFromHeader(row, HEADER) != null;
          continue;
        }
        if (row.text.includes('סה"כ ש"ח')) break pages;
        if (row.text.includes('סה"כ להעברה')) continue;

        const delivery = row.text.match(DELIVERY);
        if (delivery) {
          date = parseDate(delivery[1]);
          docNumber = delivery[2];
          continue;
        }

        const [skuCell, ...rest] = [...row.cells].sort((a, b) => b.x - a.x);
        const amounts = rest.filter((c) => AMOUNT.test(c.text)).map((c) => parseNumber(c.text)!);
        const description = rest
          .filter((c) => !AMOUNT.test(c.text))
          .map((c) => c.text)
          .join(" ");
        const sku = skuCell?.text.replace(/\*/g, "") ?? "";
        if (!/^\d+$/.test(sku) || amounts.length !== 4 || !description) continue;
        if (description.startsWith("משטח")) continue;

        const [packages, quantity, unitPrice, lineTotal] = amounts;
        lines.push({
          id: `S${lines.length + 1}`,
          page: row.page,
          date,
          docNumber,
          bookRef: null,
          description,
          variety: "",
          sku,
          packages,
          quantity,
          unit: "",
          unitPrice,
          discountPct: 0,
          lineTotal,
        });
      }
    }

    const sum = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const printedItemsTotal = amountOnRow(doc, 'פטור מע"מ');
    checkTotal("חשבונית בננות כרמל", sum, printedItemsTotal, warnings);

    return {
      supplierId: "carmel",
      supplierName: "בננות כרמל",
      invoiceNumber: doc.text.match(/חשבונית מס מספר\s+(\d+)/)?.[1] ?? "",
      invoiceDate: parseDate(doc.text.match(/תאריך:\s+(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1]),
      lines,
      printedItemsTotal,
      warnings,
    };
  },
};
