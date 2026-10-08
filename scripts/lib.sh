# Shared helpers for scripts/release.sh and scripts/token.sh (sourced, not run).
# Reads the deployed stack's outputs; needs the AWS CLI (logged in) and jq.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

STACK=LedgerMatchStatic
REGION=$(jq -r '.context.region' infra/cdk.json)
# Every input of a build; release refuses to ship uncommitted changes to these.
BUILD_INPUTS=(core frontend customers package.json)

die() { echo "error: $*" >&2; exit 1; }

stack_output() {
  aws cloudformation describe-stacks --stack-name "$STACK" --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

load_stack() {
  BUCKET=$(stack_output BucketName) || die "stack $STACK not found in $REGION — deploy infra first"
  KVS_ARN=$(stack_output RoutesArn)
  SITE_HOST=$(stack_output SiteHost)
}

require_customer() {
  [[ -n "${1:-}" ]] || die "missing customer slug"
  [[ -f "customers/$1/config.json" ]] || die "no customers/$1/config.json"
}

# --- KeyValueStore: token -> {"slug","build","channel"} ----------------------

kvs_etag() {
  aws cloudfront-keyvaluestore describe-key-value-store --kvs-arn "$KVS_ARN" --query ETag --output text
}

kvs_put() { # <token> <json value>
  aws cloudfront-keyvaluestore put-key --kvs-arn "$KVS_ARN" --key "$1" --value "$2" \
    --if-match "$(kvs_etag)" >/dev/null
}

kvs_delete() { # <token>
  aws cloudfront-keyvaluestore delete-key --kvs-arn "$KVS_ARN" --key "$1" \
    --if-match "$(kvs_etag)" >/dev/null
}

# One JSON object per line: {"token","slug","build","channel"}.
kvs_routes() {
  aws cloudfront-keyvaluestore list-keys --kvs-arn "$KVS_ARN" --output json \
    | jq -c '(.Items // [])[] | {token: .Key} + (.Value | fromjson)'
}

route_value() { # <slug> <build> <channel>
  jq -nc --arg slug "$1" --arg build "$2" --arg channel "$3" '{slug: $slug, build: $build, channel: $channel}'
}

build_exists() { # <slug> <build>
  aws s3api head-object --bucket "$BUCKET" --key "builds/$1/$2/index.html" >/dev/null 2>&1
}

url_for() { echo "https://$SITE_HOST/$1/"; }
