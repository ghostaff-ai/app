# AGENTS.md

The guide for anyone (human or AI) working in this repo. Short and load-bearing. When this file disagrees with the code, fix one of them in the same change.

## What this project is

Ghostaff gives a small company or organisation a team of AI agents, grouped into departments (Dirección, Finanzas, Marketing to start), that keeps its shared record, runs its routine work and brings people only the decisions that are theirs to take.

This repo is the product code: the app (iPhone, Android and web from one codebase) and its backend. The first slice is being built: sign in, pick an organisation, a decision inbox fed by Órdago's `por-decidir/` ([the plan](docs/plans/ongoing/build-first-version.md)).

**Ghostaff uses Ghostaff** (Álvaro, 2026-11-12). Ghostaff is the platform, and also one of the organisations on it, with its own record and agents: its bookkeeping, its mail, and the agents that build it. Every agent working for Ghostaff runs through the platform as organisation Ghostaff, with no back door a customer wouldn't have. When one of them needs something the platform lacks, build it into the platform rather than around it, or write it down as a product gap. That is how we learn, as users, what to build next ([decision 14](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#ghostaff-usa-ghostaff)).

**The product decisions live outside this repo**, in the private Órdago business repo: [`ghostaff-producto.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md) (what we build and why) and [`ghostaff.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff.md) (the company). Until Ghostaff is a company of its own, that stays the source of truth for the *why*; this repo holds the *how*. Read it before planning anything here.

**Álvaro and Jaime each decide on their own what gets built here and when** (Álvaro, 2026-11-22; it replaces «decide together» of 2026-11-21). Either founder's word is enough: what one of them asks for gets built, and an agent never waits for, asks about or notes the other's agreement. They talk to each other directly. Building waits for no one's review: land the PR with `pnpm pr:land`, which merges it when its checks are green (Branches).

## Sibling repos

Checked out side by side under `~/githubs/ghostaff-ai/`:

```bash
git clone --recurse-submodules git@github.com:ghostaff-ai/app.git ~/githubs/ghostaff-ai/app
```

- `ghostaff-ai/agents` is today's agent engine (Claude Code on Cloud Run Jobs), moved here from `ordago-app` on 2026-11-15 with Jaime's OK. It still runs Órdago's agents (`proyectos/ordago/`) unchanged; whether this repo's engine replaces it or grows from it is still to decide, by either founder. Read it, don't copy from it blindly. Clone it beside this one: `git clone git@github.com:ghostaff-ai/agents.git ~/githubs/ghostaff-ai/agents`.
- `cultuvilla/app` is the reference for an Expo app with the store release pipeline already working. Reuse its patterns.
- **Apple and Expo access:** the iOS app is on Álvaro's Apple team `8HWS4483VD`, where Jaime is Admin with his own Apple ID; each founder signs into Apple and Expo as himself and makes his own API key, never a copied `.p8`. Who holds what: `ordago-app/ordago-apps/docs/ops/apple-developer-access.md`.

Start a session in the repo the work belongs to, never in the parent folder.

## Layout

```
apps/mobile/       the app: Expo + expo-router + NativeWind, iPhone, Android and web
apps/sync/         record → database job (run by hand today, Cloud Run Jobs later)
apps/engine/       the engine's HTTP service on Cloud Run: an organisation's AI keys, Claude subscription (through the unmodified Claude Code) and connected accounts (Google, the makers' MCP servers) into the vault, agents answering in the team chat with their tools
apps/runner/       our agent runner: the unmodified Claude Code in a container, one Cloud Run job execution per agent run, started by the engine
packages/shared/   models, the record's file formats (por-decidir/), the data services
supabase/          migrations, row-level-security tests (pgTAP), local config
```

Commands from the repo root: `pnpm check` (typecheck + unit tests), `pnpm pr:land` (land the current branch: Branches), `pnpm engine:dev` (the engine locally), `bash scripts/deploy-engine.sh beta|prod` (the engine to Cloud Run), `bash scripts/deploy-runner.sh beta|prod` (the runner's job; both run by CI on merge, [environments.md](docs/plans/ongoing/environments.md)), `bash scripts/setup-env.sh beta|prod` (a project's one-time setup), `pnpm db:start` / `pnpm db:test`
(Postgres and the policy tests), `pnpm app:start` / `pnpm app:web` (Metro on the first free port of 8083, 8093 … 8173, from
`scripts/metro-port.sh`; never a bare `expo start`). Setup is in the [README](README.md#setup).

## Rules for the code

1. **Screens never talk to the database.** All data goes through `@ghostaff/shared/services`; sign-in goes
   through `apps/mobile/lib/auth/AuthContext.tsx`, the only file that calls `supabase.auth`. Same rule as
   cultuvilla/app's service layer.
2. **Every table with an organisation's data has `org_id`, row-level security on, and a pgTAP test** in
   `supabase/tests/database/` proving another organisation's member cannot see or change it. The app writes
   only through `security definer` functions that check the caller (`answer_decision`, `create_organization`, `accept_invitation`, …), never a table.
3. **The service-role key never reaches the app.** Only `apps/sync` and `apps/engine` use it, from its
   environment. The app's anon key is public by design.
4. **The record's file formats are ported, not reinvented.** `packages/shared/src/record/` reads and writes
   Órdago's `por-decidir/` format exactly as the Órdago panel does; a change to the format starts there, in
   `ordago-app/business/por-decidir/README.md`.
5. Code and comments in English; everything a person sees in the app in Spanish.

## Branches

- `develop` is the default branch and where work lands, through pull requests. `main` is what is released.
- Markdown-only changes (plans, this file) may be committed straight to `develop`.
- **The main checkout (`~/githubs/ghostaff-ai/app`) stays on `develop`, pulled** (Álvaro, 2026-11-17). Every session works on its own branch in its own worktree and never switches the main checkout's branch: Metro serves whatever branch that folder is on, and Álvaro runs it from there. Keep branches short-lived: a draft that lives for hours hides its work and everyone else's from what he sees.

  ```bash
  git worktree add .claude/worktrees/<name> -b <branch> origin/develop && git -C .claude/worktrees/<name> submodule update --init
  ```

  git doesn't populate submodules in a new worktree, and without `.agents/_shared` `pnpm pr:land` fails with `MODULE_NOT_FOUND`. To reap a landed worktree, use what `pr:land` prints (`rm -rf`, `git worktree prune`, `git branch -d`): `git worktree remove` refuses on a repo with submodules, and `--force` would discard uncommitted work without saying so.

### Landing a pull request: `pnpm pr:land`

**`pnpm pr:land` is the only way a pull request merges** (Jaime, 2026-11-22; it replaces the `automerge` label and its workflow). Run it from the branch's worktree once the work is committed: it pushes, opens the PR, waits for CI, handles a moving `develop` and merges. It is a resumable loop, not a merge command, so run it, act on its exit code and run it again until it exits `0`. Kill it anywhere and re-run it; it resumes from what it observes.

| Exit | Means | Do |
|---|---|---|
| `0` | Merged; the remote branch is gone. | Reap the worktree with the command it prints. |
| `10` | CI is red, or the merge result with today's `develop` fails `scripts/land-integration-check.sh`. | Read the log (an infrastructure failure isn't a regression), fix, commit, re-run. |
| `20` | A review requested changes. No reviewer is wired here today, so it shouldn't happen. | Fix the cause, re-run. |
| `30` | A human is needed: a draft or closed PR, CI never settled within its timeout, or the integration check couldn't run (a missing tool, not the PR's fault). | Read the reason it prints. Fix the machine or the PR state, or hand it to Álvaro or Jaime. |
| `40` | Preflight failed: a dirty tree, a protected branch, nothing to land, or a PR that **conflicts** with `develop` (which dispatches no CI at all). | Commit or clean, or rebase onto `origin/develop`, resolve, `git push --force-with-lease`, re-run. |

- **Never `gh pr merge` by hand**, nor `gh pr merge --auto`. A manual merge skips the guards `pr:land` carries: the required lanes (a skipped end-to-end lane is a failure, not an absence), the vacuous-green check and the staleness rule. Without required checks (a paid plan on a private repo), `--auto` merges at once, before the end-to-end tests (2026-11-21).
- **Land your own pull request as soon as its checks are green** (Álvaro, 2026-11-17). **The bar is green CI, with no review** (Jaime, 2026-11-22): the three lanes of `ci.yml` (`Typecheck and unit tests`, `Row-level security (pgTAP)`, `End-to-end (Android)`) must pass on the PR's latest commit. That is weaker than a review and accepted on purpose. Don't wait for anyone to test on the phone first: a problem found later gets its own fix PR. Stacked PRs land in order, the base first.
- **Don't rebase to stay fresh; `pr:land` owns staleness.** It rebases by itself when `develop` changed a file your PR changes, or moved a root manifest or a migration (`rebaseRadius`). When only `packages/shared/` moved under your PR, or your PR changes a root manifest, it runs `scripts/land-integration-check.sh` (install, typecheck, unit tests) on the merge result locally instead of re-running CI.
- **A PR made only of Markdown waits for a CI run that never starts** (`ci.yml` ignores `**/*.md` and `docs/**`) until `pr:land` exits `30`. Commit those straight to `develop` instead. This goes away when `.agents/_shared` is bumped past [agent-skills#20](https://github.com/ghostaff-ai/agent-skills/pull/20) and the `ci.yml` gate in `.agents/land.config.json` gets `"pathsIgnore": ["**/*.md", "docs/"]`.
- **`pr:land` is shared code; this repo's values are data.** `scripts/pr-land.js` is a symlink into the `.agents/_shared` submodule ([ghostaff-ai/agent-skills](https://github.com/ghostaff-ai/agent-skills), also used by Órdago and Cultuvilla). Fix the procedure upstream there, through a PR Álvaro reviews, then bump the submodule here in a PR of its own. Everything specific to this repo goes in `.agents/land.config.json` (base branch, the CI gate mirroring `ci.yml`, the blast and rebase radii, the integration check). When `ci.yml`'s jobs or filters change, change that file in the same PR. The `landing-prs` skill has the details.
- **What Álvaro looks at is the beta app on his phone, not Metro.** Every push to `develop` reaches it on its own once CI passes, end-to-end tests included: GitHub publishes the change over the air, or starts a new beta build when the native side changed (`.github/workflows/beta.yml`).
- **A main flow has an end-to-end test** in `.maestro/flows/ci/` (Maestro on an Android emulator, a release build against the local Supabase; [.maestro/README.md](.maestro/README.md)). A screen that changes one updates its flow in the same PR; run `pnpm e2e` before opening it. Metro and the dev build are for agents while they build.

## Plans

Design work lives in [docs/plans/](docs/plans/) by stage (`ideas/` → `ready/` → `ongoing/`), with the agent-plans v2 header (`Priority`, `Gate`, `Next`). Durable rationale for shipped work goes to [docs/decisions/](docs/decisions/). See the `managing-plans-lifecycle` skill.

## Invariants (from the product plan)

1. **Every organisation is separate.** Its record, operational data, documents and keys never mix with another's.
2. **Data stays in the EU**, on storage we own, with a live copy the customer can switch on (their Drive or GitHub) and a full export at any time.
3. **Keys live in a vault**, apart from everything else. No secret is ever committed or pasted into a conversation.
4. **The agents work on files with history** (the record is git); the app reads the database, not the files.
