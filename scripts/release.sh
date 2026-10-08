#!/usr/bin/env bash
# Ship, roll back or inspect one customer's app. Run from your own machine.
#
#   scripts/release.sh <customer>                   test, build, upload, point the customer's production URLs at it
#   scripts/release.sh <customer> --preview         same, but only the customer's preview URLs
#   scripts/release.sh <customer> --point <build>   repoint production URLs to an uploaded build (rollback); add --preview for preview URLs
#   scripts/release.sh <customer> --list            uploaded builds and what each URL serves
#
# A build is "<package.json version>-<git commit>", uploaded once to
# s3://<bucket>/builds/<customer>/<build>/ and never overwritten. Pointing a
# URL at it is a KeyValueStore edit that takes effect within seconds.
source "$(dirname "$0")/lib.sh"

SLUG=${1:-}
shift || true
MODE=release
CHANNEL=production
TARGET=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --preview) CHANNEL=preview ;;
    --point) MODE=point; TARGET=${2:-}; shift ;;
    --list) MODE=list ;;
    *) die "unknown option $1" ;;
  esac
  shift
done
require_customer "$SLUG"
load_stack

point_urls() { # <build>
  local routes count=0
  routes=$(kvs_routes | jq -c --arg slug "$SLUG" --arg channel "$CHANNEL" 'select(.slug == $slug and .channel == $channel)')
  while IFS= read -r route; do
    [[ -z "$route" ]] && continue
    local token
    token=$(jq -r .token <<<"$route")
    kvs_put "$token" "$(route_value "$SLUG" "$1" "$CHANNEL")"
    echo "  $(url_for "$token")  →  $1"
    count=$((count + 1))
  done <<<"$routes"
  if [[ $count -eq 0 ]]; then
    echo "  (no $CHANNEL URL for $SLUG yet — create one: scripts/token.sh add $SLUG $([[ $CHANNEL == preview ]] && echo --preview) --build $1)"
  fi
}

case "$MODE" in
  list)
    echo "Builds uploaded for $SLUG:"
    aws s3 ls "s3://$BUCKET/builds/$SLUG/" | awk '{print "  " $2}' | sed 's#/$##'
    echo "URLs:"
    kvs_routes | jq -r --arg slug "$SLUG" 'select(.slug == $slug) | "  \(.channel)\t\(.build)\t\(.token)"'
    ;;

  point)
    [[ -n "$TARGET" ]] || die "--point needs a build, e.g. 1.0.0-a08adf9 (see --list)"
    build_exists "$SLUG" "$TARGET" || die "build $TARGET is not uploaded for $SLUG (see --list)"
    echo "Pointing $SLUG $CHANNEL URLs at $TARGET:"
    point_urls "$TARGET"
    ;;

  release)
    [[ -z "$(git status --porcelain -- "${BUILD_INPUTS[@]}")" ]] \
      || die "uncommitted changes in ${BUILD_INPUTS[*]} — commit them first, so the build matches a commit"
    BUILD="$(jq -r .version package.json)-$(git rev-parse --short HEAD)"
    build_exists "$SLUG" "$BUILD" && die "build $BUILD already uploaded for $SLUG — to serve it, use --point $BUILD"

    echo "Testing…"
    npm test --silent >/dev/null 2>&1 || die "tests failed (run npm test)"

    echo "Building $SLUG $BUILD…"
    CUSTOMER="$SLUG" npm run build --silent >/dev/null
    grep -q 'name="robots" content="noindex, nofollow, noarchive"' frontend/dist/index.html \
      || die "built index.html lacks the noindex meta tag"

    DEST="s3://$BUCKET/builds/$SLUG/$BUILD"
    echo "Uploading to $DEST/…"
    # Hashed assets first (cached forever), then index.html (always revalidated).
    aws s3 cp frontend/dist "$DEST/" --recursive --exclude index.html --only-show-errors \
      --cache-control "public, max-age=31536000, immutable"
    aws s3 cp frontend/dist/index.html "$DEST/index.html" --only-show-errors \
      --cache-control "no-cache" --content-type "text/html; charset=utf-8"

    echo "Pointing $SLUG $CHANNEL URLs at $BUILD:"
    point_urls "$BUILD"
    echo "Done. The footer of the page now shows $(jq -r .version package.json) ($(git rev-parse --short HEAD))."
    ;;
esac
