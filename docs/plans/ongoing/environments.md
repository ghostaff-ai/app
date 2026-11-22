# Two environments: beta from develop, production from main

**Priority:** high — production will hold customers' AI keys and mailboxes; today the only engine talks to the beta database, and deploys are run by hand
**Gate:** none
**Next:** create Supabase project `ghostaff-prod` (Frankfurt, organisation Ghostaff), with Jaime setting its database password

Jaime (2026-11-22): one Google Cloud project and one Supabase per environment, set up as Órdago's: merge to `develop` brings up beta, merge to `main` brings up production. Front 1 of [ordago-as-customer.md](ordago-as-customer.md). It replaces the proposal in [build-first-version.md](build-first-version.md#environments-beta-and-production) of 2026-11-15.

## Today (2026-11-22)

- Supabase: only `ghostaff-beta` (ref `rggvcvnstbitbdptiwtk`, Frankfurt). Órdago is created there, Álvaro owner.
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
