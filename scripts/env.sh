# Each environment's values, for the setup and deploy scripts (docs/plans/ongoing/environments.md).
# Sourced, never run:
#
#   source scripts/env.sh beta   # or prod
#
# Beta is Google Cloud project ghostaff-beta with Supabase ghostaff-beta, deployed from `develop`;
# production is ghostaff-prod with Supabase ghostaff-prod, deployed from `main`. Everything here is
# public: names, numbers and ids. Secrets live in each project's Secret Manager.

case "${1:-}" in
  beta)
    export P=ghostaff-beta PROJECT_NUMBER=1002624835789
    export SUPABASE_REF=rggvcvnstbitbdptiwtk DEPLOY_BRANCH=develop
    # The web app at ghostaff.ai/app runs on beta until production is up (desktop-web.md, step 3).
    export APP_RETURN_ORIGINS=https://ghostaff.ai
    ;;
  prod)
    export P=ghostaff-prod PROJECT_NUMBER=664656500315
    export SUPABASE_REF=krhhndjjqmmkzjmwwazv DEPLOY_BRANCH=main
    export APP_RETURN_ORIGINS=
    ;;
  *)
    echo "usage: source scripts/env.sh beta|prod (got '${1:-}')" >&2
    exit 2
    ;;
esac

export GHOSTAFF_ENV=$1
# Customers' Google Cloud: one service account per organisation, in a project of its own where the
# engine administers service accounts and nothing else (docs/architecture.md, «A customer's Google Cloud»).
export TENANTS_P="ghostaff-tenants-$1"
export R=europe-west1
export SUPABASE_URL="https://$SUPABASE_REF.supabase.co"
# Cloud Run's deterministic URL for a service named `engine`, known before the first deploy.
export ENGINE_URL="https://engine-$PROJECT_NUMBER.$R.run.app"
# CI signs in through this provider, which accepts only ghostaff-ai/app on DEPLOY_BRANCH.
export WIF_PROVIDER="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/ghostaff-app"
export DEPLOYER_SA="deployer@$P.iam.gserviceaccount.com"
# Push notifications on Android: Firebase Cloud Messaging in the environment's own project.
export FIREBASE_PROJECT="$P"

# One set of apps for both environments (decision 2); only their secrets are copied into each project.
# Google connectors: OAuth client «Ghostaff Conectores» in ghostaff-prod.
export GOOGLE_CONNECTORS_CLIENT_ID="664656500315-q4c4jl16qgq43r046qiujnf7b3oncsd9.apps.googleusercontent.com"
# The record connector: GitHub App «Ghostaff Registro» (created 2026-11-21).
export GITHUB_APP_ID="5864166"
# Instagram and TikTok: our own apps on each platform. Empty until they exist.
export INSTAGRAM_APP_ID=""
export TIKTOK_CLIENT_KEY=""

# On a laptop, the gcloud configuration signed in as ghostaff.ai@gmail.com; in CI, whatever the auth
# step set up.
if [ -z "${CI:-}" ]; then
  export CLOUDSDK_ACTIVE_CONFIG_NAME=${CLOUDSDK_ACTIVE_CONFIG_NAME:-ghostaff-prod}
fi
