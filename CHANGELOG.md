# Changelog

Versions follow semver. The version shown in the app footer comes from the root `package.json`, followed by the git commit of the build.

## Unreleased

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
