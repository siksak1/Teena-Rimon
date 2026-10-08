# LedgerMatch — Invoice Reconciliation

Reconciles a supplier's consolidated invoice against the wholesaler's own document (for Teena-Rimon, the first customer: its AGROLINE draft, "חשבונית טיוטה"). Both PDFs are parsed deterministically (no AI), every supplier row is matched to the own-document rows that describe the same delivery, and the gaps are shown by reason in a Hebrew, right-to-left UI.

## Architecture

```
/core       Pure TypeScript — PDF parsers + reconciliation engine (runs in the browser and in Node for tests)
/customers  <slug>/config.json     ← per-customer settings (see below)
/frontend   React + Vite           ← UI; parses the PDFs and runs the reconciliation in the browser
/infra      AWS CDK                ← static hosting (S3 + CloudFront + routing function), see DEPLOY.md
/scripts    release.sh, token.sh   ← ship / roll back a customer's build; manage secret customer URLs
/docs       it-verification-he.md, privacy-statement.md ← for customers' IT staff and the customer agreement
/sample_data                      ← real sample invoices (one pair per supplier) used by the tests
```

### Per-customer configuration

The engine and parsers are shared; what differs between wholesalers lives in `customers/<slug>/config.json`, validated by the zod schema in `core/src/customer.ts`: display name, own-document format and label, which supplier parsers the customer gets (`suppliers`), which supplier fields the clerk records as the reference (`referenceRules`), matching tolerances, offsetting on/off, and additions to the product dictionary. Bump `configVersion` on every change; the footer shows it next to the app version.

Each build is for one customer, and only that customer's config is bundled:

```bash
CUSTOMER=teena-rimon npm run build
```

The build fails if `CUSTOMER` is missing or the config is invalid. `npm run dev` defaults to `teena-rimon`. `core/test/customers.test.ts` checks every config under `customers/` and that every format and supplier it names exists.

### Invoice files never leave the browser

Both PDFs are parsed in the browser tab (`frontend/src/api/extract.ts` → `core/src/extract.ts`); there is no server-side code. pdf.js (~1.6 MB) is loaded on demand when the first comparison runs, and fonts are bundled (`@fontsource/*`), so the app makes no third-party requests.

## Quick start

```bash
npm run install:all
npm run dev          # UI on :43123
npm test             # core tests (parsers on the sample PDFs, engine, customer configs, fixtures) + routing function
npm run e2e          # production build in Chromium under the production headers (first: npx --prefix frontend playwright install chromium)
```

## Usage analytics (counts only)

After each comparison the app sends one event to PostHog Cloud EU (`frontend/src/analytics.ts`); the payload is built in `core/src/analytics.ts` and nothing else is ever sent:

- `reconciliation_completed`: customer slug, app version, config version, browser family (e.g. `chrome-129`), line counts on both sides, matched groups, groups with gaps, unmatched rows on each side, offset applied, parser-warning count, parse and reconcile time in ms, and — only when the customer's config sets `analytics.sendDiscrepancyAmount` — the invoice's net gap rounded to ₪10.
- `reconciliation_failed`: the same identifying fields plus a fixed `error_code` (`NOT_PDF`, `FILES_SWAPPED`, `OWN_DOC_NOT_RECOGNIZED`, `UNSUPPORTED_SUPPLIER`, `NO_LINES`, `INTERNAL`). Error messages are never sent: they contain file names.

`distinct_id` is the customer slug and person profiles are off, so no individual user is identified. Requests carry no cookies and no `Referer` (the secret URL path never leaves the page). Sending is fire-and-forget, and the dev server only logs the payload to the console. `core/test/analytics.test.ts` pins the exact property list and checks, on every sample pair, that no supplier name, invoice or document number, product name or file name appears in the payload. In the PostHog project settings, keep "Discard client IP data" on.

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
- **Not supported:** Har HaKor (הר-קור) sends scanned invoices with no usable text. It gets a specific error asking for a digital PDF (`UNSUPPORTED_SUPPLIERS` in `registry.ts`).

The supplier is detected from the PDF (VAT number / company name), among the parsers the customer's config enables. To add a supplier, write a `SupplierParser` (see `core/src/parsers/types.ts`), register it in `SUPPLIER_PARSERS` in `core/src/parsers/registry.ts`, and add its id to `suppliers` in the configs of the customers who need it. Each parser checks that its lines add up to the total printed on the PDF and warns otherwise.

## Matching rules (`core/src/reconcile/`)

Thresholds below are Teena-Rimon's; each customer sets them under `tolerances` in its config.

1. **Document pairing** — the own document's reference equals the supplier's booklet number or the digits of its `SH…` document number (`referenceRules`). Documents whose references differ are still paired when date (±2 days) and content agree, nearest date first; the gap is flagged "אסמכתא".
2. **Groups inside a document** — 1:1, or 1:k / k:1 (k ≤ 4) within one product family. Names are a soft signal: rows are matched on document, date, weight and price, and only two different *known* families rule a pair out. Multi-row groups must add up to the same weight. A pair is rejected only when both weight and price differ by more than 5%. The chosen groups cover as many rows as possible, then maximise a score (name, weight, price, packages, date).
3. **Absorbing** — inside a paired document, a leftover row joins the same-product group whose weight gap it reduces (large or uneven splits, e.g. one row against 12); a row that would only widen a gap stays unmatched.
4. **Leftovers** — remaining rows are tried across documents (a pair with unrelated names must then agree on both weight and price); whatever is left is listed as "רק אצל הספק" / "רק אצל <customer>".
5. **Money** — compared net: the supplier's printed line total (per-line discount, which may be 0%) vs the own document's amount minus its commercial discount. Pallet charges and VAT are not compared.
6. **Offsetting** (`offsetting: "invoice-wide"`) — when the net item totals are equal, price/weight gaps cancel out and are shown in a separate section.

Product names are matched by `NameMatcher` (`core/src/reconcile/names/`): names are parsed into family / colour / cultivar / size / grade using `dictionary.ts`. A product missing from the dictionary falls back to the stem of its first word ("עגבניות" ≈ "עגבניה"), so new products need no dictionary entry; a group matched on numbers alone carries a "שם:" note. The dictionary is optional enrichment — unknown words on matched rows are listed in the UI as dictionary suggestions.

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
| S3 (≈3 MB per build) and the KeyValueStore | a few cents |
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
