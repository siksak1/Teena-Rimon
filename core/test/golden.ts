import type { ExtractionResult, MatchGroup, ReconciliationResult } from "../src/model.js";

/**
 * The part of a reconciliation the golden files pin down: what was read, how
 * rows were grouped, and every gap the user sees. Leaves out internal ranking
 * scores, so tuning the score weights doesn't rewrite every file — only
 * changes in what the user would see do.
 */
export function goldenSummary(extraction: ExtractionResult, result: ReconciliationResult) {
  const { supplier, own } = extraction;
  return {
    supplier: {
      parser: supplier.supplierId,
      invoiceNumber: supplier.invoiceNumber,
      lines: supplier.lines.length,
      printedItemsTotal: supplier.printedItemsTotal,
      warnings: supplier.warnings,
    },
    own: {
      documentNumber: own.documentNumber,
      againstInvoice: own.againstInvoice,
      lines: own.lines.length,
      commercialDiscount: own.commercialDiscount,
      discountPct: round6(own.discountPct),
      warnings: own.warnings,
    },
    totals: { ...result.totals, ownDiscountPct: round6(result.totals.ownDiscountPct) },
    groups: result.groups.map(group),
    supplierOnly: result.supplierOnly.map((l) => l.id),
    ownOnly: result.ownOnly.map((l) => l.id),
    offset: {
      applies: result.offset.applies,
      groups: result.offset.groups.map((g) => rows(g)),
    },
    dictionarySuggestions: result.dictionarySuggestions,
  };
}

function group(g: MatchGroup) {
  return {
    rows: rows(g),
    flags: g.flags,
    netDiff: g.netDiff,
    quantityDiff: g.quantityDiff,
    packagesDiff: g.packagesDiff,
    dateDelta: g.dateDelta,
    notes: g.notes,
  };
}

/** "S1+S2→T3": the rows in the group, in the engine's order. */
function rows(g: MatchGroup): string {
  return `${g.supplierLines.map((l) => l.id).join("+")}→${g.ownLines.map((l) => l.id).join("+")}`;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
