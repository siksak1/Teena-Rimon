import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtractionError } from "../src/errors.js";
import { extractInvoices } from "../src/extract.js";
import { agrolineGenericParser } from "../src/parsers/agroline.js";
import { genericTableParser } from "../src/parsers/generic.js";
import { detectSupplier, parsersToTry } from "../src/parsers/registry.js";
import type { TextSupplierParser } from "../src/parsers/types.js";
import { cellText, columnsFromHeader, loadPdf, readRow, type Cell, type PdfDocument, type Row } from "../src/pdf/layout.js";
import { PAIRS, readSample, TEENA_RIMON } from "./helpers.js";

/**
 * Suppliers change their layouts: a column is renamed ("אסמכתא" → "יעד"),
 * added or dropped. A reader may then refuse, but it must never crash, and a
 * crash in one reader must not stop the others.
 */

const cell = (text: string, x: number): Cell => ({ text, x, xMin: x - 5, xMax: x + 5 });
const row = (cells: Cell[]): Row => ({ page: 1, y: 0, cells, text: cells.map((c) => c.text).join("  ") });

describe("column helpers", () => {
  const specs = [
    { key: "name" as const, header: /^שם$/ },
    { key: "ref" as const, header: /^אסמכתא$/, optional: true },
    { key: "total" as const, header: /^סכום$/ },
  ];

  it("recognises a header with an optional column missing, and reads that column as empty", () => {
    const columns = columnsFromHeader(row([cell("שם", 300), cell("סכום", 100)]), specs);
    expect(columns).not.toBeNull();
    const c = readRow(row([cell("תפוז", 300), cell("10.00", 100)]), columns!);
    expect(c.ref).toEqual([]);
    expect(cellText(c.ref)).toBe("");
    expect(cellText(c.name)).toBe("תפוז");
  });

  it("still refuses a header with a required column missing", () => {
    expect(columnsFromHeader(row([cell("שם", 300), cell("אסמכתא", 200)]), specs)).toBeNull();
  });

  it("drops cells printed under a header it does not know, instead of moving them to a neighbour", () => {
    const columns = columnsFromHeader(row([cell("שם", 300), cell("יעד", 200), cell("סכום", 100)]), specs)!;
    const c = readRow(row([cell("תפוז", 300), cell("תאנה ורימון 6101", 205), cell("10.00", 100)]), columns);
    expect(cellText(c.name)).toBe("תפוז");
    expect(cellText(c.total)).toBe("10.00");
  });

  it("reads a missing column as empty text", () => {
    expect(cellText(undefined)).toBe("");
  });
});

/** Fixtures whose supplier invoice is read by a parser driven by the column headers. */
const HEADER_DRIVEN = ["granot", "shivuk", "dhai", "menashri", "haklaim", "galil", "hasor", "kahalon"] as const;

/** The rows above the first row with a money amount: the title block and the table header. */
function headerRows(doc: PdfDocument): Row[] {
  const page = doc.pages[0];
  const first = page.findIndex((r) => r.cells.some((c) => /^-?[\d,]+\.\d{2}$/.test(c.text)));
  return page.slice(0, first === -1 ? page.length : first);
}

/** The document with one cell of one row replaced (or removed, for `null`). */
function mutate(doc: PdfDocument, target: Row, index: number, text: string | null): PdfDocument {
  const swap = (r: Row): Row => {
    if (r !== target) return r;
    const cells = r.cells.flatMap((c, i) => (i !== index ? [c] : text == null ? [] : [{ ...c, text }]));
    return { ...r, cells, text: cells.map((c) => c.text).join("  ") };
  };
  const pages = doc.pages.map((rows) => rows.map(swap));
  const rows = pages.flat();
  return { ...doc, pages, rows, text: rows.map((r) => r.text).join("\n") };
}

describe("a renamed or missing header never crashes a reader", () => {
  for (const name of HEADER_DRIVEN) {
    it(name, async () => {
      const doc = await loadPdf(await readSample(PAIRS[name].supplier));
      const parser = detectSupplier(doc, parsersToTry(TEENA_RIMON)) as TextSupplierParser;
      expect(parser && !parser.scanned).toBeTruthy();
      expect(() => parser.parse(doc)).not.toThrow();

      for (const target of headerRows(doc)) {
        target.cells.forEach((_, i) => {
          for (const text of ["XYZ", null]) {
            const changed = mutate(doc, target, i, text);
            try {
              parser.parse(changed);
            } catch (err) {
              if (!(err instanceof ExtractionError)) {
                throw new Error(`${parser.id}: "${target.cells[i].text}" → ${text ?? "(removed)"}: ${String(err)}`);
              }
            }
          }
        });
      }
    });
  }

  const OPTIONAL_AGROLINE = new Set(["ת.משלוח", "משטח", "אסמכתא", "גודל", "אריזה", "כמות"]);

  for (const name of ["dhai", "menashri", "kahalon"] as const) {
    it(`${name}: an AGROLINE invoice with an optional column renamed reads the same amounts`, async () => {
      const doc = await loadPdf(await readSample(PAIRS[name].supplier));
      const parser = detectSupplier(doc, parsersToTry(TEENA_RIMON)) as TextSupplierParser;
      const amounts = (d: PdfDocument) => parser.parse(d).lines.map((l) => l.lineTotal);
      const expected = amounts(doc);
      const header = doc.pages[0].find((r) => r.cells.some((c) => c.text === "תוצרת/זן/איכות"))!;
      const optional = header.cells.flatMap((c, i) => (OPTIONAL_AGROLINE.has(c.text) ? [i] : []));
      expect(optional.length).toBeGreaterThan(0);
      for (const i of optional) expect(amounts(mutate(doc, header, i, "XYZ"))).toEqual(expected);
    });
  }
});

describe("a reader that crashes does not stop the others", () => {
  afterEach(() => vi.restoreAllMocks());

  const kahalon = async () =>
    extractInvoices(
      {
        ownPdf: await readSample(PAIRS.kahalon.own),
        supplierPdf: await readSample(PAIRS.kahalon.supplier),
        ownFileName: "own.pdf",
        supplierFileName: "supplier.pdf",
      },
      TEENA_RIMON,
    );

  it("moves on to the next reader and says which one failed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(agrolineGenericParser, "parse").mockImplementation(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'map')");
    });
    const result = await kahalon();
    expect(result.supplier.lines.length).toBeGreaterThan(0);
    expect(result.supplier.warnings.some((w) => w.includes(agrolineGenericParser.displayName) && w.includes("נכשל"))).toBe(true);
  });

  it("fails with a Hebrew error, not the JavaScript one, when every reader crashes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const p of [agrolineGenericParser, genericTableParser]) {
      vi.spyOn(p, "parse").mockImplementation(() => {
        throw new TypeError("boom");
      });
    }
    const err = await kahalon().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as ExtractionError).code).toBe("PARSER_FAILED");
    expect((err as ExtractionError).message).not.toContain("boom");
  });
});
