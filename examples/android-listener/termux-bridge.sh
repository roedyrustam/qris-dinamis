#!/usr/bin/env bash
# Termux + Termux:API lightweight Android notification bridge for @qris-dinamis/api
# Prerequisites: pkg install termux-api jq curl
set -euo pipefail

API_URL="${QRIS_API_URL:-http://localhost:3001}"
MERCHANT_ID="${QRIS_MERCHANT_ID:?Set QRIS_MERCHANT_ID}"
API_KEY="${QRIS_API_KEY:-}"
SEEN_FILE="${HOME}/.qris_seen_notifications"
touch "$SEEN_FILE"

echo "Starting QRIS Dinamis Termux Notification Bridge -> ${API_URL}"

while true; do
  termux-notification-list | jq -c '.[]' | while read -r notif; do
    id=$(echo "$notif" | jq -r '.key // .id')
    pkg=$(echo "$notif" | jq -r '.packageName')
    title=$(echo "$notif" | jq -r '.title // ""')
    content=$(echo "$notif" | jq -r '.content // ""')

    if grep -Fxq "$id" "$SEEN_FILE"; then
      continue
    fi

    source_name=""
    case "$pkg" in
      *bca*) source_name="bca" ;;
      *brimo*|*bri*) source_name="brimo" ;;
      *livin*|*mandiri*) source_name="livin" ;;
      *wondr*|*bni*) source_name="wondr" ;;
      *gobiz*|*gojek*) source_name="gobiz" ;;
      *ovo*) source_name="ovo" ;;
      *dana*) source_name="dana" ;;
      *shopee*) source_name="shopeepay" ;;
      *) continue ;;
    esac

    payload=$(jq -n --arg m "$MERCHANT_ID" --arg s "$source_name" --arg t "$title - $content" \
      '{merchantId: $m, source: $s, text: $t}')

    if [ -n "$API_KEY" ]; then
      curl -fsS -X POST "${API_URL}/v1/ingest/notification" \
        -H "Content-Type: application/json" \
        -H "X-Api-Key: ${API_KEY}" \
        -d "$payload" >/dev/null || true
    else
      curl -fsS -X POST "${API_URL}/v1/ingest/notification" \
        -H "Content-Type: application/json" \
        -d "$payload" >/dev/null || true
    fi

    echo "$id" >> "$SEEN_FILE"
  done
  sleep 3
done
