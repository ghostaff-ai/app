#!/usr/bin/env bash
# One-time setup of an environment's Google Cloud project (docs/plans/ongoing/environments.md): the
# APIs, the service accounts and their roles, the image registries, the Workload Identity provider CI
# deploys through, and the secrets the engine reads. Run by a person with owner rights on the project;
# safe to re-run, every step checks first.
#
#   bash scripts/setup-env.sh beta   # or prod
#
# Needs gcloud signed in as ghostaff.ai@gmail.com (scripts/env.sh picks the configuration) and the
# Supabase CLI signed in to organisation Ghostaff (`npx supabase login`). No secret is ever printed:
# each goes pipe to pipe into Secret Manager.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh "${1:-}"

# Apps shared by both environments (decision 2) keep their master copy here; beta gets a copy.
SHARED_FROM=ghostaff-prod
REPO=ghostaff-ai/app

sa() { echo "$1@$P.iam.gserviceaccount.com"; }

echo "== $GHOSTAFF_ENV: project $P, deployed from $DEPLOY_BRANCH"

echo "== APIs"
gcloud services enable --project "$P" \
  run.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com \
  cloudresourcemanager.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com aiplatform.googleapis.com cloudscheduler.googleapis.com

echo "== Service accounts"
for a in engine:"Ghostaff engine" scheduler:"Ghostaff tick" runner:"Ghostaff agent runner" deployer:"Ghostaff CI deployer"; do
  name=${a%%:*}
  gcloud iam service-accounts describe "$(sa "$name")" --project "$P" >/dev/null 2>&1 ||
    gcloud iam service-accounts create "$name" --project "$P" --display-name "${a#*:}"
done

echo "== Roles"
# Retried: IAM takes a few seconds to see an account created just above (2026-11-22, first run on prod).
retry() { local n; for n in 1 2 3 4 5 6; do "$@" >/dev/null 2>&1 && return; sleep 5; done; "$@" >/dev/null; }
grant() { retry gcloud projects add-iam-policy-binding "$P" --member "serviceAccount:$1" --role "$2" --condition None; }
# The engine creates, rotates and deletes each organisation's secret, and reads its own.
grant "$(sa engine)" roles/secretmanager.admin
# Dictation: the engine calls Gemini on Vertex AI in the EU, billed to this project (docs/plans/ongoing/voice.md).
grant "$(sa engine)" roles/aiplatform.user
# The runner has no role at all: it proves who it is to the engine with its ID token.
# The deployer builds and deploys, and nothing else: no secret's value, no IAM on the project.
grant "$DEPLOYER_SA" roles/run.admin
grant "$DEPLOYER_SA" roles/artifactregistry.writer
grant "$DEPLOYER_SA" roles/cloudscheduler.admin
grant "$DEPLOYER_SA" roles/secretmanager.viewer # metadata only: which connectors have their secret
for name in engine runner scheduler; do
  retry gcloud iam service-accounts add-iam-policy-binding "$(sa "$name")" --project "$P" \
    --member "serviceAccount:$DEPLOYER_SA" --role roles/iam.serviceAccountUser >/dev/null
done

echo "== Image registries"
for repo in engine runner; do
  gcloud artifacts repositories describe "$repo" --location "$R" --project "$P" >/dev/null 2>&1 ||
    gcloud artifacts repositories create "$repo" --repository-format docker --location "$R" --project "$P"
done

echo "== Workload Identity: CI from $REPO on $DEPLOY_BRANCH only"
gcloud iam workload-identity-pools describe github --location global --project "$P" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create github --location global --project "$P" --display-name "GitHub Actions"
CONDITION="assertion.repository == '$REPO' && assertion.ref == 'refs/heads/$DEPLOY_BRANCH'"
if gcloud iam workload-identity-pools providers describe ghostaff-app --location global \
  --workload-identity-pool github --project "$P" >/dev/null 2>&1; then VERB=update-oidc; else VERB=create-oidc; fi
gcloud iam workload-identity-pools providers "$VERB" ghostaff-app --location global --workload-identity-pool github \
  --project "$P" --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition "$CONDITION" >/dev/null
retry gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --project "$P" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO" >/dev/null

echo "== Secrets"
has_secret() { gcloud secrets describe "$1" --project "$P" >/dev/null 2>&1; }
new_secret() { # name [labels]: creates it reading the value from stdin
  gcloud secrets create "$1" --project "$P" --replication-policy user-managed --locations "$R" \
    ${2:+--labels "$2"} --data-file=- >/dev/null
}
if has_secret SUPABASE_SERVICE_ROLE_KEY; then
  echo "SUPABASE_SERVICE_ROLE_KEY already there"
else
  # Supabase's API straight into Secret Manager (decision 1), never on screen.
  service_role() {
    npx --no-install supabase projects api-keys --project-ref "$SUPABASE_REF" -o json 2>/dev/null |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const k=JSON.parse(s).find(k=>k.name==="service_role"&&k.api_key);if(!k)process.exit(1);process.stdout.write(k.api_key)})'
  }
  # Checked apart first, so a failed read never leaves an empty secret behind.
  service_role >/dev/null || { echo "no service_role key from Supabase project $SUPABASE_REF: is the CLI signed in?" >&2; exit 1; }
  service_role | new_secret SUPABASE_SERVICE_ROLE_KEY
  echo "SUPABASE_SERVICE_ROLE_KEY created from Supabase project $SUPABASE_REF"
fi
if [ "$P" != "$SHARED_FROM" ]; then
  # The shared apps' secrets, and our own apps with the makers (engine-app-*), copied with their labels.
  for name in github-app-registro-key google-oauth-connectors-secret \
    $(gcloud secrets list --project "$SHARED_FROM" --filter 'name ~ engine-app-' --format 'value(name.basename())'); do
    if has_secret "$name"; then echo "$name already there"; continue; fi
    gcloud secrets describe "$name" --project "$SHARED_FROM" >/dev/null 2>&1 || { echo "$name not in $SHARED_FROM, skipped"; continue; }
    labels=$(gcloud secrets describe "$name" --project "$SHARED_FROM" --format 'value(labels)' | tr ';' ',')
    gcloud secrets versions access latest --secret "$name" --project "$SHARED_FROM" | new_secret "$name" "$labels"
    echo "$name copied from $SHARED_FROM"
  done
fi

echo "== $GHOSTAFF_ENV set up. Deploy with: bash scripts/deploy-runner.sh $GHOSTAFF_ENV && bash scripts/deploy-engine.sh $GHOSTAFF_ENV"
