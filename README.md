# LedgerMatch — Invoice Reconciliation

Frontend-heavy invoice reconciliation: a minimal TypeScript API extracts structured line items from two PDFs (mock in development), and the React app owns all name normalization, matching, and discrepancy math.

## Architecture

```
/frontend   React + Vite + TypeScript   ← comparison brain + UI
/backend    Express + TypeScript        ← Lambda-ready /api/extract bridge
```

| Layer | Responsibility |
| --- | --- |
| **Backend** | Accept two PDFs → call AI structured output (or mock) → return raw JSON |
| **Frontend** | Mapping dictionary, normalize names, match rows, compute qty/price/total diffs, render dashboard |

## Quick start

```bash
# Terminal 1 — API (mock mode when NODE_ENV=development)
cd backend
npm install
npm run dev
# → http://127.0.0.1:43124

# Terminal 2 — UI (proxies /api → backend)
cd frontend
npm install
npm run dev
# → http://127.0.0.1:43123
```

Open [http://127.0.0.1:43123](http://127.0.0.1:43123). Drop any two PDF files (content ignored in mock mode) and click **Compare invoices**.

## Mock mode

When `NODE_ENV === "development"`, `POST /api/extract` **never** calls Gemini/OpenAI. It returns hardcoded Hebrew produce line items that exercise:

- Exact matches
- Price mismatch (yellow)
- Quantity / weight mismatch (yellow)
- Combined mismatch (red)
- Name aliasing via the dictionary (`"ונוס (אדום)"` → `"פיטאיה"`)
- Our-only / supplier-only rows

## Frontend comparison flow

1. `extractInvoices(ourFile, supplierFile)` → raw `ExtractionResult`
2. `compareInvoices(extraction)` in `frontend/src/lib/compare.ts`
   - `normalizeProductName()` via `frontend/src/lib/normalize.ts`
   - Match on canonical name
   - Diff quantity, unit price, line total
3. `DiscrepancyDashboard` renders severity-sorted rows

Extend aliases in `PRODUCT_NAME_MAP` inside `frontend/src/lib/normalize.ts`.

## Production AI hook

Set `GEMINI_API_KEY` or `OPENAI_API_KEY` and implement the call in `backend/src/extract.ts` using `invoiceExtractionSchema` from `backend/src/schema.ts`. Keep `NODE_ENV` out of `development` so the mock path is skipped.

## Lambda note

`backend/src/index.ts` exports `app`. Wrap with `@vendia/serverless-express` (or similar) for AWS Lambda; no comparison logic lives in the function.

## Ports

| Service | Port |
| --- | --- |
| Frontend (Vite) | `43123` |
| Backend (Express) | `43124` |
