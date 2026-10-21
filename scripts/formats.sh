#!/usr/bin/env bash
# Supplier formats the AI has learned, and how much the AI is used. Reads the
# backend's DynamoDB table (the stack output AiTableName); never invoice data.
#
#   scripts/formats.sh list                    every learned format: VAT, supplier, version, first customer, AI calls, lookups, last used
#   scripts/formats.sh show <vat>              one learned layout, as stored
#   scripts/formats.sh delete <vat>            forget a layout: the supplier's next invoice goes to the AI and is learned again
#   scripts/formats.sh usage [<customer>] [<yyyy-mm>]   AI calls, new formats, unverified readings, tokens and cost (default: everyone, this month)
source "$(dirname "$0")/lib.sh"

CMD=${1:-}
shift || true
load_stack
[[ -n "$AI_TABLE" && "$AI_TABLE" != "None" ]] || die "the stack has no AI table yet — deploy infra first"

ddb() { aws dynamodb "$@" --table-name "$AI_TABLE" --region "$REGION" --output json; }

case "$CMD" in
  list)
    ddb scan --filter-expression "begins_with(pk, :p)" --expression-attribute-values '{":p":{"S":"PROFILE#"}}' \
      | jq -r '
          ["VAT", "SUPPLIER", "VERSION", "FIRST CUSTOMER", "AI CALLS", "LOOKUPS", "LAST USED"],
          (.Items | sort_by(.lastUsed.S) | reverse[] | (.profile.S | fromjson) as $p
            | [$p.vatId, $p.name, ($p.version | tostring), .firstCustomer.S, .aiCalls.N, .lookups.N, .lastUsed.S[0:10]])
          | @tsv' \
      | column -t -s $'\t'
    ;;

  show)
    VAT=${1:-}
    [[ "$VAT" =~ ^[0-9]{8,9}$ ]] || die "usage: scripts/formats.sh show <vat>"
    ddb get-item --key "{\"pk\":{\"S\":\"PROFILE#$VAT\"}}" | jq '.Item // error("no learned format for this VAT number") | (.profile.S | fromjson)'
    ;;

  delete)
    VAT=${1:-}
    [[ "$VAT" =~ ^[0-9]{8,9}$ ]] || die "usage: scripts/formats.sh delete <vat>"
    read -r -p "Forget the learned format of $VAT? Its next invoice goes to the AI. [y/N] " answer
    [[ "$answer" == y ]] || exit 0
    ddb delete-item --key "{\"pk\":{\"S\":\"PROFILE#$VAT\"}}" >/dev/null
    echo "Deleted."
    ;;

  usage)
    WHO=${1:-ALL}
    MONTH=${2:-$(date -u +%Y-%m)}
    [[ "$WHO" == ALL ]] || require_customer "$WHO"
    ddb get-item --key "{\"pk\":{\"S\":\"USAGE#$WHO#$MONTH\"}}" \
      | jq -r --arg who "$WHO" --arg month "$MONTH" '
          (.Item // {}) as $i
          | def n(k): ($i[k].N // "0" | tonumber);
          "\(if $who == "ALL" then "All customers" else $who end), \($month):",
          "  AI calls:            \(n("aiCalls"))",
          "  new formats learned: \(n("newFormats"))",
          "  layouts (re)learned: \(n("learned"))",
          "  unverified readings: \(n("unverified"))",
          "  tokens in / out:     \(n("inputTokens")) / \(n("outputTokens"))",
          "  estimated AI cost:   $\(n("costMicros") / 1000000 * 100 | round / 100)"'
    ;;

  *)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
