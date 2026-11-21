#!/usr/bin/env bash
# Sets up and deploys the engine's HTTP service on Google Cloud: project
# ghostaff-prod, region europe-west1 (Belgium). Safe to re-run: every setup step
# checks first, and each run deploys the current commit.
#
#   bash scripts/deploy-engine.sh
#
# Needs a gcloud configuration signed in as ghostaff.ai@gmail.com (named
# `ghostaff` unless CLOUDSDK_ACTIVE_CONFIG_NAME says otherwise), docker, and, the
# first time only, sops able to decrypt secrets/secrets.enc.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

export CLOUDSDK_ACTIVE_CONFIG_NAME=${CLOUDSDK_ACTIVE_CONFIG_NAME:-ghostaff}
P=ghostaff-prod
R=europe-west1
SA="engine@$P.iam.gserviceaccount.com"
REGISTRY="$R-docker.pkg.dev"
IMAGE="$REGISTRY/$P/engine/engine:$(git rev-parse --short HEAD)"
SUPABASE_URL=https://rggvcvnstbitbdptiwtk.supabase.co # ghostaff-beta, Frankfurt
SERVICE_ROLE_SECRET=SUPABASE_SERVICE_ROLE_KEY_BETA
PUBLIC_URL=https://engine-664656500315.europe-west1.run.app
# Google connector (docs/plans/ongoing/connectors.md): OAuth client «Ghostaff
# Conectores» in this project. The ID is public; the secret is put in Secret
# Manager by hand, never through a file or a chat.
GOOGLE_CLIENT_ID="664656500315-q4c4jl16qgq43r046qiujnf7b3oncsd9.apps.googleusercontent.com"
GOOGLE_SECRET=google-oauth-connectors-secret
# Instagram and TikTok: our own apps on each platform, the same way. Empty until they exist.
INSTAGRAM_APP_ID=""
INSTAGRAM_SECRET=instagram-app-secret
TIKTOK_CLIENT_KEY=""
TIKTOK_SECRET=tiktok-client-secret
# The record connector: our GitHub App «Ghostaff Registro», made by
# scripts/github-app-registro.mjs, which stores its key in Secret Manager. The
# App id is public. Empty until the App exists: then nothing syncs.
GITHUB_APP_ID=""
GITHUB_KEY_SECRET=github-app-registro-key
# Cloud Scheduler calls the engine's /cron as this account every five minutes
# (record sync, agents due); the engine checks its Google ID token.
SCHEDULER_SA="scheduler@$P.iam.gserviceaccount.com"

echo "== APIs"
gcloud services enable --project "$P" \
  run.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com \
  cloudresourcemanager.googleapis.com iam.googleapis.com aiplatform.googleapis.com \
  cloudscheduler.googleapis.com

echo "== The engine's identity"
gcloud iam service-accounts describe "$SA" --project "$P" >/dev/null 2>&1 ||
  gcloud iam service-accounts create engine --project "$P" --display-name "Ghostaff engine"
# Creates, rotates and deletes each organisation's secret, and reads its own.
gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:$SA" \
  --role roles/secretmanager.admin --condition None >/dev/null

echo "== Image registry"
gcloud artifacts repositories describe engine --location "$R" --project "$P" >/dev/null 2>&1 ||
  gcloud artifacts repositories create engine --repository-format docker --location "$R" --project "$P"

echo "== Supabase service-role key, sops to Secret Manager (never printed)"
if ! gcloud secrets describe "$SERVICE_ROLE_SECRET" --project "$P" >/dev/null 2>&1; then
  sops -d --extract "[\"$SERVICE_ROLE_SECRET\"]" secrets/secrets.enc.yml |
    gcloud secrets create "$SERVICE_ROLE_SECRET" --project "$P" \
      --replication-policy user-managed --locations "$R" --data-file=-
fi

ENV_VARS="SUPABASE_URL=$SUPABASE_URL,GCP_PROJECT=$P,SECRETS_LOCATION=$R,ENGINE_SERVICE_ACCOUNT=$SA,ENGINE_PUBLIC_URL=$PUBLIC_URL,CRON_CALLERS=$SCHEDULER_SA"
SECRETS="SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_SECRET:latest"
if [ -n "$GOOGLE_CLIENT_ID" ] && gcloud secrets describe "$GOOGLE_SECRET" --project "$P" >/dev/null 2>&1; then
  ENV_VARS="$ENV_VARS,GOOGLE_OAUTH_CLIENT_ID=$GOOGLE_CLIENT_ID"
  SECRETS="$SECRETS,GOOGLE_OAUTH_CLIENT_SECRET=$GOOGLE_SECRET:latest"
else
  echo "== Google connector off: set GOOGLE_CLIENT_ID above and create the secret $GOOGLE_SECRET"
fi
if [ -n "$INSTAGRAM_APP_ID" ] && gcloud secrets describe "$INSTAGRAM_SECRET" --project "$P" >/dev/null 2>&1; then
  ENV_VARS="$ENV_VARS,INSTAGRAM_APP_ID=$INSTAGRAM_APP_ID"
  SECRETS="$SECRETS,INSTAGRAM_APP_SECRET=$INSTAGRAM_SECRET:latest"
else
  echo "== Instagram connector off: set INSTAGRAM_APP_ID above and create the secret $INSTAGRAM_SECRET"
fi
if [ -n "$TIKTOK_CLIENT_KEY" ] && gcloud secrets describe "$TIKTOK_SECRET" --project "$P" >/dev/null 2>&1; then
  ENV_VARS="$ENV_VARS,TIKTOK_CLIENT_KEY=$TIKTOK_CLIENT_KEY"
  SECRETS="$SECRETS,TIKTOK_CLIENT_SECRET=$TIKTOK_SECRET:latest"
else
  echo "== TikTok connector off: set TIKTOK_CLIENT_KEY above and create the secret $TIKTOK_SECRET"
fi

if [ -n "$GITHUB_APP_ID" ] && gcloud secrets describe "$GITHUB_KEY_SECRET" --project "$P" >/dev/null 2>&1; then
  ENV_VARS="$ENV_VARS,GITHUB_APP_ID=$GITHUB_APP_ID"
  SECRETS="$SECRETS,GITHUB_APP_KEY=$GITHUB_KEY_SECRET:latest"
else
  echo "== Record connector off: run node scripts/github-app-registro.mjs and set GITHUB_APP_ID above"
fi

echo "== Build and push $IMAGE"
# Cloud Run runs amd64: built for it even on an Apple Silicon Mac (emulated, slower).
docker build --platform linux/amd64 -f apps/engine/Dockerfile -t "$IMAGE" .
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin "https://$REGISTRY"
docker push "$IMAGE"
docker logout "https://$REGISTRY" >/dev/null # the token was only for this push

echo "== Deploy"
# Public URL on purpose: the app calls it, and every call but /health needs a
# Supabase sign-in token, checked by the engine itself.
gcloud run deploy engine --project "$P" --region "$R" --image "$IMAGE" \
  --service-account "$SA" --allow-unauthenticated --min-instances 0 --max-instances 3 \
  --set-env-vars "$ENV_VARS" \
  --set-secrets "$SECRETS"

echo "== The tick: Cloud Scheduler calls /cron every five minutes"
gcloud iam service-accounts describe "$SCHEDULER_SA" --project "$P" >/dev/null 2>&1 ||
  gcloud iam service-accounts create scheduler --project "$P" --display-name "Ghostaff tick"
if gcloud scheduler jobs describe tick --location "$R" --project "$P" >/dev/null 2>&1; then VERB=update; else VERB=create; fi
gcloud scheduler jobs "$VERB" http tick --location "$R" --project "$P" \
  --schedule "*/5 * * * *" --time-zone "Europe/Madrid" --http-method POST --uri "$PUBLIC_URL/cron" \
  --oidc-service-account-email "$SCHEDULER_SA" --oidc-token-audience "$PUBLIC_URL" \
  --attempt-deadline 300s >/dev/null

URL=$(gcloud run services describe engine --project "$P" --region "$R" --format 'value(status.url)')
curl -fsS "$URL/health" && echo
echo "Engine at $URL (also https://engine-664656500315.europe-west1.run.app, the URL apps/mobile/app.config.ts pins for beta)."
