#!/usr/bin/env bash
# Puts our own app with a maker (a connector with `app: true`, or one of our own
# like Microsoft, in packages/shared/src/connectors.ts) into the engine's vault, so its card in
# Conexiones turns on. Run it by hand in a terminal, after registering the app
# in the maker's developer portal:
#
#   bash scripts/connector-app.sh hubspot <client-id>
#
# The secret is typed (or pasted) at the hidden prompt: it never goes on the
# command line, in a file or in a chat. Run again to rotate it; the engine picks
# the new one up within ten minutes, no deploy needed.
set -euo pipefail
cd "$(dirname "$0")/.."

export CLOUDSDK_ACTIVE_CONFIG_NAME=${CLOUDSDK_ACTIVE_CONFIG_NAME:-ghostaff}
P=ghostaff-prod
R=europe-west1

id=${1:-}
client_id=${2:-}
if [ -z "$id" ] || [ -z "$client_id" ]; then
  echo "usage: bash scripts/connector-app.sh <connector-id> <client-id>" >&2
  exit 2
fi
if ! grep -q "id: '$id'," packages/shared/src/connectors.ts; then
  echo "no connector '$id' in packages/shared/src/connectors.ts" >&2
  exit 2
fi

read -rsp "Client secret for $id (hidden; empty if the app has none): " client_secret
echo
name="engine-app-$id"
payload=$(CLIENT_ID="$client_id" CLIENT_SECRET="$client_secret" node -e \
  'const s=process.env.CLIENT_SECRET; process.stdout.write(JSON.stringify({client_id: process.env.CLIENT_ID, ...(s ? {client_secret: s} : {})}))')

if ! gcloud secrets describe "$name" --project "$P" >/dev/null 2>&1; then
  gcloud secrets create "$name" --project "$P" --replication-policy user-managed --locations "$R" \
    --labels kind=app,provider="$id" >/dev/null
fi
printf '%s' "$payload" | gcloud secrets versions add "$name" --project "$P" --data-file=- >/dev/null
# Only the new version stays live.
latest=$(gcloud secrets versions list "$name" --project "$P" --filter state=ENABLED --sort-by ~createTime --format 'value(name.basename())' --limit 1)
for v in $(gcloud secrets versions list "$name" --project "$P" --filter state=ENABLED --format 'value(name.basename())'); do
  [ "$v" = "$latest" ] || gcloud secrets versions destroy "$v" --secret "$name" --project "$P" --quiet >/dev/null
done
echo "$id: app saved in $name. The card turns on within ten minutes."
