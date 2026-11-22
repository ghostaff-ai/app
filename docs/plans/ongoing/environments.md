# Two environments: beta from develop, production from main

**Priority:** high — production will hold customers' AI keys and mailboxes; today the only engine talks to the beta database, and deploys are run by hand
**Gate:** none
**Next:** step 4, the scripts per environment (and, by Jaime, the Google web client's secret in production's Supabase)

Jaime (2026-11-22): one Google Cloud project and one Supabase per environment, set up as Órdago's: merge to `develop` brings up beta, merge to `main` brings up production. Front 1 of [ordago-as-customer.md](ordago-as-customer.md). It replaces the proposal in [build-first-version.md](build-first-version.md#environments-beta-and-production) of 2026-11-15.

## Today (2026-11-22)

- Supabase: `ghostaff-beta` (ref `rggvcvnstbitbdptiwtk`, Frankfurt), where Órdago is created with Álvaro as owner; `ghostaff-prod` created later that day (Progress).
- Google Cloud: `ghostaff-prod` runs the `engine` service and the `agent-runner` job, **against the beta Supabase** (`SUPABASE_SERVICE_ROLE_KEY_BETA`). `ghostaff-beta` exists, empty.
- CI: `ci.yml` (checks and end-to-end) and `beta.yml` (on green CI on `develop`, publishes the beta app over the air or starts a beta build). Migrations, engine and runner are deployed by hand by Álvaro (`scripts/deploy-engine.sh`, `deploy-runner.sh`): the agents' classifier blocks Google Cloud tokens.

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
