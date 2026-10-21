import { describe, expect, it, vi } from "vitest";
import { ExtractionError } from "../src/errors.js";
import { extractInvoices } from "../src/extract.js";
import type { SupplierInvoice } from "../src/model.js";
import type { SupplierProfile } from "../src/parsers/profile.js";
import type { AiRequest, RemoteSupport } from "../src/remote.js";
import { PAIRS, readSample, TEENA_RIMON } from "./helpers.js";

/**
 * After every reader in the browser refused: the supplier's learned layout
 * (fetched by VAT number, applied locally), and only then the AI. Gilboa's
 * invoice with the generic parser switched off stands in for a format nothing
 * in the browser can read.
 */
const GILBOA: SupplierProfile = {
  vatId: "570046193",
  name: "גזר בגלבוע",
  version: 1,
  createdAt: "2026-10-20T00:00:00Z",
  source: "pdf",
  headers: { תאריך: "date", "מספר פנקס": "bookRef", 'מק"ט': "sku", "תאור מוצר": "description", כמות: "quantity", "מחיר ליחידה": "unitPrice", 'סה"כ מחיר': "total" },
  amountColumns: { quantity: "כמות", unitPrice: "מחיר ליחידה", total: 'סה"כ מחיר' },
  totalLabel: 'סכום פטור ממע"מ',
  invoiceNumberLabel: "חשבונית מס מרכזת",
  dateLabel: "תאריך חשבונית",
  discountSource: "none",
};

const NOTHING_LOCAL = { ...TEENA_RIMON, suppliers: ["granot"], genericFallback: false, aiFallback: true };

const AI_INVOICE: SupplierInvoice = {
  supplierId: "ai-570046193",
  supplierName: "גזר בגלבוע",
  vatId: "570046193",
  invoiceNumber: "SI266000380",
  invoiceDate: "2026-09-30",
  printedItemsTotal: 10,
  lines: [
    { id: "S1", page: 1, date: "2026-08-31", docNumber: null, bookRef: "263125", description: "גזר", variety: "", sku: null, packages: null, quantity: 5, unit: "ק\"ג", unitPrice: 2, discountPct: 0, lineTotal: 10 },
  ],
  warnings: [],
  generic: "ai",
};

function stub(profiles: SupplierProfile[], ai: () => Promise<SupplierInvoice> = async () => structuredClone(AI_INVOICE)) {
  return {
    profiles: vi.fn(async (_vatIds: string[]) => profiles),
    readWithAi: vi.fn((_request: AiRequest) => ai()),
    onAiStart: vi.fn(),
  } satisfies RemoteSupport;
}

async function gilboa(config: typeof NOTHING_LOCAL, remote?: RemoteSupport) {
  return extractInvoices(
    {
      ownPdf: await readSample(PAIRS.gilboa.own),
      supplierPdf: await readSample(PAIRS.gilboa.supplier),
      ownFileName: "own.pdf",
      supplierFileName: "supplier.pdf",
    },
    config,
    undefined,
    remote,
  );
}

describe("learned layout, then AI", () => {
  it("reads the invoice with the supplier's learned layout, without calling the AI", async () => {
    const remote = stub([GILBOA]);
    const result = await gilboa(NOTHING_LOCAL, remote);
    expect(result.supplier).toMatchObject({ generic: "profile", vatId: "570046193" });
    expect(result.supplier.lines).toHaveLength(29);
    // The draft's addressee is asked for first.
    expect(remote.profiles.mock.calls[0][0][0]).toBe("570046193");
    expect(remote.readWithAi).not.toHaveBeenCalled();
  });

  it("sends the invoice to the AI when no layout is known, with the rows it read and the VAT hint", async () => {
    const remote = stub([]);
    const result = await gilboa(NOTHING_LOCAL, remote);
    expect(result.supplier.generic).toBe("ai");
    expect(remote.onAiStart).toHaveBeenCalledOnce();
    const [request] = remote.readWithAi.mock.calls[0]!;
    expect(request).toMatchObject({ fileName: "supplier.pdf", scanned: false, vatHint: "570046193" });
    expect(request.rows.length).toBeGreaterThan(30);
    expect(request.pdf.byteLength).toBeGreaterThan(1000);
  });

  it("asks the AI again when the learned layout no longer fits (the supplier changed its layout)", async () => {
    const stale = { ...GILBOA, amountColumns: { quantity: "משקל", unitPrice: "מחיר לק\"ג", total: "סכום" } };
    const remote = stub([stale]);
    const result = await gilboa(NOTHING_LOCAL, remote);
    expect(result.supplier.generic).toBe("ai");
    expect(remote.readWithAi).toHaveBeenCalledOnce();
  });

  it("still reads the invoice when the profile lookup fails (backend down), by the AI path's own error", async () => {
    const remote = stub([], async () => {
      throw new ExtractionError("השירות אינו זמין", "AI_UNAVAILABLE");
    });
    remote.profiles.mockRejectedValueOnce(new Error("network"));
    await expect(gilboa(NOTHING_LOCAL, remote)).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });

  it("never contacts the backend when the customer has not turned the AI on", async () => {
    const remote = stub([GILBOA]);
    await expect(gilboa({ ...NOTHING_LOCAL, aiFallback: false }, remote)).rejects.toMatchObject({ code: "UNSUPPORTED_SUPPLIER" });
    expect(remote.profiles).not.toHaveBeenCalled();
  });

  it("never contacts the backend for an invoice the browser can read", async () => {
    const remote = stub([]);
    const result = await gilboa({ ...NOTHING_LOCAL, genericFallback: true }, remote);
    expect(result.supplier.generic).toBe("table");
    expect(remote.profiles).not.toHaveBeenCalled();
    expect(remote.readWithAi).not.toHaveBeenCalled();
  });
});
