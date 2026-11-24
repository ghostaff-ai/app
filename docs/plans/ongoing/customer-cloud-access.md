# A customer's Google Cloud, reached as that organisation's own service account

**Priority:** high — Órdago's agents read BigQuery and write buckets in `ordago-prod`, and none of that can move to Ghostaff without it; today's Vertex connection already shares one identity across customers
**Gate:** decision:Jaime confirms an account per organisation, in a `ghostaff-tenants-<env>` project of its own (proposed 2026-11-24)
**Next:** create `ghostaff-tenants-beta` with the engine as its only service-account admin (`scripts/setup-env.sh`)

The design is in [architecture.md](../../architecture.md#target-a-customers-google-cloud); this plan is the work. Jaime (2026-11-24): Órdago runs on Ghostaff as any customer would, and a customer with data in its own BigQuery can give an agent that data without Ghostaff holding one identity that reaches every customer.

## Decisions

1. **One service account per organisation**, `org-<id>@ghostaff-tenants-<env>.iam.gserviceaccount.com`, created when an owner first connects Google Cloud. Not per agent yet: every agent of the organisation shares its grants. *(Proposed; confirm.)*
2. **The accounts live in `ghostaff-tenants-beta` and `ghostaff-tenants-prod`**, where the engine is service-account admin and nothing else, so that role cannot reach `engine@`, `runner@` or `deployer@`. *(Proposed; confirm.)*
3. **The engine grants itself token creator on each account it creates**, on that account only. `runner@` gets nothing.
4. **A run gets a one-hour access token** in its spec, beside the record's, with an endpoint to renew it for longer runs (as `POST /runs/:id/record-token`).
5. **The grant is checked as the organisation's account**, with its own token, never as `engine@`.
6. **Vertex AI for chat moves to the same account**: one Google Cloud connection per organisation serves both Claude on Vertex and the agents' data.

## Tasks

- [ ] **Tenants project.** `setup-env.sh` creates the service-account side of `ghostaff-tenants-<env>` (a founder creates the project by hand, since that needs rights on the Google Cloud organisation; billing only if Google asks for it, as IAM itself is free): enable `iam` and `iamcredentials`, grant `engine@<env project>` `roles/iam.serviceAccountAdmin` there and nothing in the main project. Re-runs create nothing.
- [ ] **Database.** The Google Cloud connection (today `provider = 'vertex'`) gains the account's email and the customer's project; its region stays for Vertex. Migration and pgTAP: members read it, only the engine writes it.
- [ ] **Engine, connect.** `POST /connections/ai` for Google Cloud creates `org-<id>@` (idempotent: a retry finds it), grants the engine token creator on it, stores the connection, and returns the account's email and the commands to run. Removing it deletes the account.
- [ ] **Engine, check.** «Comprobar» mints a token as the account and asks the customer's project which of the expected permissions it holds (`testIamPermissions` on the project, BigQuery `datasets.get` on a named dataset); the answer is shown, never cached as proof.
- [ ] **Engine, runs.** The spec carries `google: { project, token, expiresAt }` when the organisation has the connection; `POST /runs/:id/google-token` renews it.
- [ ] **Engine, chat.** Vertex replies use the organisation's account token instead of `engine@`'s. Before merging, list the Vertex connections in each Supabase: any made with `engine@` needs its owner to grant the new account (the app says so on the card).
- [ ] **Runner.** The image gains the Google Cloud CLI (`gcloud`, `bq`); the agent's environment points `gcloud` at the token (`CLOUDSDK_AUTH_ACCESS_TOKEN_FILE` in its throwaway HOME) and its default project at the customer's. Check that `bq` honours it before relying on it; the redaction of secrets in reports covers the token.
- [ ] **App.** Conexiones → Google Cloud: the account's email, the commands to grant it (copyable), «Comprobar» and what it found, and a line for organisations whose policy restricts sharing to their own domain.
- [ ] **Órdago as the first customer.** In `ordago-prod` and `ordago-media`, grant `org-<órdago>@` the union of what the agents' accounts hold today ([ordago-agents-in-ghostaff.md](ordago-agents-in-ghostaff.md#what-each-agent-needs)), and check it from the app.

## Later

- An account per agent, for an organisation that wants least privilege between its agents.
- Workload Identity Federation for customers on AWS or Azure.
