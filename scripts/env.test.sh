#!/usr/bin/env bash
# Tests scripts/env.sh: each environment's values, and a missing or unknown one refused.
set -euo pipefail

script="$(dirname "$0")/env.sh"
failures=0
fail() { echo "FAIL: $1" >&2; failures=$((failures + 1)); }

# Sources env.sh in a clean subshell and prints one variable.
value() { (unset CI CLOUDSDK_ACTIVE_CONFIG_NAME; source "$script" "$1" >/dev/null && eval "printf '%s' \"\${$2}\""); }

expect() { # env var expected
  local got
  got=$(value "$1" "$2") || { fail "$1: sourcing failed"; return; }
  [ "$got" = "$3" ] || fail "$1 $2: expected '$3', got '$got'"
}

expect beta P ghostaff-beta
expect beta PROJECT_NUMBER 1002624835789
expect beta ENGINE_URL https://engine-1002624835789.europe-west1.run.app
expect beta SUPABASE_REF rggvcvnstbitbdptiwtk
expect beta SUPABASE_URL https://rggvcvnstbitbdptiwtk.supabase.co
expect beta DEPLOY_BRANCH develop
expect beta WIF_PROVIDER projects/1002624835789/locations/global/workloadIdentityPools/github/providers/ghostaff-app
expect beta DEPLOYER_SA deployer@ghostaff-beta.iam.gserviceaccount.com
expect beta R europe-west1

expect prod P ghostaff-prod
expect prod PROJECT_NUMBER 664656500315
expect prod ENGINE_URL https://engine-664656500315.europe-west1.run.app
expect prod SUPABASE_REF krhhndjjqmmkzjmwwazv
expect prod SUPABASE_URL https://krhhndjjqmmkzjmwwazv.supabase.co
expect prod DEPLOY_BRANCH main
expect prod DEPLOYER_SA deployer@ghostaff-prod.iam.gserviceaccount.com

# A laptop picks a gcloud configuration; CI uses the credentials its auth step set.
[ "$(value beta CLOUDSDK_ACTIVE_CONFIG_NAME)" = ghostaff ] || fail "outside CI the gcloud configuration defaults to 'ghostaff'"
in_ci=$( (export CI=true; unset CLOUDSDK_ACTIVE_CONFIG_NAME; source "$script" beta >/dev/null; printf '%s' "${CLOUDSDK_ACTIVE_CONFIG_NAME:-}") )
[ -z "$in_ci" ] || fail "in CI no gcloud configuration is set, got '$in_ci'"

for bad in "" staging; do
  err=$( (source "$script" $bad) 2>&1 >/dev/null ) && code=0 || code=$?
  [ "$code" = 2 ] || fail "'$bad': expected exit 2, got $code"
  case "$err" in *usage:*) ;; *) fail "'$bad': expected usage on stderr, got '$err'" ;; esac
done

if [ "$failures" -gt 0 ]; then echo "$failures failure(s)" >&2; exit 1; fi
echo "env.sh: all checks passed"
