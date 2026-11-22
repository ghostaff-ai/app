#!/usr/bin/env bash
# `integrationCheck` for `pnpm pr:land` (.agents/land.config.json).
#
# pr:land runs this inside a throwaway worktree holding the MERGE RESULT of a PR
# and the current develop, instead of rebasing the PR (which would re-run every
# CI lane, the end-to-end one included). It sets PR_LAND_INTEGRATION_SCOPE:
#
#   shared — packages/shared (`sharedBlastRadius`) moved on one side while the
#            other moved anything: every consumer of @ghostaff/shared may break.
#   wide   — the PR itself changes a root manifest or a migration
#            (`rebaseRadius`), which reaches every workspace.
#
# Both scopes run the same thing, the repo's whole `pnpm typecheck && pnpm test`:
# it is what CI's «Typecheck and unit tests» runs. Not judged here: the pgTAP and
# end-to-end lanes (they need Docker and an emulator); CI on develop runs them on
# every merge before the beta ships it.
#
# Exit codes, as pr:land reads them: 0 the merge result passes; 3 this check
# could not run (a missing tool), recorded as an error for a human, never as a
# broken merge; anything else, the merge result is broken (pr:land exits 10).
set -euo pipefail

scope="${PR_LAND_INTEGRATION_SCOPE:?pr:land sets PR_LAND_INTEGRATION_SCOPE (shared | wide)}"
case "$scope" in shared | wide) ;; *) echo "unknown PR_LAND_INTEGRATION_SCOPE: $scope" >&2; exit 3 ;; esac

cannot_run() { echo "land-integration-check: $*" >&2; exit 3; }
for tool in git node pnpm; do
  command -v "$tool" >/dev/null || cannot_run "'$tool' is not installed on this machine"
done

# The worktree is fresh: there is no node_modules. pnpm hardlinks from its store,
# so this is quick. Not silent: a manifest/lockfile mismatch on the merge result
# fails here, and that is a real integration failure that must be readable.
pnpm install --frozen-lockfile --prefer-offline --reporter=append-only

# The merge result is a brand-new directory every run, and watchman can answer an
# unindexed path with an empty crawl: Jest then reports "No tests found" (seen in
# ordago-apps). apps/mobile/jest.config.js turns watchman off when this is set.
export JEST_WATCHMAN=false

pnpm typecheck
pnpm test
