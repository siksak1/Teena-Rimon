# LedgerMatch — Invoice Reconciliation

Reconciles a supplier's consolidated invoice against the wholesaler's own document (for Teena-Rimon, the first customer: its AGROLINE draft, "חשבונית טיוטה"). Both PDFs are parsed deterministically (no AI), every supplier row is matched to the own-document rows that describe the same delivery, and the gaps are shown by reason in a Hebrew, right-to-left UI.

## Architecture

```
/core       Pure TypeScript — PDF parsers + reconciliation engine (runs in the browser and in Node for tests)
/customers  <slug>/config.json     ← per-customer settings (see below)
/frontend   React + Vite           ← UI; parses the PDFs and runs the reconciliation in the browser
/infra      AWS CDK                ← static hosting (S3 + CloudFront)
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
npm test             # core tests (parsers on the sample PDFs, engine, customer configs)
```

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

## Deploying to AWS

See [DEPLOY.md](DEPLOY.md).

## Ports

| Service | Port |
| --- | --- |
| Frontend (Vite) | `43123` |
