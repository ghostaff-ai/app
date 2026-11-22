# Two environments: beta from develop, production from main

**Priority:** high — production will hold customers' AI keys and mailboxes; today the only engine talks to the beta database, and deploys are run by hand
**Gate:** none
**Next:** Jaime enters the Google web client's secret in production's Supabase (Authentication → Sign In / Providers → Google); then step 4, the deploy scripts per environment

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

## Steps

1. **Supabase `ghostaff-prod`**: Frankfurt, organisation Ghostaff, Free plan until customer data arrives (then Pro, for backups and no pausing). Jaime sets the database password himself. Same auth settings as beta: 6-digit email codes, sign-ups on, Google and Apple providers, redirect URLs.
2. **Its keys into `secrets/secrets.enc.yml`** (`SUPABASE_*_PROD`). Jaime's age key is not a recipient yet: Álvaro adds it, or puts the keys in.
3. **Schema on production**: `supabase db push` against `ghostaff-prod`.
4. **Deploy scripts take the environment** (`beta` | `prod`): project, Supabase URL, secret names. The beta engine and runner move to `ghostaff-beta`; the beta app's pinned engine URL in `app.config.ts` changes with them. Vault secrets the beta organisations already stored in `ghostaff-prod`'s Secret Manager move too, or get reconnected.
5. **Production engine and runner** on `ghostaff-prod`, against the production Supabase; Cloud Scheduler's tick per environment.
6. **CI deploys**: Workload Identity Federation in both projects; a beta workflow (from `develop`) and a production one (from `main`) for migrations, engine and runner; the production app (EAS `production` profile, `ai.ghostaff.app`).
7. **The production app's sign-in**: Google OAuth clients for `ai.ghostaff.app` and production's Supabase providers (left open in build-first-version.md).

## Open

- `[unknown: whether the ghostaff-ai GitHub plan allows environment secrets on a private repo; if not, repository secrets with a _BETA / _PROD suffix]`
- `[unknown: whether the GitHub App «Ghostaff Registro» is one for both environments or one each]`

## Progress

- [x] Step 1 (2026-11-22): Supabase `ghostaff-prod`, ref `krhhndjjqmmkzjmwwazv`, Central EU (Frankfurt), Postgres 17, Free plan, organisation Ghostaff; created by Jaime, who keeps its database password. «Grant API access to new tables automatically» ticked, as local and beta behave: the migrations grant functions but rely on tables being exposed by default, with row-level security on every table.
- [x] Auth copied from beta through the Management API: 6-digit codes, sign-ups on, Google (the web client and the iOS client of `ai.ghostaff.app` only), Apple (`ai.ghostaff.app` only), redirect `ghostaff://**` (no `exp://**`: Expo Go has no place in production). Left: **SMTP** (without it production sends through Supabase's default, two emails an hour, and the Free plan refuses a custom template until SMTP is set) and the **Google web client's secret** (needed for Google on the web, not on the phones). Both are secrets, for Jaime to enter in the dashboard.
- [x] Step 3 (2026-11-22): the 15 migrations of `develop` pushed (`supabase link`, `db push`, `unlink`, so no folder stays linked to production). Checked against beta: same migrations, same 16 tables, all with row-level security, same 27 functions.
- [x] SMTP (2026-11-22): Jaime set Resend with a key of its own for production (checked: differs from beta's); beta's Spanish sign-in email copied (subject and template, checked equal). Still missing: the Google web client's secret (the provider is on with its client ids, so the phones work; Google on the web fails until it is set).
- [ ] Step 2: production's keys in sops, waiting on Álvaro adding Jaime's age key as a recipient, or putting them in himself.
