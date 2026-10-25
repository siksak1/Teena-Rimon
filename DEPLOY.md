# Deploying LedgerMatch

LedgerMatch is a static site. Invoice PDFs are parsed in the customer's browser. The one piece of server code is the **AI fallback** (`backend/`, see below): a Lambda that reads a supplier invoice that no reader in the browser can read, for customers whose config sets `aiFallback`.

```
Browser ──► CloudFront ──(viewer-request Function + KeyValueStore)──► private S3 bucket
https://<host>/<token>/     token → {customer, build, channel}       builds/<customer>/<build>/…
```

- Each customer gets one or more **secret URLs** `https://<host>/<customer>-<16 random chars>/`. The token lives only in the CloudFront KeyValueStore, never in git, because the repository is public. Keep your own record of who has which URL in a password manager.
- Anything else, including `/`, `/robots.txt`, unknown tokens and direct `/builds/…` paths, gets a plain `404` from the function and never reaches S3.
- Every response carries `X-Robots-Tag: noindex, nofollow, noarchive` and `Referrer-Policy: no-referrer`. The page also has a `noindex` meta tag. There is deliberately **no `robots.txt`**: it would be public and could reveal URLs, and blocking crawling would stop search engines from seeing the `noindex`.
- The **Content Security Policy** only allows the page's own files, plus network connections to `https://eu.i.posthog.com` (usage counts). Any other upload is blocked by the browser, even to our own server. The policy and the other headers are in `infra/lib/ledgermatch-stack.ts`.
- CloudFront access logs are off, because they would record the tokens.

**Stack:** `LedgerMatchStatic` in `eu-central-1` (`infra/`). It contains the S3 bucket (retained if the stack is deleted), the KeyValueStore, the routing function (`infra/functions/route.js`), the response-headers policy and the CloudFront distribution. It holds no builds and no tokens, so redeploying it never changes what a customer sees.

**Cost:** about $0–1/month at this scale (CloudFront and CloudFront Functions free tiers, cents for S3 and the KeyValueStore).

## Prerequisites

- Node.js 20+, the AWS CLI v2 and `jq`.
- Log in to AWS: `aws login`. Check the account with `aws sts get-caller-identity`.
- `npm run install:all` from the repo root.
- CDK bootstrap in `eu-central-1`. It is already done for account 334436989763 (`CDKToolkit` stack).

## Infrastructure (rarely)

```bash
cd infra
npx cdk diff      # review
npx cdk deploy    # first time ~5–10 min (CloudFront)
```

## Releasing a customer's app

Run releases from your own machine. Commit first, because a release refuses uncommitted changes to `core/`, `frontend/`, `customers/` or `package.json`. It also runs `npm test` and `npm run e2e` first and stops if either fails.

```bash
scripts/release.sh teena-rimon               # test → build → upload → point production URLs
scripts/release.sh teena-rimon --preview     # same, preview URLs only (try it before production)
scripts/release.sh teena-rimon --list        # uploaded builds and what each URL serves
scripts/release.sh teena-rimon --point 1.0.0-a08adf9   # roll back (seconds; no rebuild)
```

- A build is named `<package.json version>-<git commit>`. It is uploaded once to `builds/<customer>/<build>/` and never overwritten, so CloudFront never needs invalidating.
- Releasing one customer never touches another customer's URLs.
- The page footer shows `גרסה <version> (<commit>) · תצורה <configVersion>`, so you can always see what a customer is running.

## Customer URLs

```bash
scripts/token.sh add teena-rimon --build 1.0.0-a08adf9   # first URL for a customer
scripts/token.sh add teena-rimon                         # another production URL (same build)
scripts/token.sh add teena-rimon --preview               # a preview URL
scripts/token.sh list [teena-rimon]
scripts/token.sh rotate <token>     # link leaked: new URL, old one stops working
scripts/token.sh revoke <token>     # customer stopped paying: URL returns 404 within seconds
```

## AI fallback (backend)

```
Browser ──(only after every reader in the browser refused)──► CloudFront /api/* ──► Lambda Function URL ──► Claude Sonnet 5.5 (Anthropic API)
  GET  /api/profiles?vat=…   learned supplier layouts (labels only)                       │
  POST /api/parse            the supplier PDF + the rows read from it                      └─► DynamoDB: layouts + usage counters; SNS: alert e-mails
```

The order of attempts in the browser (`core/src/extract.ts`): the supplier's own parser → the generic parsers → for a scan, OCR of the whole page and the generic parsers on it → the supplier's **learned layout** (fetched by VAT number, applied in the browser) → the AI. Every step refuses unless the lines add up to a printed total. The AI's answer is checked against the PDF (`core/src/ai/verify.ts`); a layout is kept only if it reads the same lines alone, so the supplier's next invoice is read in the browser without the AI.

**One-time setup**

1. Anthropic API key (Console → API keys; set a monthly spend limit and a spend notification there too). Store it in SSM, in the stack's region; it never goes into git or CDK:
   ```bash
   aws ssm put-parameter --region eu-central-1 --name /ledgermatch/anthropic-api-key --type SecureString --value 'sk-ant-…'
   ```
2. In `infra/cdk.json` set `alertEmail` (alert e-mails and the AWS budget). The other settings:

   | context key | default | meaning |
   | --- | --- | --- |
   | `aiAlertThresholds` | `"25,50,100"` | monthly AI calls (all customers) that each send one e-mail |
   | `aiAlertNewFormats` | `true` | also e-mail each time a supplier format is learned |
   | `aiDailyLimit` | `30` | AI calls per customer per day; above it the app says to try tomorrow |
   | `monthlyBudgetUsd` | `20` | AWS Budgets e-mail at 80% actual / 100% forecast of the whole account |

3. `cd infra && npx cdk deploy`. SNS sends a confirmation e-mail to `alertEmail`: click it, or no alert arrives.
4. Release each customer again (`scripts/release.sh <slug>`): the build picks up the `AiEndpoint` output (`/api/`) as `VITE_AI_ENDPOINT`. The backend is on the site's own address, so whatever lets the page load (an ad blocker, a company or ISP filter) lets the AI through too. The CSP allows exactly `https://<siteHost>/api/` — set `siteHost` in `infra/cdk.json` to the `CloudFrontDomain` output after the first deploy (not needed with `domainName`) — plus the Function URL, which builds made before `/api/` call directly. CloudFront waits at most 60 seconds for an answer (AI reads have taken 16–50 s); beyond that the app says the reading took too long. The limit can go up to 180 s with a Service Quotas request (CloudFront → *Response timeout per origin*), then `readTimeout` in the stack. A customer's app uses it only if its config sets `aiFallback: true` — agree on it with the customer first (`docs/privacy-statement.md`).

**Tracking**

```bash
scripts/formats.sh list                 # learned supplier formats: VAT, name, version, first customer, AI calls, lookups, last used
scripts/formats.sh usage                # this month, all customers: AI calls, new formats, unverified readings, tokens, est. cost
scripts/formats.sh usage teena-rimon 2026-10
scripts/formats.sh show <vat>           # one learned layout
scripts/formats.sh delete <vat>         # forget it: the next invoice goes to the AI and is learned again
```

PostHog: `reconciliation_completed.supplier_source` is `dedicated`, `generic`, `ocr_generic`, `profile` or `ai` — e.g. a weekly insight of `ai` events is "invoices that needed the AI". A supplier that keeps coming back as `ai` (its layout cannot be learned) is a candidate for a generic-parser fix or a parser of its own; `formats.sh show` and the Lambda's log (counts only) help.

**Cost** at under 200 supplier invoices a month: the Lambda, DynamoDB, SNS and logs stay within a few cents. The AI runs only for a supplier's first invoice, a scan nothing else reads, or after a layout change — roughly 5–20 calls a month at about $0.05–0.08 each (Sonnet 5.5, $2 / $10 per million tokens): **about $1–3 a month**. The daily cap per customer, the alert thresholds, the AWS budget and the Anthropic spend limit bound the worst case.

**Local testing.** `npm run backend:dev` runs the same handler on `http://localhost:43124`, with layouts and counters in `backend/.dev-store.json` and alerts printed to the terminal (needs `ANTHROPIC_API_KEY` or `ant auth login`; it calls the real API). Then `VITE_AI_ENDPOINT=http://localhost:43124 CUSTOMER=ai-test npm run dev`: the `ai-test` config (released only to preview URLs: `scripts/release.sh ai-test --preview`, then `scripts/token.sh add ai-test --preview --build <build>`) has no supplier parsers and the generic parsers off, so every invoice goes to the learned layout or the AI. Upload a supplier invoice twice: the first time the log shows an AI call and a new format, the second time only a profile lookup and no AI call. `AI_ALERT_THRESHOLDS=2 npm run backend:dev` shows the alert after the second AI call. The opt-in live test (`RUN_AI_TESTS=1 npm test --prefix backend -- ai.live`, about $1) sends every sample to the AI with all local readers skipped and compares the answers with the dedicated parsers.

## After every deploy or release: check it

```bash
HOST=<SiteHost output>; TOKEN=<a customer token>
curl -sI https://$HOST/$TOKEN/ | grep -iE '^(HTTP|x-robots-tag|referrer-policy|content-security-policy)'
curl -s  https://$HOST/$TOKEN/ | grep 'name="robots"'          # the meta tag (same as view-source)
curl -sI https://$HOST/$TOKEN | grep -iE '^(HTTP|location)'     # 301 → trailing slash
for p in / /robots.txt /nope-123456789/ /builds/; do curl -so /dev/null -w "$p %{http_code}\n" https://$HOST$p; done   # all 404
```

## Custom domain (later)

1. In ACM, **us-east-1**: request a certificate for e.g. `app.example.com` (DNS validation).
2. In `infra/cdk.json`: set `domainName` and `certificateArn`, then `npx cdk deploy`.
3. At your DNS provider: point `app.example.com` (CNAME, or ALIAS for an apex domain) at the `CloudFrontDomain` output.
4. Existing tokens keep working on the new host. Send customers the new URLs.

Until then the host is the distribution's `*.cloudfront.net` name. If the stack were ever deleted and recreated, that name would change and every customer URL with it, which is another reason to add a domain.
