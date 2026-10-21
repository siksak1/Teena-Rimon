# Changelog

Versions follow semver. The version shown in the app footer comes from the root `package.json`, followed by the git commit of the build.

## Unreleased

- **AI fallback for supplier formats nothing else reads** (config `aiFallback`; on for Teena-Rimon, configVersion 6). Order of attempts: own parser → generic parsers → for an unknown scan, whole-page OCR then the generic parsers → the supplier's learned layout (fetched by VAT number, applied in the browser) → Claude Sonnet 5.5 through the new `backend/` Lambda. The AI's answer is checked against the PDF and rows that fail are marked "⚠ לבדיקה"; the layout it describes is kept only if the table parser reads the same lines with it, so the supplier's next invoice is read in the browser. Results show "מבנה נלמד" / "נקרא בעזרת AI".
- Unknown scans: whole-page OCR (`core/src/pdf/ocrDocument.ts`) feeds the generic parsers. Har-Kor's scan, without its parser, reads amount for amount like its parser. The table parser also accepts a footer discount proven by its printed amount, and on OCR text restores one misread row when a printed total proves it.
- Backend: DynamoDB table of learned layouts and usage counters, a per-customer daily cap (30), SNS e-mails when the month's AI calls reach each threshold (25, 50, 100) and when a new supplier format is learned, an AWS budget alarm. `scripts/formats.sh` lists learned formats and AI usage and cost.
- The CSP's `connect-src` adds the backend's Function URL. Deploy the stack (`DEPLOY.md` → AI fallback: the API key goes into SSM first) before releasing this version.
- Analytics: `supplier_source`; error codes `AI_UNAVAILABLE`, `AI_RATE_LIMITED`, `AI_UNREADABLE`. The privacy statement and the IT guide describe when a supplier invoice is sent out.
- Dev-only customer config `ai-test` (no parsers, generic off: everything goes to the layout or the AI); `release.sh` refuses it.

- Rows that share a delivery note (אסמכתא) are matched whatever their dates; the `dateWindowDays` limit now applies only to rows with different references (first: Meshek Meltzer's 102190, 3 days apart in the two reports).
- Excel mode: a grower whose name is contained in the other report's name, by whole words, is paired as the same grower ("ערדום" ↔ "מארק ערדום").
- Excel mode reads reports whatever their column names and order: each column's role (date, grower, item, document, packages, weight, price, variety) is found from its values, and the delivery-note column is the one whose values also appear in the other report. Header names only break near-ties; an uncertain choice is shown as a warning, and the results page lists the columns used. Config: `excel.supplierFormat` / `excel.ownFormat` are removed; configVersion 5.
- Partial sums: clicking rows in the results tables (Shift-click for a range) shows their total kg and ₪ in a bar fixed to the bottom of the screen, split into supplier / Teena-Rimon / difference when both sides are selected. Own lines count at their net after the commercial discount. The selection is not exported; Esc or "נקה" clears it.
- Suppliers with no parser of their own are read by two generic parsers (config `genericFallback`, on by default; configVersion 4): any AGROLINE supplier invoice, named from the "לכבוד:" line of the wholesaler's draft (first: Meshek Dudu), and a table parser that finds the item columns by quantity × price × (1 − discount) = total and accepts the result only when it adds up to a printed total. On every supplier sample with a dedicated parser it reads the same lines, field by field. The results page marks such invoices "פורמט כללי".
- PDFs printed with "Microsoft Print to PDF" (Hebrew letters missing from the text layer) are read: the missing text is rendered and read by OCR, the amounts still come from the text. Without OCR they are refused with the new error code `TEXT_LAYER_BROKEN`.
- New dev dependency `@napi-rs/canvas` (pdf.js page rendering in the Node tests).

- Excel mode: a PDF / Excel switch compares the supplier's grower sales report with Teena-Rimon's weighings report (both .xlsx, many growers per file). Growers are paired across the reports, weighings that add up to one sale form a group, and the results and export gain a grower column. Config: `excel` block, `tolerances.sumToleranceRel`; configVersion 3.
- Analytics: error codes `NOT_EXCEL` and `MISSING_COLUMN`.
- A delivery document whose rows all matched and whose weight and price gaps add up to at most 1 ₪ is no longer shown as a gap; its rows get the note "הפרש זניח בתעודה כולה". Package-count, discount, name and reference gaps are still reported. Config: `tolerances.documentToleranceNis` (1 for Teena-Rimon; unset = off).
- The day gap between matched rows is shown (on screen and in the Excel export) only when it is more than 7 days.
- Har-Kor's scanned invoices are supported: the scan is read by OCR (Tesseract, WebAssembly) in the browser. Each row and column is checked against the invoice's printed totals; rows that can't be confirmed are marked "⚠ לבדיקה". The OCR code and models load only when a scan is uploaded.
- The CSP allows `'wasm-unsafe-eval'` (WebAssembly from the app's own files); `connect-src` is unchanged. The headers live in the CloudFront stack: run `cd infra && npx cdk deploy` before releasing this version, or scanned invoices fail under the old policy (digital PDFs work either way).
- pdf.js is now `pdfjs-dist` 6.3.289 instead of the copy bundled in unpdf (6.1.200, affected by GHSA-hq66-cqwq-w95j), and runs in its own worker.
- Analytics: `supplier_scanned` and `ocr_uncertain_lines` counts; error code `SCAN_UNREADABLE`.

- Invoice PDFs are parsed only in the browser; the `/api/extract` server backend is removed.
- Fonts are bundled with the app instead of loaded from Google Fonts.
- Pages carry a `noindex` robots meta tag.
- The footer shows the app version and build commit.
- Supplier formats: Granot, Shivuk HaHof, D. Hai, Achim Menashri, HaHaklaim, Galil Shuk Mekomi, Shivuk HaAsor, Bananot Carmel.
