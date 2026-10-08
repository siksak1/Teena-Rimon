# Deploying LedgerMatch

LedgerMatch is a static site. Invoice PDFs are parsed in the customer's browser; there is no server code anywhere in the deployment.

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

Run releases from your own machine. Commit first, because a release refuses uncommitted changes to `core/`, `frontend/`, `customers/` or `package.json`.

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
