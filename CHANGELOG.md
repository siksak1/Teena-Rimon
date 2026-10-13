# Changelog

Versions follow semver. The version shown in the app footer comes from the root `package.json`, followed by the git commit of the build.

## Unreleased

- Har-Kor's scanned invoices are supported: the scan is read by OCR (Tesseract, WebAssembly) in the browser. Each row and column is checked against the invoice's printed totals; rows that can't be confirmed are marked "⚠ לבדיקה". The OCR code and models load only when a scan is uploaded.
- The CSP allows `'wasm-unsafe-eval'` (WebAssembly from the app's own files); `connect-src` is unchanged. The headers live in the CloudFront stack: run `cd infra && npx cdk deploy` before releasing this version, or scanned invoices fail under the old policy (digital PDFs work either way).
- pdf.js is now `pdfjs-dist` 6.3.289 instead of the copy bundled in unpdf (6.1.200, affected by GHSA-hq66-cqwq-w95j), and runs in its own worker.
- Analytics: `supplier_scanned` and `ocr_uncertain_lines` counts; error code `SCAN_UNREADABLE`.

- Invoice PDFs are parsed only in the browser; the `/api/extract` server backend is removed.
- Fonts are bundled with the app instead of loaded from Google Fonts.
- Pages carry a `noindex` robots meta tag.
- The footer shows the app version and build commit.
- Supplier formats: Granot, Shivuk HaHof, D. Hai, Achim Menashri, HaHaklaim, Galil Shuk Mekomi, Shivuk HaAsor, Bananot Carmel.
