# Deploying LedgerMatch to AWS

## What gets deployed

```
Browser ──► CloudFront (HTTPS)
              ├── /*      ──► S3 bucket (private)    ← frontend/dist
              └── /api/*  ──► Lambda Function URL    ← backend/src/lambda.ts
```

- **`LedgerMatch` stack** in **eu-central-1**: S3, Lambda and CloudFront, defined in `infra/lib/ledgermatch-stack.ts`. Change `"region"` in `infra/cdk.json` to move it.
- **`LedgerMatchEdge` stack** in **us-east-1** (optional, **off by default**): only the WAF web ACL, because AWS requires CloudFront's WAF to live there. It's created only when `"enableWaf": true` is set in `infra/cdk.json` (`infra/lib/edge-stack.ts`).
- **Frontend**: private S3 bucket, served only through CloudFront.
- **Backend**: the Express app wrapped for Lambda (Node 22, arm64, 512 MB, 90 s timeout). CloudFront waits up to 60 s for it.
- **Direct-access protection**: CloudFront sends a secret `x-origin-verify` header, and the Lambda answers `403` to any request without it. The secret is generated in Secrets Manager.
- **WAF (optional)**: when enabled, blocks an IP after 100 `/api/*` requests in 5 minutes, plus AWS's list of known-bad IPs.
- **Parsing**: deterministic, using the shared `core/` package bundled into the Lambda — no AI provider or API key. Build the frontend with `VITE_PARSE_MODE=client` to parse in the browser instead (the Lambda is then unused).
- **Upload limit**: 2 MB per PDF (Lambda accepts at most 6 MB per request).

Estimated cost at low traffic: about **$0.50/month**, mostly the $0.40 secret; S3, CloudFront and Lambda are close to free at this volume. Enabling WAF adds about $6/month.

---

## One-time setup

### 1. Install tools
- Node.js 20 or newer
- AWS CLI v2: `brew install awscli`

### 2. AWS credentials
Use any IAM user or role with `AdministratorAccess`, signed in to the default CLI profile (`aws login` or `aws configure`). Don't use the root account.

Check who you're signed in as:
```bash
aws sts get-caller-identity
```

To use a named profile instead, add `--profile <name>` to the `cdk` commands below, or prefix `npm run` commands with `AWS_PROFILE=<name>`.

### 3. Install project dependencies
From the repo root:
```bash
npm run install:all
```

### 4. Bootstrap CDK
This is needed once per account and region. It creates the S3 bucket and roles CDK uses to deploy.
```bash
cd infra
npx cdk bootstrap aws://<ACCOUNT_ID>/eu-central-1
cd ..
```
If you enable WAF, also bootstrap us-east-1: `npx cdk bootstrap aws://<ACCOUNT_ID>/us-east-1`.

---

## Deploy (first time and every update)

From the repo root:
```bash
npm run deploy
```

This builds the frontend and bundles the Lambda. It then lists any security-related changes for you to approve, and deploys the eu-central-1 app stack (plus the us-east-1 WAF stack first, if enabled).

- **Time**: the first deploy takes about 5–10 minutes, mostly creating CloudFront. Later deploys take 1–3 minutes.
- **Result**: at the end it prints:
  ```
  LedgerMatch.SiteUrl = https://dxxxxxxxxxxxx.cloudfront.net
  ```
  Open that URL, upload a Teena-Rimon draft and a supplier invoice (e.g. from `sample_data/`), and click **השוואת החשבוניות**.

To preview changes without deploying:
```bash
npm run deploy:diff
```

---

## Connecting your custom domain (later)

1. **Request a certificate.** In the AWS Console, open **Certificate Manager** and make sure the region is **us-east-1 (N. Virginia)**.
   - Request a public certificate for your domain, for example `app.example.com`.
   - Choose **DNS validation**.
   - Add the CNAME record it shows at your DNS provider, and wait until the status is **Issued**.
2. **Add the domain to the stack.** Set these in `infra/cdk.json`:
   ```json
   "domainName": "app.example.com",
   "certificateArn": "arn:aws:acm:us-east-1:123456789012:certificate/..."
   ```
3. **Redeploy**: `npm run deploy`
4. **Point DNS at CloudFront.** At your DNS provider, create a record for `app.example.com` pointing to the `CloudFrontDomain` value from the deploy output.
   - Subdomain: a `CNAME` record.
   - Root/apex domain: an `ALIAS`/`ANAME` record, or a Route 53 alias record.

---

## Useful commands

| Task | Command |
| --- | --- |
| Tail Lambda logs | `aws logs tail /ledgermatch/extract --follow --region eu-central-1` |
| Delete everything | `cd infra && npx cdk destroy` |

## Before real customers use it
- **WAF**: bootstrap us-east-1, set `"enableWaf": true` in `infra/cdk.json`, and redeploy, to rate-limit the API.
- **Authentication**: add Cognito and check the user's token in `backend/src/app.ts`. Until then, anyone with the URL can use the app.
- **AWS Budgets alert**: set one in the Billing console, for example at $20/month.
