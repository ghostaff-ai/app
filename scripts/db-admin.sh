#!/usr/bin/env bash
# An environment's database as its administrator, for an agent or a founder at a terminal: look up
# accounts, members and rows, or fix one by hand. Uses the environment's service-role key from its
# Secret Manager, fetched on each call and never printed.
#
#   bash scripts/db-admin.sh beta GET '/rest/v1/memberships?select=org_id,user_id,role,display_name'
#   bash scripts/db-admin.sh beta GET '/auth/v1/admin/users?per_page=200'
#   bash scripts/db-admin.sh beta DELETE /auth/v1/admin/users/<user id>
#   bash scripts/db-admin.sh beta PATCH '/rest/v1/profiles?user_id=eq.<id>' '{"full_name":"Álvaro"}'
#
# Paths are Supabase's own APIs: /rest/v1 (PostgREST, every public table, row-level security
# bypassed) and /auth/v1/admin (accounts). Prints the response body; exits non-zero on HTTP >= 400.
# A delete or a change is permanent: read first, and change only on a founder's word.
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "usage: bash scripts/db-admin.sh beta|prod GET|POST|PATCH|DELETE <path> [json body]" >&2
  exit 2
fi

env=$1 method=$2 path=$3 body=${4:-}
here=$(cd "$(dirname "$0")" && pwd)

# The configuration signed in as ghostaff.ai@gmail.com is `ghostaff-prod` on Jaime's Mac and
# `ghostaff` on Álvaro's machine; use whichever exists unless one is named.
if [ -z "${CLOUDSDK_ACTIVE_CONFIG_NAME:-}" ]; then
  for c in ghostaff-prod ghostaff; do
    if gcloud config configurations describe "$c" >/dev/null 2>&1; then
      export CLOUDSDK_ACTIVE_CONFIG_NAME=$c
      break
    fi
  done
fi
# shellcheck source=env.sh
source "$here/env.sh" "$env"

key=$(gcloud secrets versions access latest --secret SUPABASE_SERVICE_ROLE_KEY --project "$P")

args=(-sS -X "$method" -w '\n%{http_code}' -H "apikey: $key" -H "Authorization: Bearer $key"
  -H 'Content-Type: application/json' -H 'Prefer: return=representation')
[ -n "$body" ] && args+=(--data "$body")

out=$(curl "${args[@]}" "$SUPABASE_URL$path")
code=${out##*$'\n'}
printf '%s\n' "${out%$'\n'*}"
[ "$code" -lt 400 ] || { echo "HTTP $code" >&2; exit 1; }
