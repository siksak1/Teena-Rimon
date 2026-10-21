import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// The production build, served under a fake token with production headers (e2e/serve.mjs).
const APP = "/e2e-test-token-0123456789/";
const ANALYTICS = "https://eu.i.posthog.com/";
/** The fake AI backend the e2e build points at (VITE_AI_ENDPOINT in npm run e2e); answered by page.route. */
const AI = "https://ai.e2e.test/";
const sample = (name: string) => fileURLToPath(new URL(`../../sample_data/${name}`, import.meta.url));
const repoFile = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

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
  expect(headers["content-security-policy"]).toContain(`connect-src https://eu.i.posthog.com ${AI};`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow, noarchive");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("השוואת חשבונית ספק מול תאנה ורימון");
  await expect(page.locator(".site-foot")).toContainText("תצורה 6");
  await expect(page.locator(".site-foot")).toContainText("נשלחת לקריאה בעזרת AI");
});

test("reconciles real invoices in the browser; only a counts-only event leaves the page", async ({ page, baseURL }) => {
  const watch = await open(page);
  await compare(page, "גרנות אצל תאנה ורימון.pdf", "גרנות 17.09.pdf");

  await expect(page.locator(".results h2")).toContainText("גרנות · חשבונית SI26602203");
  await expect(page.locator(".total-card--hot strong")).toContainText("2,857.77");

  await expect.poll(() => watch.analytics.length).toBe(1);
  const [event] = watch.analytics;
  expect(event.event).toBe("reconciliation_completed");
  expect(event.properties).toMatchObject({ customer: "teena-rimon", internal: false, supplier_lines: 29, own_lines: 25, discrepancy_amount_nis: 2860 });
  const body = JSON.stringify(event);
  for (const fromInvoice of ["גרנות", "SI26602203", "פיטאיה", ".pdf"]) expect(body).not.toContain(fromInvoice);

  expect(unexpectedRequests(watch, baseURL!)).toEqual([]);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("reads a scanned invoice by OCR in the browser; nothing but the counts-only event leaves the page", async ({ page, baseURL }) => {
  const watch = await open(page);
  await compare(page, "הר הקור אצל תאנה ורימון.pdf", "הר-קור.pdf");

  await expect(page.locator(".results h2")).toContainText("הר-קור · חשבונית 111081", { timeout: 60_000 });
  await expect(page.locator(".banner--scan")).toContainText("כל השורות אומתו");
  await expect(page.locator(".ocr-mark")).toHaveCount(0);
  await expect(page.locator(".total-card--hot strong")).toContainText("595.68");

  await expect.poll(() => watch.analytics.length).toBe(1);
  expect(watch.analytics[0]).toMatchObject({
    event: "reconciliation_completed",
    properties: { supplier_lines: 34, supplier_scanned: true, ocr_uncertain_lines: 0 },
  });
  expect(JSON.stringify(watch.analytics[0])).not.toMatch(/[א-ת]|111081/);
  // The OCR engine and its models are the app's own script chunks: no fetch, no CSP exception.
  expect(unexpectedRequests(watch, baseURL!)).toEqual([]);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("reads a draft printed with Microsoft Print to PDF by OCR in the browser", async ({ page, baseURL }) => {
  const watch = await open(page);
  await compare(page, "גליל טטיט.pdf", "גליל שוק מקומי.pdf");

  await expect(page.locator(".results h2")).toContainText("גליל שוק מקומי", { timeout: 60_000 });
  await expect(page.locator(".results__meta")).toContainText("10032");
  await expect(page.locator(".banner--warn")).toContainText("נקרא ב-OCR");
  await expect(page.getByText("סלק אדום").first()).toBeVisible();

  // Rendering the page for OCR is local: no fetch, no CSP exception.
  expect(unexpectedRequests(watch, baseURL!)).toEqual([]);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("reads a supplier with no parser of its own and names it from the draft", async ({ page, baseURL }) => {
  const watch = await open(page);
  await compare(page, "משק דודו אצל תאנה ורימון.pdf", "משק דודו.pdf");

  await expect(page.locator(".results h2")).toContainText('משק דודו מרום בע"מ · חשבונית 31267');
  await expect(page.locator(".eyebrow .chip")).toHaveText("פורמט כללי");
  await expect(page.locator(".count-strip")).toContainText("רק אצל הספק: 0");

  await expect.poll(() => watch.analytics.length).toBe(1);
  expect(JSON.stringify(watch.analytics[0])).not.toMatch(/[א-ת]|31267|513241455/);
  expect(unexpectedRequests(watch, baseURL!)).toEqual([]);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("compares two Excel reports after switching modes; only a counts-only event leaves the page", async ({ page, baseURL }) => {
  const watch = await open(page);
  await page.getByRole("radio", { name: "דוחות אקסל" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("השוואת דוח ספק מול תאנה ורימון");
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(sample("excel/דוחות-תאנה ורימון-22.9.26 (1).xlsx"));
  await inputs.nth(1).setInputFiles(sample("excel/תאנה רוימון.xlsx"));
  await page.getByRole("button", { name: "השוואת הדוחות" }).click();

  await expect(page.locator(".results h2")).toHaveText("דוח ספק מול דוח תאנה ורימון (אקסל)");
  await expect(page.locator(".total-card--hot strong")).toContainText("1,589.20");
  await expect(page.locator(".count-strip")).toContainText("רק אצל תאנה ורימון: 1");
  await expect(page.getByRole("columnheader", { name: "מגדל" }).first()).toBeVisible();

  await expect.poll(() => watch.analytics.length).toBe(1);
  expect(watch.analytics[0]).toMatchObject({
    event: "reconciliation_completed",
    properties: { supplier_lines: 54, own_lines: 50, unmatched_supplier: 0, unmatched_own: 1 },
  });
  expect(JSON.stringify(watch.analytics[0])).not.toMatch(/[א-ת]|xlsx/);

  // Switching back resets to PDF uploads.
  await page.getByRole("radio", { name: "חשבוניות PDF" }).click();
  await expect(page.locator(".results")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "השוואת החשבוניות" })).toBeDisabled();

  expect(unexpectedRequests(watch, baseURL!)).toEqual([]);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("reports a failure by error code only", async ({ page, baseURL }) => {
  const watch = await open(page);
  await compare(page, "גרנות 17.09.pdf", "גרנות אצל תאנה ורימון.pdf");

  await expect(page.locator(".banner--error")).toContainText("הוחלפו");
  await expect.poll(() => watch.analytics.length).toBe(1);
  expect(watch.analytics[0]).toMatchObject({
    event: "reconciliation_failed",
    properties: { error_code: "FILES_SWAPPED" },
  });
  expect(JSON.stringify(watch.analytics[0])).not.toMatch(/[א-ת]/);
  expect(unexpectedRequests(watch, baseURL!)).toEqual([]);
  expect(await watch.violations()).toEqual([]);
});

test("sends an invoice no reader in the browser can read to the AI backend, and nothing else", async ({ page, baseURL }) => {
  const watch = await open(page);
  const calls: { method: string; path: string; token: string | null; body: Record<string, unknown> | null }[] = [];
  await page.route(`${AI}**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push({ method: request.method(), path: url.pathname, token: request.headers()["x-customer-token"] ?? null, body: request.postDataJSON() });
    if (url.pathname === "/profiles") return route.fulfill({ json: { profiles: [] } });
    return route.fulfill({
      json: {
        verified: true,
        learned: true,
        newFormat: true,
        invoice: {
          supplierId: "ai-570046193",
          supplierName: "ספק חדש",
          vatId: "570046193",
          invoiceNumber: "A-1001",
          invoiceDate: "2026-09-30",
          printedItemsTotal: 1980,
          lines: [
            { id: "S1", page: 1, date: "2026-08-31", docNumber: null, bookRef: "263125", description: "גזר אא בשקית 1 קג קרטון", variety: "", sku: "11001", packages: null, quantity: 660, unit: "ק\"ג", unitPrice: 3, discountPct: 0, lineTotal: 1980 },
          ],
          warnings: ["החשבונית נקראה בעזרת AI, כי אף קורא אחר לא הצליח לקרוא אותה."],
          generic: "ai",
        },
      },
    });
  });

  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(sample("1 תאנה ורימון.pdf"));
  await inputs.nth(1).setInputFiles(repoFile("samples/supplier-invoice.pdf"));
  await page.getByRole("button", { name: "השוואת החשבוניות" }).click();

  await expect(page.locator(".results h2")).toContainText("ספק חדש · חשבונית A-1001", { timeout: 60_000 });
  await expect(page.locator(".eyebrow .chip")).toHaveText("נקרא בעזרת AI");
  await expect(page.locator(".banner--scan")).toContainText("כל השורות אומתו");

  // A layout lookup by VAT number first (labels only come back), then the one upload, both with the customer's token.
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /profiles", "POST /parse"]);
  expect(calls.every((c) => c.token === "e2e-test-token-0123456789")).toBe(true);
  expect(calls[1].body).toMatchObject({ fileName: "supplier-invoice.pdf", scanned: false, vatHint: "570046193" });
  expect(String(calls[1].body!.pdf).startsWith("JVBERi")).toBe(true); // %PDF, base64

  await expect.poll(() => watch.analytics.length).toBe(1);
  expect(watch.analytics[0]).toMatchObject({ event: "reconciliation_completed", properties: { supplier_source: "ai", supplier_lines: 1 } });
  expect(JSON.stringify(watch.analytics[0])).not.toMatch(/[א-ת]|A-1001|570046193/);
  const outside = unexpectedRequests(watch, baseURL!).filter((r) => !r.startsWith(`GET ${AI}profiles`) && r !== `POST ${AI}parse`);
  expect(outside).toEqual([]);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});

test("never contacts the AI backend for an invoice the browser reads", async ({ page }) => {
  const watch = await open(page);
  await compare(page, "גרנות אצל תאנה ורימון.pdf", "גרנות 17.09.pdf");
  await expect(page.locator(".results h2")).toContainText("גרנות · חשבונית SI26602203");
  expect(watch.requests.filter((r) => r.includes("ai.e2e.test"))).toEqual([]);
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

test("reads Excel reports with other column names, and says which columns it used", async ({ page }) => {
  const watch = await open(page);
  await page.getByRole("radio", { name: "דוחות אקסל" }).click();
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(0).setInputFiles(sample("excel/דוחות עם מחירים-תאנה ורימון עד ה-7.10.26.xlsx"));
  await inputs.nth(1).setInputFiles(sample("excel/מארק מחירי תאנה ורימון.xlsx"));
  await page.getByRole("button", { name: "השוואת הדוחות" }).click();

  await expect(page.locator(".total-card--hot strong")).toContainText("20,018.77");
  await expect(page.locator(".count-strip")).toContainText("רק אצל תאנה ורימון: 21");
  await page.getByText("העמודות שזוהו").click();
  await expect(page.locator(".results__columns")).toContainText("תעודת משלוח ← תעודה");
  await expect(page.locator(".results__columns")).toContainText("תעודת משלוח ← אסמכתא");

  // The export: one row per delivery note and product, both reports side by side.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "ייצוא לאקסל" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("השוואת ספק - מארק מחירי תאנה ורימון.xlsx");
  const { readDataSheet } = await import("../../core/src/excel/read.js");
  const fs = await import("node:fs");
  const rows = (await readDataSheet(new Uint8Array(fs.readFileSync((await download.path())!))))!;
  expect(rows[0]).toEqual([
    "תאריך",
    "אסמכתא",
    "מגדל",
    "תוצרת",
    "סך הכל משקל אצל הספק",
    "סך הכל משקל תאנה ורימון",
    "הפרש משקלים",
    "סך הכל עלות הספק",
    "סך הכל עלות תאנה ורימון",
    "הפרש סך הכל עלות",
  ]);
  expect(rows).toHaveLength(1 + 63 + 1);
  expect(rows[1].slice(1, 10)).toEqual([94, "ביטן ראובן", "חציל", 2427, 2427, 0, 12897, 12820.1, -76.9]);
  // A price of 0 leaves the cost for the user to fill in.
  expect(rows.find((r) => r[1] === 909907)!.slice(7)).toEqual(["-", 4802.5, "-"]);
  expect(rows[rows.length - 1][0]).toBe('סה"כ');
  expect(watch.consoleErrors).toEqual([]);
});

test("collapses ₪0 groups, filters by column and exports to Excel without leaving the page", async ({ page, baseURL }) => {
  const watch = await open(page);
  await compare(page, "גרנות אצל תאנה ורימון.pdf", "גרנות 17.09.pdf");

  const matched = page.locator(".results__section").filter({ has: page.getByRole("heading", { name: "שורות שהוצמדו" }) });
  const groups = matched.locator("tbody.grp");
  await expect(groups.first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "מילים שלא זוהו בשמות הפריטים" })).toHaveCount(0);

  // Every collapsed group shows ₪0; every open one shows a money difference.
  const collapsed = matched.locator("tbody.grp--collapsed");
  const total = await groups.count();
  const closed = await collapsed.count();
  expect(closed).toBeGreaterThan(0);
  expect(closed).toBeLessThan(total);
  for (const diff of await collapsed.locator("td:last-child").allTextContents()) expect(diff).toMatch(/^[^1-9]*0[^1-9]*$/);
  await expect(collapsed.locator("tr")).toHaveCount(closed);

  const first = collapsed.first().getByRole("button", { expanded: false });
  const id = (await first.getAttribute("aria-label"))!.replace("פתיחת קבוצה ", "");
  await first.click();
  await expect(matched.getByRole("button", { name: `סגירת קבוצה ${id}` })).toHaveAttribute("aria-expanded", "true");
  await matched.getByRole("button", { name: "סגירת הכל" }).click();
  await expect(matched.locator("tbody.grp--collapsed")).toHaveCount(total);
  await matched.getByRole("button", { name: "פתיחת הכל" }).click();
  await expect(matched.locator("tbody.grp--collapsed")).toHaveCount(0);

  await matched.getByRole("searchbox", { name: "סינון לפי פריט" }).fill("פיטאיה");
  await expect.poll(() => groups.count()).toBeLessThan(total);
  expect(await groups.count()).toBeGreaterThan(0);
  for (const g of await groups.allTextContents()) expect(g).toContain("פיטאיה");
  await matched.getByRole("button", { name: "ניקוי סינון" }).click();
  await expect(groups).toHaveCount(total);

  // Clicking rows shows their partial sum in a bar that stays on screen; Esc clears it.
  const g1 = groups.first();
  const supplierRow = g1.locator("tr.side-supplier").first();
  const ownRow = g1.locator("tr.side-tr").first();
  const kg = async (row: typeof supplierRow) => Number((await row.locator("td.mono").nth(-3).innerText()).replace(/[^\d.]/g, ""));
  const supplierKg = await kg(supplierRow);
  const ownKg = await kg(ownRow);
  await supplierRow.locator("td.name").click();
  const bar = page.locator(".sum-bar");
  await expect(bar).toContainText(`נבחרו שורה אחת`);
  await expect(bar).toBeInViewport();
  await ownRow.locator("td.name").click();
  await expect(bar).toContainText(`הפרש`);
  const shownDiff = Number((await bar.locator(".sum-bar__part").nth(2).locator(".mono").first().innerText()).replace(/[^\d.-]/g, ""));
  expect(shownDiff).toBeCloseTo(ownKg - supplierKg, 3);
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);

  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "ייצוא לאקסל" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("התאמה - גרנות - SI26602203.xlsx");
  expect((await import("node:fs")).statSync((await download.path())!).size).toBeGreaterThan(5000);

  expect(unexpectedRequests(watch, baseURL!)).toEqual([]);
  expect(await watch.violations()).toEqual([]);
  expect(watch.consoleErrors).toEqual([]);
});
