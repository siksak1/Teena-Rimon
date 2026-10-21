import type { CustomerConfig } from "../customer.js";
import type { ExtractionResult } from "../model.js";
import { round2 } from "../pdf/text.js";
import { prepare } from "../reconcile/prepare.js";
import { matcherFor } from "../reconcile/reconcile.js";
import { normalizeRef } from "../reconcile/references.js";

/**
 * The comparison the Excel export writes: one row per delivery note and
 * product, with each report's weight and cost side by side. Rows are keyed by
 * grower (as paired across the reports), delivery-note reference and product
 * family, so "אבטיח קרטון" ↔ "אבטיח" or "פלפל אדום XL" ↔ "פלפל" on the same
 * note share a row whatever day each report put it on.
 */
export type SummarySide = {
  weight: number;
  /** Σ weight × price; null when a line has price 0 — the price still has to be filled in. */
  cost: number | null;
  lines: number;
};

export type SummaryRow = {
  /** ISO date: the supplier's, else Teena-Rimon's. */
  date: string | null;
  ref: string;
  grower: string;
  product: string;
  supplier: SummarySide;
  own: SummarySide;
  /** Own minus supplier, the app's sign everywhere. */
  weightDiff: number;
  costDiff: number | null;
};

export type ExcelSummary = {
  rows: SummaryRow[];
  /** Rows only in the own report, dated outside the supplier report's period. */
  outOfPeriod: SummaryRow[];
};

type Line = { date: string | null; grower: string; product: string; weight: number; price: number };
type Bucket = { ref: string; party: string; supplier: Line[]; own: Line[] };

export function summarizeExcel(extraction: ExtractionResult, config: CustomerConfig): ExcelSummary {
  const { supplier, own } = prepare(extraction, matcherFor(config), config);
  const buckets = new Map<string, Bucket>();
  const namesByParty = new Map<string, Set<string>>();
  const add = (side: "supplier" | "own", party: string, ref: string, family: string, line: Line) => {
    const key = `${party}|${ref}|${family}`;
    const bucket = buckets.get(key) ?? { ref, party, supplier: [], own: [] };
    bucket[side].push(line);
    buckets.set(key, bucket);
    namesByParty.set(party, (namesByParty.get(party) ?? new Set()).add(line.grower));
  };

  for (const s of supplier) {
    const { line } = s;
    add("supplier", s.party ?? "", normalizeRef(line.docNumber) ?? "", s.name.family ?? line.description, {
      date: line.date,
      grower: line.grower ?? "",
      product: line.description,
      weight: line.quantity,
      price: line.unitPrice,
    });
  }
  for (const t of own) {
    const { line } = t;
    add("own", t.party ?? "", t.ref ?? "", t.name.family ?? line.product, {
      date: line.date,
      grower: line.grower ?? "",
      product: line.product,
      weight: line.quantity,
      price: line.unitPrice,
    });
  }

  const supplierDates = supplier.map((s) => s.line.date).filter((d): d is string => Boolean(d)).sort();
  const from = supplierDates[0];
  const to = supplierDates[supplierDates.length - 1];

  const rows: SummaryRow[] = [];
  const outOfPeriod: SummaryRow[] = [];
  for (const b of buckets.values()) {
    const row = toRow(b, namesByParty.get(b.party) ?? new Set());
    const outside = row.date != null && from != null && (row.date < from || row.date > to);
    (b.supplier.length === 0 && outside ? outOfPeriod : rows).push(row);
  }
  return { rows: rows.sort(byRef), outOfPeriod: outOfPeriod.sort(byRef) };
}

function toRow(b: Bucket, growerNames: Set<string>): SummaryRow {
  const supplier = side(b.supplier);
  const own = side(b.own);
  const dates = (b.supplier.length ? b.supplier : b.own).map((l) => l.date).filter((d): d is string => Boolean(d));
  return {
    date: dates.sort()[0] ?? null,
    ref: b.ref,
    grower: shortest([...growerNames]),
    product: commonName([...b.supplier, ...b.own].map((l) => l.product)),
    supplier,
    own,
    weightDiff: round2(own.weight - supplier.weight),
    costDiff: supplier.cost == null || own.cost == null ? null : round2(own.cost - supplier.cost),
  };
}

function side(lines: Line[]): SummarySide {
  return {
    weight: round2(lines.reduce((sum, l) => sum + l.weight, 0)),
    cost: lines.some((l) => l.price === 0) ? null : round2(lines.reduce((sum, l) => sum + l.weight * l.price, 0)),
    lines: lines.length,
  };
}

/** "ביטן ראובן" over "ביטן ראובן חקלאות בע"מ": the shortest spelling of the grower. */
function shortest(names: string[]): string {
  return names.filter(Boolean).sort((a, b) => a.length - b.length)[0] ?? "";
}

/**
 * The name every other name extends ("פלפל" of "פלפל אדום XL", "אבטיח" of
 * "אבטיח קרטון"); without one, the names themselves, most frequent first.
 */
function commonName(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  const distinct = [...counts.keys()].sort((a, b) => counts.get(b)! - counts.get(a)! || a.localeCompare(b, "he"));
  const words = (n: string) => n.trim().split(/\s+/);
  const within = (a: string, b: string) => words(a).every((w) => words(b).includes(w));
  const base = distinct
    .filter((a) => distinct.every((b) => within(a, b)))
    .sort((a, b) => words(a).length - words(b).length)[0];
  return base ?? distinct.join(" / ");
}

function byRef(a: SummaryRow, b: SummaryRow): number {
  const na = a.ref ? Number(a.ref) : Infinity;
  const nb = b.ref ? Number(b.ref) : Infinity;
  return na - nb || (a.date ?? "").localeCompare(b.date ?? "") || a.product.localeCompare(b.product, "he");
}
