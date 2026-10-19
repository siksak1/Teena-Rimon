# LedgerMatch — Invoice Reconciliation

Reconciles a supplier's consolidated invoice against the wholesaler's own document (for Teena-Rimon, the first customer: its AGROLINE draft, "חשבונית טיוטה"). Both PDFs are parsed deterministically (no AI), every supplier row is matched to the own-document rows that describe the same delivery, and the gaps are shown by reason in a Hebrew, right-to-left UI.

## Architecture

```
/core       Pure TypeScript — PDF parsers, OCR of scanned invoices, reconciliation engine (runs in the browser and in Node for tests)
/customers  <slug>/config.json     ← per-customer settings (see below)
/frontend   React + Vite           ← UI; parses the PDFs and runs the reconciliation in the browser
/infra      AWS CDK                ← static hosting (S3 + CloudFront + routing function), see DEPLOY.md
/scripts    release.sh, token.sh   ← ship / roll back a customer's build; manage secret customer URLs
/docs       it-verification-he.md, privacy-statement.md ← for customers' IT staff and the customer agreement
/sample_data                      ← real sample invoices (one pair per supplier) used by the tests
```

### Per-customer configuration

The engine and parsers are shared; what differs between wholesalers lives in `customers/<slug>/config.json`, validated by the zod schema in `core/src/customer.ts`: display name, own-document format and label, which supplier parsers the customer gets (`suppliers`), whether other suppliers are read by the generic parsers (`genericFallback`, on unless `false`), which supplier fields the clerk records as the reference (`referenceRules`), matching tolerances, agreed discounts for suppliers that print none (`unprintedDiscounts`, e.g. Bananot Carmel at 12%), offsetting on/off, and additions to the product dictionary. Bump `configVersion` on every change; the footer shows it next to the app version.

Each build is for one customer, and only that customer's config is bundled:

```bash
CUSTOMER=teena-rimon npm run build
```

The build fails if `CUSTOMER` is missing or the config is invalid. `npm run dev` defaults to `teena-rimon`. `core/test/customers.test.ts` checks every config under `customers/` and that every format and supplier it names exists.

### Invoice files never leave the browser

Both PDFs are parsed in the browser tab (`frontend/src/api/extract.ts` → `core/src/extract.ts`); there is no server-side code. pdf.js (`pdfjs-dist`, ~1.6 MB, in its own worker) is loaded on demand when the first comparison runs, and fonts are bundled (`@fontsource/*`), so the app makes no third-party requests.

**Scanned invoices** (Har-Kor) are read by OCR in the same tab:

- `core/src/pdf/scan.ts` takes each page's image from pdf.js (CCITT/JBIG2 scans need pdf.js's `jbig2.wasm`), applies the page rotation and finds the ruled table's rows and columns.
- `core/src/ocr/` reads each column with Tesseract (`tesseract-wasm`, models `eng` for digits and `heb` for names) inside a Web Worker (`frontend/src/api/ocrWorker.ts`).
- The parser checks every row (weight × price = total) and every column against the printed totals. It corrects a misread only when those totals prove the correction (`confirmAmounts` in `core/src/parsers/validate.ts`); anything else is shown with a "⚠ לבדיקה" mark.
- The CSP lets the page fetch nothing but analytics, so the decoder, Tesseract and its models (~7 MB as base64, `bundledBinaries` in `frontend/vite.config.ts`) ship as the app's own script chunks, loaded only when a scan is uploaded. The CSP's `'wasm-unsafe-eval'` lets the page compile this WebAssembly; it does not allow `eval()` of JavaScript.
- The tests run the same OCR in Node (`core/test/scanSupport.ts`).

**PDFs with no Hebrew text.** A PDF printed with "Microsoft Print to PDF" embeds its fonts without a Unicode map for Hebrew: digits and amounts extract, every Hebrew letter comes out blank (e.g. `sample_data/גליל טטיט.pdf`). `loadPdf` flags such a document (`missingText`), and `core/src/pdf/repair.ts` renders each page with pdf.js, whites out the text that did extract and the ruling lines, and reads the rest word by word with the same Tesseract (`heb`). The words are placed where they are printed, so the usual parsers read the document as if it were whole; header and footer labels are matched with a small edit-distance tolerance (`fuzzyEquals` in `layout.ts`). Amounts always come from the exact text layer. The document carries a warning that its names were read by OCR. Without OCR available the file is refused with `TEXT_LAYER_BROKEN` and a hint to print with "Save as PDF" instead.

## Quick start

```bash
npm run install:all
npm run dev          # UI on :43123
npm test             # core tests (parsers on the sample PDFs, engine, customer configs, fixtures) + routing function
npm run e2e          # production build in Chromium under the production headers (first: npx --prefix frontend playwright install chromium)
```

## Usage analytics (counts only)

After each comparison the app sends one event to PostHog Cloud EU (`frontend/src/analytics.ts`); the payload is built in `core/src/analytics.ts` and nothing else is ever sent:

- `reconciliation_completed`: customer slug, app version, config version, browser family (e.g. `chrome-129`), `internal` (see below), line counts on both sides, matched groups, groups with gaps, unmatched rows on each side, offset applied, whether the supplier invoice was a scan and how many of its rows OCR could not confirm, parser-warning count, parse and reconcile time in ms, and — only when the customer's config sets `analytics.sendDiscrepancyAmount` — the invoice's net gap rounded to ₪10.
- `reconciliation_failed`: the same identifying fields plus a fixed `error_code` (`NOT_PDF`, `FILES_SWAPPED`, `OWN_DOC_NOT_RECOGNIZED`, `UNSUPPORTED_SUPPLIER`, `NO_LINES`, `SCAN_UNREADABLE`, `TEXT_LAYER_BROKEN`, `INTERNAL`). Error messages are never sent: they contain file names.

`distinct_id` is the customer slug and person profiles are off, so no individual user is identified. Requests carry no cookies and no `Referer` (the secret URL path never leaves the page). Sending is fire-and-forget, and the dev server only logs the payload to the console. `core/test/analytics.test.ts` pins the exact property list and checks, on every sample pair, that no supplier name, invoice or document number, product name or file name appears in the payload. In the PostHog project settings, keep "Discard client IP data" on.

To keep our own tests on prod out of the numbers, open the app once in each browser we test from with `#internal` at the end of the URL. That browser then sends `internal: true` (kept in its localStorage; `#external` clears it, and so does clearing site data). In PostHog, Settings → Project → Product analytics → "Filter out internal and test users" holds the filter `internal` ≠ `true` (an event property), so insights hide our events by default.

## Regression fixtures

Every sample pair a customer has is listed in `customers/<slug>/fixtures/cases.json` (paths into `sample_data/`). `core/test/fixtures.test.ts` reconciles each one under that customer's config and compares the result with `customers/<slug>/fixtures/<case>.expected.json`: what was read, every group with its gaps and notes, the unmatched rows, totals and offsetting. A change to any parser or matching rule that alters what a user would see, for any supplier of any customer, fails this test.

When a change is intended:

```bash
npm run fixtures:update   # rewrite the .expected.json files
git diff customers/       # review every changed result before committing
```

To add a case: put the two PDFs in `sample_data/`, add an entry to `cases.json`, run `npm run fixtures:update`, and check the new `.expected.json` against a manual reconciliation. A case may also expect an error (e.g. a scanned invoice).

## End-to-end tests and CI

`frontend/e2e/app.spec.ts` (Playwright) runs the production build, served under a fake customer token with exactly the headers CloudFront sends (`infra/security-headers.json`, shared with the stack). It reconciles real sample invoices and checks that the only request leaving the page is one counts-only analytics event (intercepted, so nothing reaches PostHog), that the page is `noindex`, that there are no CSP violations, and that the browser blocks uploads anywhere else, even to our own server.

GitHub Actions (`.github/workflows/ci.yml`) runs `npm test`, the typecheck/build and the end-to-end tests on every push to `main` and every pull request. It only runs tests; releases are made with `scripts/release.sh`, which also runs both suites first.

## Supported formats

- **Own document: AGROLINE draft** (`agroline-draft`, Teena-Rimon) — same layout for every supplier (`core/src/parsers/agrolineDraft.ts`). Own-document formats are registered in `OWN_DOCUMENT_PARSERS` and chosen by `ownDocument.format` in the customer config.
- **Granot** — `core/src/parsers/granot.ts`
- **Shivuk HaHof** — `core/src/parsers/shivukHahof.ts`
- **D. Hai (ד.ח שווק תוצרת חקלאית)** and **Achim Menashri (אחים מנשרי)** — `core/src/parsers/agroline.ts` (supplier-side AGROLINE invoices; line totals before the footer discount)
- **HaHaklaim (החקלאים)** — `core/src/parsers/haklaim.ts`
- **Galil Shuk Mekomi (גליל שוק מקומי)** — `core/src/parsers/galil.ts` (3-row header, product names wrapped over several lines)
- **Shivuk HaAsor (שיווק העשור)** — `core/src/parsers/hasor.ts` (detected by layout, since the name is only in the logo; net line totals, gross unit prices)
- **Bananot Carmel (בננות כרמל)** — `core/src/parsers/carmel.ts`
- **Har-Kor (הר-קור)** — `core/src/parsers/harKor.ts`. Scanned invoices only, read by OCR (see above). It is detected by its VAT number, either in the scanner's own text layer (too garbled to parse) or by OCR of the page header. Product short forms ("ש", "נ") are spelled out, and OCR'd names are snapped to Har-Kor's product list.
- **Levi Tzadok (לוי צדוק ובניו)** — `core/src/parsers/levi.ts` (fixed-width printout, one cell per word; dates without a year; pallet rows skipped)

### Suppliers with no parser of their own (`genericFallback`)

When no dedicated parser recognises the supplier invoice, two generic parsers are tried, in this order (`FALLBACK_PARSERS` in `registry.ts`):

- **Any AGROLINE supplier** — `agrolineGenericParser` in `core/src/parsers/agroline.ts`. Many small suppliers print "חשבונית מס / חשבון פרופורמה (שווק)" from AGROLINE in the same layout; the supplier is identified by VAT number, and named after the "לכבוד:" line of the wholesaler's draft (the name itself is in AGROLINE's logo). Sample: Meshek Dudu (משק דודו).
- **Any table** — `genericTableParser` in `core/src/parsers/generic.ts`. It finds the item rows by arithmetic: three amounts with quantity × price × (1 − discount) = line total, read right to left, in the price and total columns most rows share (pallet and packaging tables are laid out differently and drop out). The discount is a percentage on the row, one printed in the footer, or the ratio of a second, discounted price column. Column names above the table (`genericHeaders.ts`) label the date, delivery document, booklet reference, SKU, description and package columns; group rows ("תעודה: …, מספר פנקס: …") and blank cells carry the date and document down. The result is accepted only when the lines add up to a total printed on the invoice (with or without the pallet rows); otherwise the invoice is refused.

`core/test/generic.test.ts` runs the table parser on every supplier sample that has a dedicated parser and requires the same lines, field by field. It reproduces all of them except the Har-Kor scan. The results page marks generically read invoices "פורמט כללי".

The supplier is detected from the PDF (VAT number / company name), among the parsers the customer's config enables. To add a supplier, write a `SupplierParser` (see `core/src/parsers/types.ts`), register it in `SUPPLIER_PARSERS` in `core/src/parsers/registry.ts`, and add its id to `suppliers` in the configs of the customers who need it. Each parser checks that its lines add up to the total printed on the PDF and warns otherwise.

### Excel reports (PDF / Excel switch)

Customers with an `excel` block in their config get a switch between two PDF invoices and two Excel reports (`core/src/excel/`, read with `read-excel-file`, loaded only in Excel mode). Each report covers many growers over a period.

**Columns are found by their values, not their names** (`core/src/excel/columns.ts`), so any column names and order work, and so does a sheet with no header row:

- **Header row:** the row of labels just above the first rows of figures. Summary rows (סה"כ…) are skipped. In a workbook with several sheets, the sheet with the most rows of figures is read.
- **Text columns:**
  - **Date:** date cells.
  - **Item:** the text column the product dictionary recognises.
  - **Grower:** other text in long runs. A column holding a single value (the report's destination) is ignored.
- **Figures:** every way of giving the number columns the roles weight, price and package count is scored, and the best is kept:
  - weight ≥ packages on almost every row, with a steady weight per package
  - price is the smaller value, and weight × price is a plausible amount
  - columns shaped like document numbers are kept out of these roles
- **Delivery note:** whole numbers repeated over one grower's rows. When a report has two such columns, the one whose values also appear in the other report links the two. On the own side, the other one becomes its own document number.
- **Variety, size and grade:** leftover columns, joined into the supplier's item name. A receiving report with such columns and a sales report without them means the files were swapped.
- **Header names** (`HEADER_HINTS`) add only a small bonus that breaks near-ties.
- **Warnings and errors:** a column that wins by a small margin, or an expected column (grower, date, document) that isn't found, adds a "לא בוודאות" warning, and the comparison still runs. Without an item, weight or price column the file is refused (`MISSING_COLUMN`), naming the missing fields.
- **Results page:** a collapsible line shows which column each field was read from.

Rows where weight equals the package count (pineapples) are marked as sold by the piece. Samples so far: the supplier's sales report (both versions) and Teena-Rimon's weighings report, with and without its own receipt number and package count.

Neither report has a discount or printed totals: money is weight × price on both sides. The same engine runs, with these differences:

- **Growers** (`core/src/reconcile/growers.ts`) are paired one-to-one across the reports, by shared delivery notes first and by name second (noise words such as "משק" and "בע\"מ" dropped, vowel letters ignored: "דהאן פרותס" ↔ "פירות דהן ובניו בע\"מ"). Rows of different growers never match. `excel.growerAliases` pins names that don't resemble each other.
- **Multi-row groups** need only their weights to add up, within `excel.tolerances.sumToleranceRel` (2%), since the two scales differ slightly.
- **Family roll-up** — inside a paired delivery, the rows of one product that no smaller group placed form one n:m group when their weights add up (57+86 ↔ 72+71).

## Matching rules (`core/src/reconcile/`)

Thresholds below are Teena-Rimon's; each customer sets them under `tolerances` in its config.

1. **Document pairing** — the own document's reference equals the supplier's booklet number or the digits of its `SH…` document number (`referenceRules`). Documents whose references differ are still paired when date (±2 days) and content agree, nearest date first; the gap is flagged "אסמכתא".
2. **Groups inside a document** — 1:1, or 1:k / k:1 (k ≤ 4) within one product family. Names are a soft signal: rows are matched on document, date, weight and price, and only two different *known* families rule a pair out. Multi-row groups must add up to the same weight. A pair is rejected only when both weight and price differ by more than 5%. The chosen groups cover as many rows as possible, then maximise a score (name, weight, price, packages, date).
3. **Absorbing** — inside a paired document, a leftover row joins the same-product group whose weight gap it reduces (large or uneven splits, e.g. one row against 12); a row that would only widen a gap stays unmatched.
4. **Leftovers** — remaining rows are tried across documents (a pair with unrelated names must then agree on both weight and price); whatever is left is listed as "רק אצל הספק" / "רק אצל <customer>".
5. **Money** — compared net: the supplier's printed line total (per-line discount, which may be 0%) vs the own document's amount minus its commercial discount. For a supplier in `unprintedDiscounts`, its already-discounted prices are restated as list price less that rate and the own document's missing commercial discount is taken at the same rate (`core/src/extract.ts`). Pallet charges and VAT are not compared.
6. **Offsetting** (`offsetting: "invoice-wide"`) — when the net item totals are equal, price/weight gaps cancel out and are shown in a separate section.

Product names are matched by `NameMatcher` (`core/src/reconcile/names/`): names are parsed into family / colour / cultivar / size / grade using `dictionary.ts`. A product missing from the dictionary falls back to the stem of its first word ("עגבניות" ≈ "עגבניה"), so new products need no dictionary entry; a group matched on numbers alone carries a "שם:" note. The dictionary is optional enrichment — unknown words on matched rows are returned as `dictionarySuggestions` (not shown in the UI).

## Deployment (AWS)

A static site with no server code. Details, prerequisites and post-deploy checks: [DEPLOY.md](DEPLOY.md).

```
Browser ──► CloudFront ──(viewer-request Function + KeyValueStore)──► private S3 bucket
https://<host>/<token>/     token → {customer, build}                builds/<customer>/<build>/…
```

- **Stack `LedgerMatchStatic`** (eu-central-1, `infra/`) contains a private S3 bucket, a CloudFront distribution, a CloudFront Function with a KeyValueStore, and a response-headers policy. There is no Lambda, database or secret.
- **One secret URL per customer:** `https://<host>/<customer>-<16 random chars>/`. Tokens live only in the KeyValueStore, never in git. Any other path, `/` and `/robots.txt` get a 404 from the function.
- **Every response** carries a CSP allowing only the app's own files plus `https://eu.i.posthog.com`, `X-Robots-Tag: noindex, nofollow, noarchive` and `Referrer-Policy: no-referrer`. The headers are defined in `infra/security-headers.json`, which the end-to-end tests also use.
- **Each build is immutable:** `builds/<customer>/<version>-<commit>/`. A release uploads a new build and repoints the customer's URLs. Rollback repoints them to an older build. Nothing is ever overwritten or invalidated.

**Estimated monthly cost: about $0–1.**

| Item | At current scale (1 customer, ~2,000 comparisons/month) |
| --- | --- |
| CloudFront: transfer, requests, Function invocations | $0 (always-free tier: 1 TB, 10M requests, 2M function invocations) |
| S3 (≈12 MB per build, ~7 MB of it OCR loaded only for scans) and the KeyValueStore | a few cents |
| PostHog Cloud EU | $0 (free tier: 1M events; ~1 event per comparison) |

A handful of customers stays within the free tiers. A custom domain later adds the domain fee only, because the ACM certificate is free.

**Releasing a new version** (from your machine, logged in with `aws login`):

```bash
# 1. Commit your change (bump "version" in package.json for a new release; bump configVersion for config-only changes)
git commit -am "…" && git push

# 2. Test, build, upload, and point the customer's URLs at the new build
scripts/release.sh teena-rimon            # add --preview to update only preview URLs first

# 3. If something is wrong: roll back in seconds
scripts/release.sh teena-rimon --list
scripts/release.sh teena-rimon --point <previous build>
```

Customer URLs: `scripts/token.sh add | rotate | revoke | list`. Infrastructure changes (rare): `cd infra && npx cdk diff && npx cdk deploy`.

## Ports

| Service | Port |
| --- | --- |
| Frontend (Vite) | `43123` |
