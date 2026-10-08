import type { CustomerConfig } from "./customer.js";
import type { ExtractionErrorCode } from "./errors.js";
import type { ReconciliationResult } from "./model.js";

/**
 * Usage analytics: counts only. Everything sent is built here, from numbers
 * and from fixed values (customer slug, app version, browser family, error
 * code) — never from text read out of an invoice, a file name, or the page
 * URL. `analytics.test.ts` checks the exact property list.
 */

export type AnalyticsContext = {
  config: CustomerConfig;
  /** e.g. "1.0.0+9a9d764" */
  appVersion: string;
  /** Browser family and major version, e.g. "chrome-129" (see `browserFamily`). */
  browser: string;
};

export type CompletedProperties = {
  customer: string;
  app_version: string;
  config_version: number;
  browser: string;
  supplier_lines: number;
  own_lines: number;
  matched_groups: number;
  discrepancy_count: number;
  unmatched_supplier: number;
  unmatched_own: number;
  /** Only when the customer's config opts in; |net gap| rounded to ₪10. */
  discrepancy_amount_nis?: number;
  offset_applied: boolean;
  parser_warnings: number;
  parse_ms: number;
  reconcile_ms: number;
};

export type FailedProperties = {
  customer: string;
  app_version: string;
  config_version: number;
  browser: string;
  error_code: ExtractionErrorCode | "INTERNAL";
};

export type AnalyticsEvent =
  | { event: "reconciliation_completed"; properties: CompletedProperties }
  | { event: "reconciliation_failed"; properties: FailedProperties };

export function completedEvent(
  ctx: AnalyticsContext,
  result: ReconciliationResult,
  lines: { supplier: number; own: number },
  timings: { parseMs: number; reconcileMs: number },
): AnalyticsEvent {
  const properties: CompletedProperties = {
    ...common(ctx),
    supplier_lines: lines.supplier,
    own_lines: lines.own,
    matched_groups: result.groups.length,
    discrepancy_count: result.groups.filter((g) => g.flags.length > 0).length,
    unmatched_supplier: result.supplierOnly.length,
    unmatched_own: result.ownOnly.length,
    offset_applied: result.offset.applies,
    parser_warnings: result.warnings.length,
    parse_ms: Math.round(timings.parseMs),
    reconcile_ms: Math.round(timings.reconcileMs),
  };
  if (ctx.config.analytics.sendDiscrepancyAmount) {
    properties.discrepancy_amount_nis = Math.round(Math.abs(result.totals.diff) / 10) * 10;
  }
  return { event: "reconciliation_completed", properties };
}

export function failedEvent(ctx: AnalyticsContext, code: ExtractionErrorCode | "INTERNAL"): AnalyticsEvent {
  return { event: "reconciliation_failed", properties: { ...common(ctx), error_code: code } };
}

function common(ctx: AnalyticsContext) {
  return {
    customer: ctx.config.slug,
    app_version: ctx.appVersion,
    config_version: ctx.config.configVersion,
    browser: ctx.browser,
  };
}

/**
 * The PostHog capture body. `distinct_id` is the customer, not a person, and
 * person profiles are off: nothing identifies who ran the check.
 */
export function posthogBody(apiKey: string, e: AnalyticsEvent) {
  return {
    api_key: apiKey,
    event: e.event,
    distinct_id: e.properties.customer,
    properties: { ...e.properties, $process_person_profile: false },
  };
}

/** "chrome-129", "edge-129", "firefox-131", "safari-18" or "other" — no full user-agent string. */
export function browserFamily(userAgent: string): string {
  const patterns: [string, RegExp][] = [
    ["edge", /Edg\/(\d+)/],
    ["firefox", /Firefox\/(\d+)/],
    ["chrome", /Chrome\/(\d+)/],
    ["safari", /Version\/(\d+).*Safari\//],
  ];
  for (const [name, re] of patterns) {
    const match = userAgent.match(re);
    if (match) return `${name}-${match[1]}`;
  }
  return "other";
}
