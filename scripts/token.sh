#!/usr/bin/env bash
# Manage the secret URLs customers use. A URL is https://<host>/<token>/, and
# the token is stored only in the CloudFront KeyValueStore — never in git.
# Keep your own list of who has which URL in a password manager.
#
#   scripts/token.sh add <customer> [--preview] [--build <build>]   new URL (defaults to the build the customer's production URL serves)
#   scripts/token.sh rotate <token>                                 new URL for the same customer/build, then the old one stops working
#   scripts/token.sh revoke <token>                                 the URL stops working within seconds (customer stopped paying, link leaked…)
#   scripts/token.sh list [<customer>]
source "$(dirname "$0")/lib.sh"

new_token() { # <slug> — "<slug>-" + 16 random [a-z0-9] (≈82 bits; unguessable)
  local random
  random=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 16) || true
  echo "$1-$random"
}

route_for() { # <token> → its JSON, or nothing
  kvs_routes | jq -c --arg token "$1" 'select(.token == $token)'
}

CMD=${1:-}
shift || true
load_stack

case "$CMD" in
  add)
    SLUG=${1:-}
    shift || true
    require_customer "$SLUG"
    CHANNEL=production
    BUILD=
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --preview) CHANNEL=preview ;;
        --build) BUILD=${2:-}; shift ;;
        *) die "unknown option $1" ;;
      esac
      shift
    done
    if [[ -z "$BUILD" ]]; then
      BUILD=$(kvs_routes | jq -r --arg slug "$SLUG" 'select(.slug == $slug and .channel == "production") | .build' | head -1)
      [[ -n "$BUILD" ]] || die "$SLUG has no production URL to copy the build from — pass --build <build> (see scripts/release.sh $SLUG --list)"
    fi
    build_exists "$SLUG" "$BUILD" || die "build $BUILD is not uploaded for $SLUG"
    TOKEN=$(new_token "$SLUG")
    kvs_put "$TOKEN" "$(route_value "$SLUG" "$BUILD" "$CHANNEL")"
    echo "New $CHANNEL URL for $SLUG (build $BUILD):"
    echo "  $(url_for "$TOKEN")"
    ;;

  rotate)
    OLD=${1:-}
    ROUTE=$(route_for "$OLD")
    [[ -n "$ROUTE" ]] || die "no such token"
    SLUG=$(jq -r .slug <<<"$ROUTE")
    TOKEN=$(new_token "$SLUG")
    kvs_put "$TOKEN" "$(jq -c 'del(.token)' <<<"$ROUTE")"
    kvs_delete "$OLD"
    echo "Replaced $(url_for "$OLD") (no longer works) with:"
    echo "  $(url_for "$TOKEN")"
    ;;

  revoke)
    OLD=${1:-}
    [[ -n "$(route_for "$OLD")" ]] || die "no such token"
    kvs_delete "$OLD"
    echo "Revoked: $(url_for "$OLD") now returns 404 (within a few seconds)."
    ;;

  list)
    kvs_routes | jq -r --arg slug "${1:-}" \
      'select($slug == "" or .slug == $slug) | "\(.slug)\t\(.channel)\t\(.build)\t\(.token)"'
    ;;

  *)
    sed -n '2,10p' "$0"
    exit 1
    ;;
esac
