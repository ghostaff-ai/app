#!/usr/bin/env bash
# The end-to-end tests' seeded company (.maestro/README.md, «The seeded
# company»), made through the real record → database sync (apps/sync), against
# the local Supabase only.
#
#   bash scripts/e2e/seed.sh seed          a new company from .maestro/fixtures/record, with
#                                          Dirección and two owners; prints SEED_SLUG,
#                                          SEED_COMPANY, DECIDER_EMAIL and CHAT_EMAIL as KEY=value
#   bash scripts/e2e/seed.sh verify <slug> after answer-decision.yaml: the app's answers
#                                          are written back into a copy of the record
#
# Every run makes a company of its own, so a rerun never meets an answered
# decision. It needs SERVICE_ROLE_KEY (and SUPABASE_URL) in the environment;
# android.sh reads both from `supabase status`. The CLI runs through tsx without
# apps/sync/.env, so a hosted project's key there is never read.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
FIXTURE="$ROOT/.maestro/fixtures/record"

sync_cli() {
  [[ -n "${SERVICE_ROLE_KEY:-}" ]] || { echo "No SERVICE_ROLE_KEY: is the local Supabase running (pnpm db:start)?" >&2; exit 1; }
  (cd "$ROOT/apps/sync" &&
    SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
      pnpm exec tsx src/cli.ts "$@") >&2
}

cmd_seed() {
  local run slug company decider chatter
  run=$(date +%s)
  slug="e2e-$run"
  company="Gestoría E2E ${run: -6}"
  decider="e2e-dec-$run@ghostaff.test"
  chatter="e2e-chat-$run@ghostaff.test"
  sync_cli add-org --slug "$slug" --name "$company"
  # One owner per flow: mailpit-code.js reads the last code mailed to an address.
  sync_cli add-member --org "$slug" --email "$decider" --name "Ana E2E" --role owner
  sync_cli add-member --org "$slug" --email "$chatter" --name "Bea E2E" --role owner
  sync_cli por-decidir --org "$slug" --record "$FIXTURE"
  printf 'SEED_SLUG=%s\nSEED_COMPANY=%s\nDECIDER_EMAIL=%s\nCHAT_EMAIL=%s\n' "$slug" "$company" "$decider" "$chatter"
}

# What answer-decision.yaml leaves: the rich decision answered No (after
# «Cambiar la respuesta»), the plain one OK from the deck.
# A subshell, so its trap removes the copy however it ends.
cmd_verify() (
  local slug=${1:?usage: seed.sh verify <slug>} copy dir ok=1
  copy=$(mktemp -d)
  trap 'rm -rf "$copy"' EXIT
  cp -R "$FIXTURE/." "$copy"
  sync_cli por-decidir --org "$slug" --record "$copy" --write-back
  dir="$copy/por-decidir"
  grep -q '^  decision: no$' "$dir/secretaria-horario-navidad.yaml" || { echo "secretaria-horario-navidad: no «decision: no» written back" >&2; ok=0; }
  grep -q '^  decision: ok$' "$dir/secretaria-proveedor-harina.yaml" || { echo "secretaria-proveedor-harina: no «decision: ok» written back" >&2; ok=0; }
  [[ $(grep -c ',secretaria-' "$copy/agentes/historial-decisiones.csv") == 2 ]] || { echo "the decisions' history has not both answers" >&2; ok=0; }
  [[ $ok == 1 ]] || { cat "$dir"/*.yaml "$copy/agentes/historial-decisiones.csv" >&2; exit 1; }
  echo "The app's answers reached the record of $slug" >&2
)

case "${1:-}" in
  seed) cmd_seed ;;
  verify) shift; cmd_verify "$@" ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
