# A customer's Google Cloud, reached as that organisation's own service account

**Priority:** high — Órdago's agents read BigQuery and write buckets in `ordago-prod`, and none of that can move to Ghostaff without it, and every other Google Cloud use must not share one identity across customers as Vertex did
**Gate:** none
**Next:** once `feat/customer-cloud-access` lands, run `bash scripts/setup-env.sh beta` (it creates `ghostaff-tenants-beta`), then connect Claude on Vertex on the beta to try it; then the runner's token

The design is in [architecture.md](../../architecture.md#a-customers-google-cloud); this plan is the work. Jaime (2026-11-24): Órdago runs on Ghostaff as any customer would, and a customer with data in its own BigQuery can give an agent that data without Ghostaff holding one identity that reaches every customer.

## Decisions

1. **One service account per organisation**, `org-<first 24 hex digits of its id>@ghostaff-tenants-<env>.iam.gserviceaccount.com`, created when an owner first connects Google Cloud. Not per agent yet: every agent of the organisation shares its grants (Jaime, 2026-11-24).
2. **The accounts live in `ghostaff-tenants-beta` and `ghostaff-tenants-prod`**, where the engine is service-account admin and nothing else, so that role cannot reach `engine@`, `runner@` or `deployer@` (Jaime, 2026-11-24).
3. **The engine grants itself token creator on each account it creates**, on that account only. `runner@` gets nothing.
4. **A run gets a one-hour access token** in its spec, beside the record's, with an endpoint to renew it for longer runs (as `POST /runs/:id/record-token`).
5. **The grant is checked as the organisation's account**, with its own token, never as `engine@`.
6. **Vertex AI for chat moves to the same account**: one Google Cloud identity per organisation serves both Claude on Vertex and the agents' data. No Vertex connection existed on beta or production (checked 2026-11-24), so nothing had to be reconnected.
7. **The account lasts as long as the organisation**, not the connection: a customer who removes Vertex and adds it again keeps their grants. It goes with the organisation, once deleting an organisation exists.

## Tasks

- [x] **Tenants project** (`feat/customer-cloud-access`): `scripts/setup-env.sh` creates `ghostaff-tenants-<env>` (`TENANTS_P` in `scripts/env.sh`) with only `iam` and `iamcredentials`, and makes `engine@<env project>` its service-account admin; `deploy-engine.sh` passes `TENANTS_PROJECT`. **Not run yet** on either environment.
- [x] **Database**: `cloud_accounts` (organisation, email, Google's unique id), closed to every app role, pgTAP `cloud_accounts.test.sql`.
- [x] **Engine** (`apps/engine/src/cloudAccounts.ts`): creates the account once (a half-done attempt is finished by the next; an account with its name made for another organisation is never adopted), lets only the engine act as it, mints one-hour tokens. `POST /cloud-account` gives an owner the email, creating it if need be; `GET /identity` (the shared `engine@`) is gone.
- [x] **Engine, chat**: Vertex is checked and called as the organisation's account (`server.ts` `checkVertexAs`, `chatStore.ts` `writerFactory`).
- [x] **App**: the Vertex form shows the organisation's own account to grant.
- [ ] **Set up**: `bash scripts/setup-env.sh beta`, then `prod` (each creates its tenants project); try Claude on Vertex on the beta with a real project.
- [ ] **Runs.** The spec carries `google: { project, token, expiresAt }` when the organisation has a Google Cloud connection for data; `POST /runs/:id/google-token` renews it. A fresh token per run (`mintCloudToken`), never the engine's cached one.
- [ ] **Runner.** The image gains the Google Cloud CLI (`gcloud`, `bq`); the agent's environment points `gcloud` at the token (`CLOUDSDK_AUTH_ACCESS_TOKEN_FILE` in its throwaway HOME) and its default project at the customer's. Check that `bq` honours it before relying on it; the redaction of secrets in reports covers the token.
- [ ] **App, data.** Conexiones → Google Cloud for data (not only Vertex): the account's email, the commands to grant it (copyable), «Comprobar» (asked as the account: `testIamPermissions`, BigQuery `datasets.get`) and what it found, and a line for organisations whose policy restricts sharing to their own domain.
- [ ] **Órdago as the first customer.** In `ordago-prod` and `ordago-media`, grant Órdago's account the union of what the agents' accounts hold today ([ordago-agents-in-ghostaff.md](ordago-agents-in-ghostaff.md#what-each-agent-needs)), and check it from the app.

## Later

- An account per agent, for an organisation that wants least privilege between its agents.
- Workload Identity Federation for customers on AWS or Azure.
