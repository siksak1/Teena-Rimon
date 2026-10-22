import type { SupplierInvoice, SupplierLine } from "../model.js";
import type { Cell, PdfDocument, Row } from "../pdf/layout.js";
import { hasHebrew, parseDate, parseNumber, round2 } from "../pdf/text.js";
import type { TextSupplierParser } from "./types.js";
import { checkTotal } from "./validate.js";

/** "1,720.00", and a credit's "-50.00" or "50.00-". */
const MONEY = /^-?[\d,]+\.\d{2}-?$/;
/** The items total: "תוצרת: 26,079.40", or ":תוצרת" with the colon on the other side in some printouts. */
const ITEMS_TOTAL = /תוצרת:|:תוצרת/;
/** Rows the footer adds back as "אריזה" / "משטחים": pallets and containers ("מיכלים"). */
const PACKAGING = /^(משטח|מיכל)/;

/**
 * Levi Tzadok & Sons (לוי צדוק ובניו) tax invoice — a fixed-width printout
 * where every word is its own cell. A row reads, right to left: delivery
 * number, "d/mm" date (no year), description words, packages, weight, unit
 * price, line total. Packages or weight may be blank; unit-priced rows have
 * no weight. Credits (returns) print their amounts negative. Pallet and
 * container rows ("משטח …", "מיכלים") are left out — the footer adds them
 * back as "אריזה" / "משטחים" after "סה"כ תוצרת", the items total.
 */
export const leviParser: TextSupplierParser = {
  id: "levi",
  displayName: "לוי צדוק",

  detect(doc) {
    return doc.text.includes("511051815");
  },

  parse(doc: PdfDocument): SupplierInvoice {
    const lines: SupplierLine[] = [];
    const warnings: string[] = [];
    const invoiceDate = parseDate(doc.text.match(/תאריך:\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/)?.[1]);

    pages: for (const rows of doc.pages) {
      let header: { packages: number; weight: number } | null = null;
      for (const row of rows) {
        if (!header) {
          header = headerColumns(row);
          continue;
        }
        if (ITEMS_TOTAL.test(row.text)) break pages;

        const [docCell, dateCell, ...rest] = row.cells;
        if (!docCell || !/^\d{5,7}$/.test(docCell.text) || !/^\d{1,2}\/\d{1,2}$/.test(dateCell?.text ?? "")) continue;
        const descriptionStart = header.packages + 30;
        const words = rest.filter((c) => hasHebrew(c.text) || c.x > descriptionStart);
        const description = words.map((c) => c.text).join(" ");
        if (PACKAGING.test(description)) continue;

        const numbers = rest.filter((c) => !words.includes(c));
        const totalCell = numbers.at(-1);
        const priceCell = numbers.at(-2);
        if (!totalCell || !priceCell || !MONEY.test(totalCell.text)) continue;
        const { packages, weight } = packagesAndWeight(numbers.slice(0, -2), header);
        const quantity = weight ?? packages;
        if (quantity == null) continue;

        lines.push({
          id: `S${lines.length + 1}`,
          page: row.page,
          date: rowDate(dateCell.text, invoiceDate),
          docNumber: docCell.text,
          bookRef: null,
          description,
          variety: "",
          sku: null,
          packages,
          quantity,
          unit: weight != null ? 'ק"ג' : "יח'",
          unitPrice: signed(priceCell.text) ?? 0,
          discountPct: 0,
          lineTotal: signed(totalCell.text)!,
        });
      }
    }

    const sum = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
    const printedItemsTotal = parseNumber(
      doc.rows.flatMap((r) => r.cells).find((c) => ITEMS_TOTAL.test(c.text))?.text,
    );
    checkTotal("חשבונית לוי צדוק", sum, printedItemsTotal, warnings);

    return {
      supplierId: "levi",
      supplierName: "לוי צדוק",
      invoiceNumber: doc.text.match(/חשבונית\s+מס\s+מספר\s+(\d+)/)?.[1] ?? "",
      invoiceDate,
      lines,
      printedItemsTotal,
      warnings,
    };
  },
};

/** The second header line: "… תאריך  סחורה  כמות  משקל  מחיר  סחורה …". */
function headerColumns(row: Row): { packages: number; weight: number } | null {
  const at = (label: string) => row.cells.find((c) => c.text === label)?.x;
  const packages = at("כמות");
  const weight = at("משקל");
  return packages != null && weight != null && at("תאריך") != null ? { packages, weight } : null;
}

/** Packages and weight sit under their headers; either may be blank. */
function packagesAndWeight(cells: Cell[], header: { packages: number; weight: number }) {
  let packages: number | null = null;
  let weight: number | null = null;
  for (const cell of cells) {
    const value = signed(cell.text);
    if (Math.abs(cell.x - header.packages) < Math.abs(cell.x - header.weight)) packages = value;
    else weight = value;
  }
  return { packages, weight };
}

/** A number whose minus may print after it ("20.0-"), as well as before. */
function signed(text: string): number | null {
  const value = parseNumber(text);
  return value != null && value > 0 && text.trim().endsWith("-") ? -value : value;
}

/** "2/09" → ISO, with the invoice's year (the year before for months after the invoice's). */
function rowDate(dayMonth: string, invoiceDate: string | null): string | null {
  if (!invoiceDate) return null;
  const [day, month] = dayMonth.split("/").map(Number);
  const [year, invoiceMonth] = invoiceDate.split("-").map(Number);
  const y = month > invoiceMonth ? year - 1 : year;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
