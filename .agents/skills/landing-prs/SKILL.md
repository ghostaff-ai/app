---
name: landing-prs
description: Use when a branch in ghostaff-ai/app is ready to merge into develop, when opening or merging a pull request, when `pnpm pr:land` exits non-zero, when a fresh worktree has no `.agents/_shared`, or when changing `.agents/land.config.json`, `ci.yml`'s jobs or the shared pr-land script. `pnpm pr:land` is the only way a PR merges here.
---

# Landing a pull request

`pnpm pr:land` lands the current branch into `develop`. It pushes, opens the PR, waits for CI,
deals with a moving `develop` and merges. AGENTS.md («Branches») holds the rules; this is the how.

It is a **reconciler, not a merge command**: each pass observes GitHub and git, does one thing,
and looks again. It remembers nothing, so killing it and re-running is always safe. The loop
you run is:

```bash
pnpm pr:land; echo "exit $?"
# act on the exit code (table below), commit the fix, run it again, until it exits 0
```

Never `gh pr merge` (with or without `--auto`) and never `--admin`. A hand merge skips the
required-lanes, vacuous-green and staleness guards.

## Before the first run

1. **Work in a worktree, never the main checkout** (Metro serves it, on `develop`):

   ```bash
   git worktree add .claude/worktrees/<name> -b <branch> origin/develop && git -C .claude/worktrees/<name> submodule update --init
   ```

   git doesn't populate submodules in a new worktree. Without `.agents/_shared`,
   `scripts/pr-land.js` is a dangling symlink and `pnpm pr:land` dies with `MODULE_NOT_FOUND`.
   Fix it with `git submodule update --init` in that worktree. **Never `git submodule deinit`**:
   the registration lives in the shared `.git/config`, so a deinit in one worktree drops it for
   every worktree.
2. Commit everything. A dirty tree is exit `40`.
3. Use a conventional commit subject (commitlint enforces it). `pr:land` uses the last
   commit's subject as the PR title and the commit list as its body. If you want a richer
   description, open the PR yourself with `gh pr create --base develop`; `pr:land` adopts the
   open PR for the branch.
4. `pnpm pr:land --dry-run` prints what it would do next and stops. Use it to check that the
   config loads.

## Exit codes

| Exit | Means | Do |
|---|---|---|
| `0` | Merged; the remote branch is deleted. | Reap the worktree with the command it prints (`rm -rf … && git worktree prune && git branch -d …`). Never `git worktree remove --force`. |
| `10` | CI red, or the merge result with today's `develop` fails `scripts/land-integration-check.sh`. | Open the failing job's log (`gh run view --log-failed <run>`). Infrastructure failures (runner disk, emulator boot, a network fetch) aren't regressions: re-run the job (`gh run rerun <run> --failed`), then `pr:land`. Otherwise fix, commit, re-run. |
| `20` | A review requested changes. | Not expected: no reviewer is wired (`requireApprovingReview: false`). If it happens, fix the findings and re-run. |
| `30` | A human is needed. | Read the reason. *CI never settled*: a lane starved or hung, or the diff is Markdown-only (see UNVERIFIED below). *Integration check could not run*: a missing tool on this machine, which says nothing about the PR. Fix the machine, delete the verdict file it names, re-run. *Draft or closed*: someone decided that, so ask before undoing it. |
| `40` | Preflight failed. | Dirty tree: commit it. Protected branch: you're on `develop`/`main`, so move to a branch. *Conflicts with develop*: GitHub dispatches no CI on a conflicting PR. `git fetch origin develop && git rebase origin/develop`, resolve, `git push --force-with-lease`, re-run. |

`pr:land` can wait on the end-to-end lane for most of an hour. Run it in the background if you
have other work, but run it to completion: a PR nobody re-runs never merges.

## What it does on its own (don't do it by hand)

- **Rebases** when `develop` changed a file your PR changes, or moved a `rebaseRadius` path
  (root manifests, `supabase/migrations/`). It force-pushes with lease and CI re-runs.
- **Checks the merge result locally** when `packages/shared/` moved on either side, or your PR
  changes a `rebaseRadius` path: `scripts/land-integration-check.sh` runs `pnpm install`,
  `pnpm typecheck` and `pnpm test` in a throwaway worktree under `~/.cache/pr-land/`. A pass is
  kept for 30 minutes while `develop` moves elsewhere. Exit 3 from the script means *could not
  run* (exit `30`), anything else non-zero means *broken* (exit `10`).
- **Deletes the remote branch** after the merge.
- **Detects a merge queue** from GitHub. This repo (free plan, private) has none, and reads as
  "no queue". Nothing to configure.

## Reading UNVERIFIED

The PR body says either «CI covers this diff (ci.yml)» or **«UNVERIFIED BY CI»**. UNVERIFIED
means no changed path matches the `ciGates` in `.agents/land.config.json`, so no workflow was
expected to run and the PR merges with no CI at all.

- With today's gate (`paths: ["**"]`, every file counts) a PR can't be UNVERIFIED. The reverse
  problem exists instead: a **Markdown-only PR** (`**/*.md`, `docs/**`) dispatches no run,
  because `ci.yml` ignores those paths, so `pr:land` waits for a run that never comes and exits
  `30`. Commit Markdown-only changes straight to `develop` (AGENTS.md allows it). Or, if a PR
  already exists, close it and push the commit to `develop`.
- Once the submodule includes `pathsIgnore` ([agent-skills#20](https://github.com/ghostaff-ai/agent-skills/pull/20))
  and the gate has `"pathsIgnore": ["**/*.md", "docs/"]`, a Markdown-only PR is UNVERIFIED and
  merges at once, which is correct because CI would run nothing on it. If a PR that changes
  **code** ever says UNVERIFIED, the gate has drifted from `ci.yml`. Stop and fix the config
  before landing anything.

## Changing the configuration or the script

- **Repo values** live in `.agents/land.config.json`: base branch, the `ci.yml` gate and its
  three required lanes (exact `gh pr checks` names), `sharedBlastRadius`, `rebaseRadius`, the
  integration check. When `ci.yml` gains, renames or conditions a job, or changes its path
  filter, update the gate **in the same PR**. A required lane must be a job that runs whenever
  the workflow runs (no `if:`, no `needs:` on something that can skip), or every PR wedges.
- **The procedure** (`pr-land.js`, `decide.js`) is the shared `ghostaff-ai/agent-skills`
  repo, also used by Órdago and Cultuvilla. Never edit `.agents/_shared` in place. Change it
  upstream with tests (`node --test scripts/__tests__/*.test.mjs`), get Álvaro's review, and once
  it merges, bump the pointer here in its own PR:

  ```bash
  git -C .agents/_shared fetch origin && git -C .agents/_shared checkout origin/main
  git add .agents/_shared && git commit -m "chore(agents): bump agent-skills to <sha>"
  ```
