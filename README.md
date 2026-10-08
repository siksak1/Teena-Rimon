# LedgerMatch — Invoice Reconciliation

Reconciles a supplier's consolidated invoice against Teena-Rimon's AGROLINE draft ("חשבונית טיוטה"). Both PDFs are parsed deterministically (no AI), every supplier row is matched to the Teena-Rimon rows that describe the same delivery, and the gaps are shown by reason in a Hebrew, right-to-left UI.

## Architecture

```
/core       Pure TypeScript — PDF parsers + reconciliation engine (runs in Node and the browser)
/backend    Express + TypeScript   ← Lambda-ready /api/extract (parses PDFs with core)
/frontend   React + Vite           ← UI; runs the reconciliation with core
/infra      AWS CDK                ← S3 + CloudFront + Lambda deployment
/sample_data                      ← real sample invoices (one pair per supplier) used by the tests
```

### Where the PDFs are parsed

The same parser code (`core/src/extract.ts`) can run in either place:

| Mode | How | Notes |
| --- | --- | --- |
| `server` (default) | Browser uploads to `POST /api/extract` | Small frontend bundle |
| `client` | Parsed in the browser tab | PDFs never leave the browser; pdf.js (~1.6 MB) is loaded on demand |

Choose the default at build time with `VITE_PARSE_MODE=server|client`, or per visit with `?parse=client` / `?parse=server`.

## Quick start

```bash
npm run install:all
npm run dev          # API on :43124, UI on :43123 (proxies /api)
npm test             # core tests (parsers on the sample PDFs + engine)
```

## Supported formats

- **Teena-Rimon** — AGROLINE draft, same layout for every supplier (`core/src/parsers/teenaRimon.ts`).
- **Granot** — `core/src/parsers/granot.ts`
- **Shivuk HaHof** — `core/src/parsers/shivukHahof.ts`
- **D. Hai (ד.ח שווק תוצרת חקלאית)** and **Achim Menashri (אחים מנשרי)** — `core/src/parsers/agroline.ts` (supplier-side AGROLINE invoices; line totals before the footer discount)
- **HaHaklaim (החקלאים)** — `core/src/parsers/haklaim.ts`
- **Galil Shuk Mekomi (גליל שוק מקומי)** — `core/src/parsers/galil.ts` (3-row header, product names wrapped over several lines)
- **Shivuk HaAsor (שיווק העשור)** — `core/src/parsers/hasor.ts` (detected by layout, since the name is only in the logo; net line totals, gross unit prices)
- **Bananot Carmel (בננות כרמל)** — `core/src/parsers/carmel.ts`
- **Not supported:** Har HaKor (הר-קור) sends scanned invoices with no usable text. It gets a specific error asking for a digital PDF (`UNSUPPORTED_SUPPLIERS` in `registry.ts`).

The supplier is detected from the PDF (VAT number / company name). To add a supplier, write a `SupplierParser` (see `core/src/parsers/types.ts`) and register it in `core/src/parsers/registry.ts`. Each parser checks that its lines add up to the total printed on the PDF and warns otherwise.

## Matching rules (`core/src/reconcile/`)

1. **Document pairing** — Teena-Rimon's reference equals the supplier's booklet number or the digits of its `SH…` document number. Documents whose references differ are still paired when date (±2 days) and content agree, nearest date first; the gap is flagged "אסמכתא".
2. **Groups inside a document** — 1:1, or 1:k / k:1 (k ≤ 4) within one product family. Names are a soft signal: rows are matched on document, date, weight and price, and only two different *known* families rule a pair out. Multi-row groups must add up to the same weight. A pair is rejected only when both weight and price differ by more than 5%. The chosen groups cover as many rows as possible, then maximise a score (name, weight, price, packages, date).
3. **Absorbing** — inside a paired document, a leftover row joins the same-product group whose weight gap it reduces (large or uneven splits, e.g. one row against 12); a row that would only widen a gap stays unmatched.
4. **Leftovers** — remaining rows are tried across documents (a pair with unrelated names must then agree on both weight and price); whatever is left is listed as "רק אצל הספק" / "רק אצל תאנה ורימון".
5. **Money** — compared net: the supplier's printed line total (per-line discount, which may be 0%) vs Teena-Rimon's amount minus its commercial discount. Pallet charges and VAT are not compared.
6. **Offsetting** — when the net item totals are equal, price/weight gaps cancel out and are shown in a separate section.

Product names are matched by `NameMatcher` (`core/src/reconcile/names/`): names are parsed into family / colour / cultivar / size / grade using `dictionary.ts`. A product missing from the dictionary falls back to the stem of its first word ("עגבניות" ≈ "עגבניה"), so new products need no dictionary entry; a group matched on numbers alone carries a "שם:" note. The dictionary is optional enrichment — unknown words on matched rows are listed in the UI as dictionary suggestions.

## Deploying to AWS

See [DEPLOY.md](DEPLOY.md). In short: `npm run install:all`, then `npm run deploy`.

## Ports

| Service | Port |
| --- | --- |
| Frontend (Vite) | `43123` |
| Backend (Express) | `43124` |
