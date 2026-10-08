import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// The production build, served under a fake token with production headers (e2e/serve.mjs).
const APP = "/e2e-test-token-0123456789/";
const ANALYTICS = "https://eu.i.posthog.com/";
const sample = (name: string) => fileURLToPath(new URL(`../../sample_data/${name}`, import.meta.url));

type Watch = {
  /** Every request the page made: "METHOD url". */
  requests: string[];
  /** Bodies sent to the analytics endpoint (intercepted — nothing reaches PostHog). */
  analytics: { event: string; properties: Record<string, unknown> }[];
  consoleErrors: string[];
  violations: () => Promise<string[]>;
};

async function open(page: Page): Promise<Watch> {
  const watch: Omit<Watch, "violations"> = { requests: [], analytics: [], consoleErrors: [] };
  page.on("request", (r) => watch.requests.push(`${r.method()} ${r.url()}`));
  page.on("console", (m) => m.type() === "error" && watch.consoleErrors.push(m.text()));
  await page.route(`${ANALYTICS}**`, async (route) => {
    watch.analytics.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __violations: string[] };
    w.__violations = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__violations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(APP);
  return {
    ...watch,
    violations: () => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations),
  };
}

async function compare(page: Page, own: string, supplier: string) {
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(sample(own));
  await inputs.nth(1).setInputFiles(sample(supplier));
  await page.getByRole("button", { name: "השוואת החשבוניות" }).click();
}

/** Same-origin GETs of the app's own files, or the one analytics POST. */
function unexpectedRequests(watch: Watch, baseURL: string): string[] {
  return watch.requests.filter(
    (r) => !r.startsWith(`GET ${baseURL}${APP}`) && r !== `POST ${ANALYTICS}i/v0/e/`,
  );
}

test("is not indexable and runs under the production security headers", async ({ page }) => {
  const response = await page.goto(APP);
  const headers = response!.headers();
  expect(headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["content-security-policy"]).toContain("connect-src https://eu.i.posthog.com;");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("השוואת חשבונית ספק מול תאנה ורימון");
  await expect(page.locator(".site-foot")).toContainText("תצורה 1");
});

test("reconciles real invoices in the browser; only a counts-only event leaves the page", async ({ page, baseURL }) => {
  const watch = await open(page);
  await compare(page, "גרנות אצל תאנה ורימון.pdf", "גרנות 17.09.pdf");

  await expect(page.locator(".results h2")).toContainText("גרנות · חשבונית SI26602203");
  await expect(page.locator(".total-card--hot strong")).toContainText("2,857.77");

  await expect.poll(() => watch.analytics.length).toBe(1);
  const [event] = watch.analytics;
  expect(event.event).toBe("reconciliation_completed");
  expect(event.properties).toMatchObject({ customer: "teena-rimon", supplier_lines: 29, own_lines: 25, discrepancy_amount_nis: 2860 });
  const body = JSON.stringify(event);
  for (const fromInvoice of ["גרנות", "SI26602203", "פיטאיה", ".pdf"]) expect(body).not.toContain(fromInvoice);

  expect(unexpectedRequests(watch, baseURL!)).toEqual([]);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("reports a failure by error code only", async ({ page, baseURL }) => {
  const watch = await open(page);
  await compare(page, "הר הקור אצל תאנה ורימון.pdf", "הר-קור.pdf");

  await expect(page.locator(".banner--error")).toContainText("החשבונית סרוקה");
  await expect.poll(() => watch.analytics.length).toBe(1);
  expect(watch.analytics[0]).toMatchObject({
    event: "reconciliation_failed",
    properties: { error_code: "UNSUPPORTED_SUPPLIER" },
  });
  expect(JSON.stringify(watch.analytics[0])).not.toContain("הר");
  expect(unexpectedRequests(watch, baseURL!)).toEqual([]);
  expect(await watch.violations()).toEqual([]);
});

test("the browser blocks sending data anywhere else, even to our own server", async ({ page }) => {
  const watch = await open(page);
  const attempt = (url: string) =>
    page.evaluate((u) => fetch(u, { method: "POST", body: "invoice" }).then(() => "sent", () => "blocked"), url);

  expect(await attempt("https://example.com/upload")).toBe("blocked");
  expect(await attempt(`${APP}upload`)).toBe("blocked");
  expect(await watch.violations()).toEqual([
    "connect-src https://example.com/upload",
    expect.stringMatching(/^connect-src http:\/\/127\.0\.0\.1:\d+\/e2e-test-token-0123456789\/upload$/),
  ]);
});
