#!/usr/bin/env bash
# Deploys the engine's HTTP service to an environment's Google Cloud project (region europe-west1) and
# keeps its tick: Cloud Scheduler calling /cron every five minutes. Each run deploys the current commit.
#
#   bash scripts/deploy-engine.sh beta   # or prod
#
# The project must be set up first (scripts/setup-env.sh). Runs on a laptop (gcloud signed in as
# ghostaff.ai@gmail.com, docker) and in CI (signed in as the project's deployer).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh "${1:-}"

SA="engine@$P.iam.gserviceaccount.com"
SCHEDULER_SA="scheduler@$P.iam.gserviceaccount.com"
RUNNER_SA="runner@$P.iam.gserviceaccount.com"
REGISTRY="$R-docker.pkg.dev"
IMAGE="$REGISTRY/$P/engine/engine:$(git rev-parse --short HEAD)"

ENV_VARS="SUPABASE_URL=$SUPABASE_URL,GCP_PROJECT=$P,SECRETS_LOCATION=$R,ENGINE_SERVICE_ACCOUNT=$SA,ENGINE_PUBLIC_URL=$ENGINE_URL,CRON_CALLERS=$SCHEDULER_SA,RUNNER_IDENTITY=$RUNNER_SA,TENANTS_PROJECT=$TENANTS_P"
SECRETS="SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest"

# A connector turns on when its app's id is in scripts/env.sh and its secret is in this project.
connector() { # name id-variable id secret-variable secret-name
  if [ -n "$3" ] && gcloud secrets describe "$5" --project "$P" >/dev/null 2>&1; then
    ENV_VARS="$ENV_VARS,$2=$3"
    SECRETS="$SECRETS,$4=$5:latest"
  else
    echo "== $1 off: no id in scripts/env.sh or no secret $5 in $P"
  fi
}
connector Google GOOGLE_OAUTH_CLIENT_ID "$GOOGLE_CONNECTORS_CLIENT_ID" GOOGLE_OAUTH_CLIENT_SECRET google-oauth-connectors-secret
connector Instagram INSTAGRAM_APP_ID "$INSTAGRAM_APP_ID" INSTAGRAM_APP_SECRET instagram-app-secret
connector TikTok TIKTOK_CLIENT_KEY "$TIKTOK_CLIENT_KEY" TIKTOK_CLIENT_SECRET tiktok-client-secret
connector "Record (GitHub App)" GITHUB_APP_ID "$GITHUB_APP_ID" GITHUB_APP_KEY github-app-registro-key

# Our record store (scripts/setup-record-store.sh): when its address and its admin's token exist, the engine
# reaches Forgejo over the VPC. Only private ranges go through it; everything else leaves as before.
NETWORK_FLAGS=()
RECORD_STORE_IP=$(gcloud compute addresses describe record-store --region "$R" --project "$P" --format 'value(address)' 2>/dev/null || true)
if [ -n "$RECORD_STORE_IP" ] && gcloud secrets versions list FORGEJO_ADMIN_TOKEN --project "$P" --filter 'state=ENABLED' --format 'value(name)' 2>/dev/null | grep -q .; then
  ENV_VARS="$ENV_VARS,FORGEJO_URL=http://$RECORD_STORE_IP:3000"
  SECRETS="$SECRETS,FORGEJO_ADMIN_TOKEN=FORGEJO_ADMIN_TOKEN:latest"
  NETWORK_FLAGS=(--network default --subnet default --vpc-egress private-ranges-only)
else
  echo "== Record store off: no address record-store or no FORGEJO_ADMIN_TOKEN in $P"
fi

echo "== Build and push $IMAGE"
# Cloud Run runs amd64: built for it even on an Apple Silicon Mac (emulated, slower).
docker build --platform linux/amd64 -f apps/engine/Dockerfile -t "$IMAGE" .
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin "https://$REGISTRY"
docker push "$IMAGE"
docker logout "https://$REGISTRY" >/dev/null # the token was only for this push

echo "== Deploy to $P"
# Public URL on purpose: the app calls it, and every call but /health needs a Supabase sign-in token,
# checked by the engine itself. A 15-minute timeout: a Claude subscription's sign-in is one WebSocket
# of up to 10 minutes. 2 GiB: the engine runs Claude Code processes (a few hundred MB each, at most
# ENGINE_CLAUDE_SLOTS at once, 4 by default). Session affinity: a phone drops the sign-in's socket
# while the person signs in at Anthropic, and its reconnect must reach the instance that holds it.
gcloud run deploy engine --project "$P" --region "$R" --image "$IMAGE" \
  --service-account "$SA" --allow-unauthenticated --min-instances 0 --max-instances 3 \
  --timeout 900 --memory 2Gi --session-affinity \
  ${NETWORK_FLAGS[@]+"${NETWORK_FLAGS[@]}"} \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "$SECRETS"

echo "== The tick: Cloud Scheduler calls /cron every five minutes"
if gcloud scheduler jobs describe tick --location "$R" --project "$P" >/dev/null 2>&1; then VERB=update; else VERB=create; fi
gcloud scheduler jobs "$VERB" http tick --location "$R" --project "$P" \
  --schedule "*/5 * * * *" --time-zone "Europe/Madrid" --http-method POST --uri "$ENGINE_URL/cron" \
  --oidc-service-account-email "$SCHEDULER_SA" --oidc-token-audience "$ENGINE_URL" \
  --attempt-deadline 300s >/dev/null

curl -fsS "$ENGINE_URL/health" && echo
echo "Engine ($GHOSTAFF_ENV) at $ENGINE_URL"
