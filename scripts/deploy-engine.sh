#!/usr/bin/env bash
# Sets up and deploys the engine's HTTP service on Google Cloud: project
# ghostaff-prod, region europe-west1 (Belgium). Safe to re-run: every setup step
# checks first, and each run deploys the current commit.
#
#   bash scripts/deploy-engine.sh
#
# Needs the `ghostaff` gcloud configuration signed in (ghostaff.ai@gmail.com),
# docker, and sops able to decrypt secrets/secrets.enc.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

export CLOUDSDK_ACTIVE_CONFIG_NAME=ghostaff
P=ghostaff-prod
R=europe-west1
SA="engine@$P.iam.gserviceaccount.com"
REGISTRY="$R-docker.pkg.dev"
IMAGE="$REGISTRY/$P/engine/engine:$(git rev-parse --short HEAD)"
SUPABASE_URL=https://rggvcvnstbitbdptiwtk.supabase.co # ghostaff-beta, Frankfurt
SERVICE_ROLE_SECRET=SUPABASE_SERVICE_ROLE_KEY_BETA

echo "== APIs"
gcloud services enable --project "$P" \
  run.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com \
  cloudresourcemanager.googleapis.com iam.googleapis.com aiplatform.googleapis.com

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

echo "== Build and push $IMAGE"
docker build -f apps/engine/Dockerfile -t "$IMAGE" .
gcloud auth print-access-token | docker login -u oauth2accesstoken --password-stdin "https://$REGISTRY"
docker push "$IMAGE"

echo "== Deploy"
# Public URL on purpose: the app calls it, and every call but /health needs a
# Supabase sign-in token, checked by the engine itself.
gcloud run deploy engine --project "$P" --region "$R" --image "$IMAGE" \
  --service-account "$SA" --allow-unauthenticated --min-instances 0 --max-instances 3 \
  --set-env-vars "SUPABASE_URL=$SUPABASE_URL,GCP_PROJECT=$P,SECRETS_LOCATION=$R,ENGINE_SERVICE_ACCOUNT=$SA" \
  --set-secrets "SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_SECRET:latest"

URL=$(gcloud run services describe engine --project "$P" --region "$R" --format 'value(status.url)')
curl -fsS "$URL/health" && echo
echo "Engine at $URL. Beta builds read it from EAS's preview environment as ENGINE_URL_BETA."
