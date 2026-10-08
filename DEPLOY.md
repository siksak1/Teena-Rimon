# Deploying LedgerMatch to AWS

The previous deployment (CloudFront + an `/api/extract` Lambda that parsed uploaded PDFs) was removed on 2026-10-08.

The new deployment is being built: a static site on S3 + CloudFront, a secret URL path per customer (`/<slug>-<random>/`), routed by a CloudFront Function and KeyValueStore, with a strict Content Security Policy and `noindex` headers. Releases are made from the developer's machine with `scripts/release.sh`. This document will describe it once it exists.

Until then, don't deploy `infra/`: the current stack would serve the app publicly at the site root.
