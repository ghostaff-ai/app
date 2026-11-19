# AGENTS.md

The guide for anyone (human or AI) working in this repo. Short and load-bearing. When this file disagrees with the code, fix one of them in the same change.

## What this project is

Ghostaff gives a small company or organisation a team of AI agents, grouped into departments (Dirección, Finanzas, Marketing to start), that keeps its shared record, runs its routine work and brings people only the decisions that are theirs to take.

This repo is the product code: the app (iPhone, Android and web from one codebase) and its backend. The first slice is being built: sign in, pick an organisation, a decision inbox fed by Órdago's `por-decidir/` ([the plan](docs/plans/ongoing/build-first-version.md)).

**Ghostaff uses Ghostaff** (Álvaro, 2026-11-12). Ghostaff is the platform, and also one of the organisations on it, with its own record and agents: its bookkeeping, its mail, and the agents that build it. Every agent working for Ghostaff runs through the platform as organisation Ghostaff, with no back door a customer wouldn't have. When one of them needs something the platform lacks, build it into the platform rather than around it, or write it down as a product gap. That is how we learn, as users, what to build next ([decision 14](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#ghostaff-usa-ghostaff)).

**The product decisions live outside this repo**, in the private Órdago business repo: [`ghostaff-producto.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md) (what we build and why) and [`ghostaff.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff.md) (the company). Until Ghostaff is a company of its own, that stays the source of truth for the *why*; this repo holds the *how*. Read it before planning anything here.

**Álvaro decides alone what gets built here and when** (2026-11-12). Jaime is a co-founder, not a gate: never hold work waiting for his review. Only things that are his too (using his subscription) wait for him.

## Sibling repos

Checked out side by side under `~/githubs/ghostaff-ai/`:

```bash
git clone git@github.com:ghostaff-ai/app.git ~/githubs/ghostaff-ai/app
```

- `ghostaff-ai/agents` is today's agent engine (Claude Code on Cloud Run Jobs), moved here from `ordago-app` on 2026-11-15 with Jaime's OK. It still runs Órdago's agents (`proyectos/ordago/`) unchanged; whether this repo's engine replaces it or grows from it is Álvaro's call. Read it, don't copy from it blindly. Clone it beside this one: `git clone git@github.com:ghostaff-ai/agents.git ~/githubs/ghostaff-ai/agents`.
- `cultuvilla/app` is the reference for an Expo app with the store release pipeline already working. Reuse its patterns.
- **Apple and Expo access:** the iOS app is on Álvaro's Apple team `8HWS4483VD`, where Jaime is Admin with his own Apple ID; each founder signs into Apple and Expo as himself and makes his own API key, never a copied `.p8`. Who holds what: `ordago-app/ordago-apps/docs/ops/apple-developer-access.md`.

Start a session in the repo the work belongs to, never in the parent folder.

## Layout

```
apps/mobile/       the app: Expo + expo-router + NativeWind, iPhone, Android and web
apps/sync/         record → database job (run by hand today, Cloud Run Jobs later)
apps/engine/       the engine's HTTP service on Cloud Run: an organisation's AI keys and connected accounts (Google, the makers' MCP servers) into the vault, agents answering in the team chat with their tools
packages/shared/   models, the record's file formats (por-decidir/), the data services
supabase/          migrations, row-level-security tests (pgTAP), local config
```

Commands from the repo root: `pnpm check` (typecheck + unit tests), `pnpm engine:dev` (the engine locally), `bash scripts/deploy-engine.sh` (the engine to Cloud Run), `pnpm db:start` / `pnpm db:test`
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

- `develop` is the default branch and where work lands, through pull requests.
- **Merge your own pull request as soon as its checks are green** (Álvaro, 2026-11-17): `gh pr checks <n> --watch`, then `gh pr merge <n> --merge`. Right after opening the PR the checks may not exist yet, and `--watch` then returns at once: wait until `gh pr checks <n>` lists them first. Don't wait for him to test on the phone first; a problem found later gets its own fix PR. Stacked PRs merge in order, the base first.
- `main` is what is released.
- Markdown-only changes (plans, this file) may be committed straight to `develop`.
- **The main checkout (`~/githubs/ghostaff-ai/app`) stays on `develop`, pulled** (Álvaro, 2026-11-17). Every session works on its own branch in its own worktree (`git worktree add .claude/worktrees/<name> -b <branch> origin/develop`) and never switches the main checkout's branch: Metro serves whatever branch that folder is on, and Álvaro runs it from there. Keep branches short-lived: a draft that lives for hours hides its work and everyone else's from what he sees.
- **What Álvaro looks at is the beta app on his phone, not Metro.** Every push to `develop` reaches it on its own once CI passes, end-to-end tests included: GitHub publishes the change over the air, or starts a new beta build when the native side changed (`.github/workflows/beta.yml`).
- **A main flow has an end-to-end test** in `.maestro/flows/ci/` (Maestro on an Android emulator, a release build against the local Supabase; [.maestro/README.md](.maestro/README.md)). A screen that changes one updates its flow in the same PR; run `pnpm e2e` before opening it. Metro and the dev build are for agents while they build.

## Plans

Design work lives in [docs/plans/](docs/plans/) by stage (`ideas/` → `ready/` → `ongoing/`), with the agent-plans v2 header (`Priority`, `Gate`, `Next`). Durable rationale for shipped work goes to [docs/decisions/](docs/decisions/). See the `managing-plans-lifecycle` skill.

## Invariants (from the product plan)

1. **Every organisation is separate.** Its record, operational data, documents and keys never mix with another's.
2. **Data stays in the EU**, on storage we own, with a live copy the customer can switch on (their Drive or GitHub) and a full export at any time.
3. **Keys live in a vault**, apart from everything else. No secret is ever committed or pasted into a conversation.
4. **The agents work on files with history** (the record is git); the app reads the database, not the files.
