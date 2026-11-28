# Two environments: beta from develop, production from main

**Priority:** high — production will hold customers' AI keys and mailboxes; today the only engine talks to the beta database, and deploys are run by hand
**Gate:** none
**Next:** once PR #42 merges, the next push to `develop` deploys beta from CI green; production comes up with the first release

Jaime (2026-11-22): one Google Cloud project and one Supabase per environment, set up as Órdago's: merge to `develop` brings up beta, merge to `main` brings up production. Front 1 of [ordago-as-customer.md](ordago-as-customer.md). It replaces the proposal in [build-first-version.md](build-first-version.md#environments-beta-and-production) of 2026-11-15.

## Today (2026-11-22)

- Supabase: `ghostaff-beta` (ref `rggvcvnstbitbdptiwtk`, Frankfurt), where Órdago is created with Álvaro as owner; `ghostaff-prod` created later that day (Progress).
- Google Cloud: `ghostaff-prod` runs the `engine` service and the `agent-runner` job, **against the beta Supabase** (`SUPABASE_SERVICE_ROLE_KEY_BETA`). `ghostaff-beta` exists, empty.
- CI: `ci.yml` (checks and end-to-end) and `beta.yml` (on green CI on `develop`, publishes the beta app over the air or starts a beta build). Migrations, engine and runner are deployed by hand by Álvaro (`scripts/deploy-engine.sh`, `deploy-runner.sh`): the agents' classifier blocks Google Cloud tokens.
- **Beta builds on EAS's free plan** (Álvaro, 2026-11-27: keep it). A change that touches the native side (a new module, a permission) needs a new build: when the monthly iOS builds run out, `beta.yml`'s iOS build fails and iPhones stay on the last build until the month resets (the 1st); Android goes on. Android's beta is an APK installed by hand (`beta-apk`), so a new Android build must be installed from its EAS page once; only then do over-the-air updates reach it again.
- **A new iOS capability needs one interactive build.** CI's builds can't change Apple settings: when the app gains one (push notifications, #75), every iOS build fails with «Provisioning profile … doesn't include the … capability» until Álvaro runs `APP_ENV=beta npx eas-cli build --platform ios --profile beta --auto-submit` in a terminal of its own (not `!`, it asks questions), logs in to Apple, and reuses the profile it offers. Done for push on 2026-11-27; answer «No» to Expo's own push setup (the engine sends to APNs itself).

## Target

| Environment | Branch | Google Cloud | Supabase | App |
|---|---|---|---|---|
| Beta | `develop` | `ghostaff-beta` | `ghostaff-beta` | `ai.ghostaff.app.beta` |
| Production | `main` | `ghostaff-prod` | `ghostaff-prod` | `ai.ghostaff.app` |

On green CI on each branch, the workflow for that environment: applies Supabase migrations, deploys the engine and the runner, and publishes the app (over the air, or a build when the native side changed). Beta keeps us and test organisations; production holds real organisations (Órdago and Ghostaff, when their turn comes).

**CI authenticates to Google Cloud with Workload Identity Federation**, one deployer service account per project, as `ordago-apps` does (`.github/workflows/console-deploy.yml`): no key in GitHub, and no person needs a Google Cloud token on their machine to deploy.

## Decisions (Jaime, 2026-11-22)

1. **Each environment's keys live in its own Secret Manager**, which is their source: production's service-role key goes from Supabase's API straight into `ghostaff-prod`'s Secret Manager, never shown to anyone. sops stops being needed to deploy the engine (it was the step only Álvaro could do: Jaime's age key is not a recipient).
2. **One Google OAuth client set and one GitHub App («Ghostaff Registro») for both environments**: only their secrets are copied into each project. OAuth clients per environment would mean Google's verification twice.
3. **Same secret names in both projects** (`SUPABASE_SERVICE_ROLE_KEY`, `github-app-registro-key`, `google-oauth-connectors-secret`), each with its own value.
4. **Repository secrets with a `_BETA` / `_PROD` suffix**, since the `ghostaff-ai` organisation is on GitHub's free plan (no environment secrets on a private repo). **Google enforces the branch**: each project's Workload Identity provider accepts only `ghostaff-ai/app` from `develop` (beta) or `main` (production), so a run on `develop` cannot touch production even with the repository's secrets.
5. **Setup apart from deploy**: a one-time setup per environment (APIs, service accounts, roles, Workload Identity, secrets), run by a person; the deploy (build, push, deploy, tick) is what CI runs on every merge.
6. **Beta moves without a gap**: the new engine, runner and tick come up in `ghostaff-beta` first, then the beta app gets the new engine URL over the air, and only then is the old one removed from `ghostaff-prod`. The beta Supabase does not change.

## Steps

1. **Supabase `ghostaff-prod`**: Frankfurt, organisation Ghostaff, Free plan until customer data arrives (then Pro, for backups and no pausing). Jaime sets the database password himself. Same auth settings as beta.
2. ~~Its keys into sops~~: replaced by decision 1.
3. **Schema on production**: `supabase db push` against `ghostaff-prod`.
4. **Scripts take the environment** (`beta` | `prod`): one file of per-environment values, a setup script, and the deploy scripts for the engine and the runner.
5. **Beta in `ghostaff-beta`** (decision 6): setup, deploy, the app's beta engine URL, then the old service, job and tick removed from `ghostaff-prod`. Checked 2026-11-22: no organisation has stored a key in the vault yet, so nothing else moves.
6. **Production engine and runner** in `ghostaff-prod`, against the production Supabase; the production app's engine URL and anon key.
7. **CI deploys**: a beta workflow (green CI on `develop`) and a production one (green CI on `main`) for migrations, engine and runner. Migrations need a Supabase access token and each database's password as repository secrets, which Jaime enters.
8. **The production app**: its EAS `production` profile and store builds from `main`; Google sign-in on the web once the web client's secret is in production's Supabase.

## Progress

- [x] Step 1 (2026-11-22): Supabase `ghostaff-prod`, ref `krhhndjjqmmkzjmwwazv`, Central EU (Frankfurt), Postgres 17, Free plan, organisation Ghostaff; created by Jaime, who keeps its database password. «Grant API access to new tables automatically» ticked, as local and beta behave: the migrations grant functions but rely on tables being exposed by default, with row-level security on every table.
- [x] Auth copied from beta through the Management API: 6-digit codes, sign-ups on, Google (the web client and the iOS client of `ai.ghostaff.app` only), Apple (`ai.ghostaff.app` only), redirect `ghostaff://**` (no `exp://**`: Expo Go has no place in production). Left: **SMTP** (without it production sends through Supabase's default, two emails an hour, and the Free plan refuses a custom template until SMTP is set) and the **Google web client's secret** (needed for Google on the web, not on the phones). Both are secrets, for Jaime to enter in the dashboard.
- [x] Step 3 (2026-11-22): the 15 migrations of `develop` pushed (`supabase link`, `db push`, `unlink`, so no folder stays linked to production). Checked against beta: same migrations, same 16 tables, all with row-level security, same 27 functions.
- [x] SMTP (2026-11-22): Jaime set Resend with a key of its own for production (checked: differs from beta's); beta's Spanish sign-in email copied (subject and template, checked equal). Still missing: the Google web client's secret (the provider is on with its client ids, so the phones work; Google on the web fails until it is set).
- [x] «Confirm email» off in beta and production (2026-11-22, Management API `mailer_autoconfirm: true`), as `enable_confirmations = false` locally. With it on, a first-time email got Supabase's English «Confirm signup» link instead of the 6-digit code, so nobody new could sign in (Jaime hit it on beta). The code already proves the address; a new environment must set this too.

## Implementation (steps 4–7)

> **For agentic workers:** use superpowers:executing-plans (or subagent-driven-development) task by task; steps use checkboxes.

**Goal:** beta runs entirely in `ghostaff-beta`, production in `ghostaff-prod`, and CI deploys each from its branch.

**Architecture:** one sourced file holds each environment's values; a one-time `setup-env.sh` makes everything a person must grant; `deploy-engine.sh` and `deploy-runner.sh` only build and deploy, and run the same on a laptop and in CI. CI deploys from jobs inside `ci.yml` (not a `workflow_run` workflow: those always run on the default branch, so Google could not tell `main` from `develop` by the token's `ref`).

**Tech stack:** bash, gcloud, docker, the Supabase CLI (`npx supabase`), GitHub Actions with `google-github-actions/auth@v2`.

### Global constraints

- Region `europe-west1` for Cloud Run, Artifact Registry, Scheduler and Secret Manager (user-managed replication there).
- Project numbers: `ghostaff-beta` 1002624835789, `ghostaff-prod` 664656500315. Engine URLs are deterministic: `https://engine-<number>.europe-west1.run.app`.
- Supabase: beta `rggvcvnstbitbdptiwtk`, production `krhhndjjqmmkzjmwwazv`.
- No secret value is ever printed, written to a file, passed on a command line or shown in a chat: secrets go pipe to pipe (`… | gcloud secrets versions add … --data-file=-`).
- Every script stays safe to re-run.
- Branch → environment: `develop` → beta, `main` → production, enforced by each project's Workload Identity provider.

### Review focus

1. A run with no or an unknown environment argument must stop before touching any project (`env.sh` exits 2 with usage).
2. Re-running `setup-env.sh` on a set-up project must change nothing and fail on nothing (every create is behind a describe).
3. A deploy job on a `develop` push must be refused by `ghostaff-prod` even with every repository secret (checked once by hand: a workflow_dispatch on `develop` asking for prod fails at `auth`).
4. The beta app must never point at an engine that is not up: the app's URL changes only after the new beta engine answers `/health`.
5. Removing the old beta from `ghostaff-prod` must not remove anything production then needs (only `engine`, `agent-runner` and `tick` are recreated, by the production deploy).

---

### Task 1: Per-environment values

**Files:** create `scripts/env.sh`, `scripts/env.test.sh`; modify `package.json` (`check` runs the test, as it does `metro-port.test.sh`).

**Produces:** sourcing `scripts/env.sh <beta|prod>` exports `GHOSTAFF_ENV`, `P` (project id), `PROJECT_NUMBER`, `R=europe-west1`, `SUPABASE_REF`, `SUPABASE_URL`, `ENGINE_URL`, `DEPLOY_BRANCH`, `WIF_PROVIDER` (`projects/<number>/locations/global/workloadIdentityPools/github/providers/ghostaff-app`), `DEPLOYER_SA` (`deployer@<P>.iam.gserviceaccount.com`), and the public ids now at the top of `deploy-engine.sh` (Google connectors client id, GitHub App id). Outside CI (`$CI` unset) it also exports `CLOUDSDK_ACTIVE_CONFIG_NAME=${CLOUDSDK_ACTIVE_CONFIG_NAME:-ghostaff-prod}` (the configuration on Jaime's Mac signed in as ghostaff.ai@gmail.com).

- [ ] Write `env.test.sh`: `beta` gives `P=ghostaff-beta`, `ENGINE_URL=https://engine-1002624835789.europe-west1.run.app`, `SUPABASE_URL=https://rggvcvnstbitbdptiwtk.supabase.co`, `DEPLOY_BRANCH=develop`; `prod` gives `P=ghostaff-prod`, `ENGINE_URL=https://engine-664656500315.europe-west1.run.app`, `SUPABASE_URL=https://krhhndjjqmmkzjmwwazv.supabase.co`, `DEPLOY_BRANCH=main`; no argument and `staging` exit 2 with `usage:` on stderr.
- [ ] Run `bash scripts/env.test.sh`: fails (no `env.sh`).
- [ ] Write `env.sh`; run the test: passes. `pnpm check` green.
- [ ] Commit on a branch in a worktree (`git worktree add .claude/worktrees/environments -b feat/environments origin/develop`).

### Task 2: One-time setup per environment

**Files:** create `scripts/setup-env.sh`.

**Consumes:** `env.sh`. **Produces:** in project `$P`: APIs (run, secretmanager, artifactregistry, cloudresourcemanager, iam, iamcredentials, sts, aiplatform, cloudscheduler); service accounts `engine` (`roles/secretmanager.admin` on the project, as today, and `roles/aiplatform.user` for dictation, voice.md), `scheduler`, `runner` (no roles), `deployer`; Artifact Registry repos `engine` and `runner`; `deployer` gets `roles/run.admin`, `roles/artifactregistry.writer`, `roles/cloudscheduler.admin`, `roles/secretmanager.viewer` (metadata only, for the connector checks) and `roles/iam.serviceAccountUser` on `engine`, `runner` and `scheduler` only; Workload Identity pool `github`, OIDC provider `ghostaff-app` (issuer `https://token.actions.githubusercontent.com`, condition `assertion.repository == 'ghostaff-ai/app' && assertion.ref == 'refs/heads/$DEPLOY_BRANCH'`), and `roles/iam.workloadIdentityUser` for that provider's principal set on `deployer`; secrets:
  - `SUPABASE_SERVICE_ROLE_KEY`, when missing: `npx supabase projects api-keys --project-ref $SUPABASE_REF -o json` piped through a filter that keeps only the `service_role` key, into `gcloud secrets create … --data-file=-`.
  - For beta only, when missing: `github-app-registro-key`, `google-oauth-connectors-secret` and any `engine-app-*` copied from `ghostaff-prod` pipe to pipe (`versions access latest | versions add`).

- [ ] Write it; `bash -n scripts/setup-env.sh`.
- [ ] Run `bash scripts/setup-env.sh beta`; then run it again: the second run creates nothing and exits 0.
- [ ] Check: `gcloud iam workload-identity-pools providers describe ghostaff-app --location global --workload-identity-pool github --project ghostaff-beta --format 'value(attributeCondition)'` shows `refs/heads/develop`; `gcloud secrets list --project ghostaff-beta` lists the copied secrets and `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] Commit.

### Task 3: Deploy scripts take the environment

**Files:** modify `scripts/deploy-engine.sh`, `scripts/deploy-runner.sh`, `scripts/connector-app.sh` (first argument the environment), `AGENTS.md` and `README.md` (the commands).

**Consumes:** `env.sh`, and what `setup-env.sh` made. The deploy scripts no longer enable APIs, create accounts, grant roles or read sops. The engine gets `SUPABASE_URL`, `ENGINE_PUBLIC_URL=$ENGINE_URL`, `SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest` and the rest as today; the tick calls `$ENGINE_URL/cron`. Image tags stay the commit's short SHA.

- [ ] Rewrite; `bash -n` on each.
- [ ] `bash scripts/deploy-runner.sh beta`, then `bash scripts/deploy-engine.sh beta`: `curl -fsS https://engine-1002624835789.europe-west1.run.app/health` answers.
- [ ] Commit, push the branch, open the PR with Tasks 1–3, label `automerge`.

### Task 4: The beta app moves to the new engine

**Files:** modify `apps/mobile/app.config.ts` (`engineUrlPerEnv.beta` → `https://engine-1002624835789.europe-west1.run.app`, `engineUrlPerEnv.prod` → `https://engine-664656500315.europe-west1.run.app`; the comment above says which project serves which).

- [ ] Only after Task 3's `/health` answers: change, `pnpm check`, PR with `automerge`. Once merged, `beta.yml` publishes the update over the air.
- [ ] Person steps (Jaime, in consoles): add `https://engine-1002624835789.europe-west1.run.app/connections/oauth/google/callback` to the OAuth client «Ghostaff Conectores» in `ghostaff-prod`, and the beta callback to each maker app already registered (HubSpot, Asana; `connectors.md`).
- [ ] Check: open the beta app, send a message to an agent; the request shows in `gcloud run services logs read engine --project ghostaff-beta --region europe-west1 --limit 20`.

### Task 5: Old beta out of `ghostaff-prod`

**Files:** none (cloud only); `connectors.md` and this plan updated with the new URLs.

- [x] Jaime OK'd it (2026-11-22). Deleted in `ghostaff-prod`: Cloud Run service `engine`, job `agent-runner`, Scheduler job `tick`, secret `SUPABASE_SERVICE_ROLE_KEY_BETA`. Keep the other secrets, accounts and repos: production uses them.

### Task 6: Production up

**Files:** none in the repo beyond this plan.

- [x] `bash scripts/setup-env.sh prod` (twice: the second changes nothing).
- [ ] Production's runner and engine come up from CI with the first release (`develop` into `main`), not by hand: a hand deploy now would ship `develop`'s code to production without that decision, and production's Supabase still lacks migration `20261122200000` (several AI accounts), which CI applies first. Until then `ghostaff-prod` runs nothing. Then `curl -fsS https://engine-664656500315.europe-west1.run.app/health` answers.
- [x] Production's anon key (public by design) in EAS's `production` environment as `SUPABASE_ANON_KEY_PROD`, plaintext (2026-11-23, from Álvaro's machine: his Expo login is a Developer on `ghostaff.ai`, enough to set it; piped from `supabase projects api-keys`, checked equal, ref `krhhndjjqmmkzjmwwazv`, role anon).

### Task 7: CI deploys

**Files:** create `.github/workflows/deploy.yml` (reusable, `on: workflow_call` with input `environment`: `beta` | `prod`); modify `.github/workflows/ci.yml` (a `deploy` job: `needs: [check, database, e2e-android]`, `if: github.event_name != 'pull_request' && (github.ref == 'refs/heads/develop' || github.ref == 'refs/heads/main')`, calls `deploy.yml` with `beta` on `develop` and `prod` on `main`, `permissions: id-token: write, contents: read`).

`deploy.yml`, in order: a branch guard (`$GITHUB_REF` must be `refs/heads/$DEPLOY_BRANCH`, before anything touches a database), then `google-github-actions/auth@v2` with `workload_identity_provider: $WIF_PROVIDER` and `service_account: $DEPLOYER_SA` (read from `env.sh`), `google-github-actions/setup-gcloud@v2`, migrations (`supabase db push --remote=<ref> --yes` with `SUPABASE_ACCESS_TOKEN`; the CLI signs in through a temporary login role, so no database password), `bash scripts/deploy-runner.sh <env>`, `bash scripts/deploy-engine.sh <env>`, and `curl -fsS $ENGINE_URL/health`.

- [x] Jaime added the repository secret `SUPABASE_ACCESS_TOKEN` (2026-11-22): a scoped token on beta and production with Project Settings: Read, Database: Read-write, Migrations: Read-write and **Connection Pooling: Read**. That last one matters: GitHub's runners have no IPv6, and the CLI asks the Management API for the pooler to reach the database over IPv4. Without it the migrations fail with «IPv6 is not supported on your current network».
- [x] Both files, PR #41 (merged 2026-11-22). Its first CI deploys got the token empty through `secrets: inherit`, while a dispatch of `deploy.yml` read it; PR #42 passes it by name and makes it a required `workflow_call` secret. A dispatch of `deploy.yml` for beta from `develop` (run 45054509173) went green end to end: migrations up to date, runner, engine, `/health` `{"ok":true}`.
- [ ] After #42 merges, the CI run on `develop` deploys beta green on its own.
- [x] Review focus 3 by hand (run 45054922993): a dispatch from `develop` asking for `prod` stops at the `Environment` step («prod deploys only from main, not refs/heads/develop»), before Google or any database. Google's own lock stands behind it: `ghostaff-prod`'s provider accepts only `assertion.ref == 'refs/heads/main'`.
- [ ] Production deploys from CI the first time `develop` is merged into `main`. That merge is the first release (`main` is still the scaffold, 191 commits behind): either founder decides when.
- [x] Tasks 1–3 (2026-11-22, PR #36, branch `feat/environments`): `scripts/env.sh` with its test, `scripts/setup-env.sh`, the deploy scripts per environment. `ghostaff-beta` set up (re-runs create nothing), runner and engine deployed there, `/health` and the tick's `/cron` answer 200. The old tick in `ghostaff-prod` is **paused** (not deleted), so beta's database has one tick; the old engine there keeps serving the beta app until #36 lands.
- [x] Task 4 code in #36: the beta app's engine is `https://engine-1002624835789.europe-west1.run.app`, production's `https://engine-664656500315.europe-west1.run.app`. #36 merged on 2026-11-22 and the beta app talks to the new engine (its `/connections/ai/claude/session` calls land in `ghostaff-beta` since 16:34 UTC); the old engine in `ghostaff-prod` gets no app traffic since.
- [x] Task 6, setup only: `bash scripts/setup-env.sh prod` (deployer, Workload Identity on `main`, `SUPABASE_SERVICE_ROLE_KEY` from Supabase). The deploy comes with the first release.
- [x] Task 5 (2026-11-22): the old beta engine, runner, tick and `SUPABASE_SERVICE_ROLE_KEY_BETA` deleted from `ghostaff-prod`; left there: `SUPABASE_SERVICE_ROLE_KEY`, `github-app-registro-key`, `google-oauth-connectors-secret`, the accounts and registries.
- [x] `SUPABASE_ACCESS_TOKEN` in the repository's secrets (Jaime, 2026-11-22); PR #41 labelled `automerge`. `scripts/env.sh` defaults the gcloud configuration to `ghostaff-prod`, as this plan said (it had `ghostaff`, which does not exist on Jaime's Mac).
- [x] Task 7 written on `feat/ci-deploy`, PR #41: `deploy.yml` (branch guard, Google auth, migrations with `supabase db push --remote=<ref> --yes`, runner, engine) and a `deploy` job in `ci.yml`. Only one repository secret is needed, `SUPABASE_ACCESS_TOKEN`: the CLI pushes through a temporary login role, no database password.
