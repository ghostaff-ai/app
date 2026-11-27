# Keys and passwords from the app, never from a terminal

**Priority:** high — Jaime (2026-11-27): «estamos apuntando a usuarios no técnicos»; today any tool without a sign-in button (a mailbox by IMAP, ElevenLabs, a Meta token) only reaches an agent through `org set-secret` in a terminal
**Gate:** none
**Next:** slice 1, branch `feat/app-keys`: build it test first (Tasks below), land it, backfill Órdago's four rows on beta

Found moving Órdago's agents ([ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md)): Correo, Finanzas, Productor and Orgánico needed four secrets (`correo-info`, `correo-gmail`, `elevenlabs`, `meta-token`), and the only way in was a hidden prompt in `pnpm --filter @ghostaff/sync org set-secret`, run by someone with `gcloud` and the service-role key. The map of every manual step and its in-app equivalent is in [ordago-as-customer.md](../ongoing/ordago-as-customer.md#what-we-did-by-hand-for-órdago-and-how-a-customer-will-do-it-jaime-2026-11-27).

**Goal:** an owner, on their phone, stores a key or an app password, sees which agents use it, replaces it and removes it; gives it to an agent or takes it away; and an agent that lacks one asks for it in its chat. Nobody opens a terminal, and the value never passes through a model, a message or the database.

## What exists today

The vault (Secret Manager of the environment, `apps/engine/src/vault.ts`) already holds four kinds of secret, each written its own way:

| Kind | Name in the vault | Written by | Read by |
|---|---|---|---|
| AI keys and the Claude subscription | `aiSecretName(org, connection)` | Conexiones › IA (`connections.ts`, `claudeSession.ts`) | the engine, to run the model |
| Connector tokens (Google…) | `accountSecretName(org, provider)` | the sign-in flow (`accounts.ts`) | the engine's tools |
| A guide's `secret` block | `guidedSecretName(org, guide)` | [guided-access.md](../ongoing/guided-access.md) (`guidedAccounts.ts`) | the check, then the agent's access |
| A runner agent's variables | `agentSecretName(org, name)` = `org-<org>-secret-<name>` | **only** `org set-secret` (CLI) | the runner: `agents.secrets` (`{"VARIABLE": "name"}`) → the run's spec → Claude Code's environment |

`agents.secrets` is filled only by `org add-agents` from a YAML's `secretos`. The app neither shows it nor changes it, and a chat agent (not a runner agent) has no way to use one.

## Proposal

1. **One kind for «a key or a password the organisation gives its agents»**: the runner's `org-<org>-secret-<name>`, with a row per secret in the database holding only metadata (name, label, the maker it is for, who stored it, when, last used, health), never the value. A guide's `secret` block writes the same kind, so what a guide gets is usable by a runner agent too.
2. **Conexiones › Claves** (owners): the list (label, maker's icon, which agents use it, stored by, when), «Añadir clave» (a secure field, sent from the app straight to the engine and the vault, as an AI key is today), replace, remove (asks first when an agent uses it, and names them). Masked afterwards, never shown again.
3. **An agent's Herramientas screen** lists its keys and lets an owner give or take one away: it writes `agents.secrets`, through the same owner check and settings rule as `agents.accounts` ([agent-settings.md](../ongoing/agent-settings.md), `settings_agent_accounts`), so the main agent can also do it with an approval card.
4. **An agent asks for a key it lacks**, in its chat: the runner already knows when a secret its row names is not stored (the prompt tells the agent), and [connector-in-chat.md](../ongoing/connector-in-chat.md)'s `ask_for_account` becomes able to ask for a key, with a card that opens the secure field or, when getting the key is not obvious, a guide ([guided-access.md](../ongoing/guided-access.md)). Done means checked: where the maker has a cheap call to try the key, Ghostaff tries it before the agent goes on.
5. **`org set-secret` stays** as the operator's way (migrations, support), writing the same row and the same secret.

Invariants: the value goes app → engine → vault and nowhere else; the model never reads it (a runner agent gets it as a variable, with the known gap in [architecture.md](../../architecture.md#known-gaps) until the proxy exists); a key pasted into a normal chat is taken out of the message and offered to the vault ([guided-access.md](../ongoing/guided-access.md)); only owners store, replace, remove or assign.

## Decisions (Jaime, 2026-11-27: «sí, las tres»)

1. **Who stores a key** (decided: as guides — owners directly; a member's key waits for an owner's approval before an agent uses it): only owners, or members too with an owner's approval before an agent uses it (as [guided-access.md](../ongoing/guided-access.md) decided for guides)? Recommendation: the same as guides, for one rule across the app.
2. **One key, many agents** (decided: the organisation's key, given per agent): a key is the organisation's and any agent can be given it (Órdago's `correo-gmail` is used by Correo and Finanzas), or one key per agent? Recommendation: the organisation's, given per agent.
3. **Chat agents** (decided: runner agents first; chat agents when a maker needs it): should a chat agent (answering with the model in the engine) be able to use a stored key, through a tool that calls the maker for it without the model seeing the value? Or only runner agents for now? Recommendation: runner agents first; chat agents when a maker needs it.

## Slices

1. The metadata table, Conexiones › Claves (add, replace, remove), and `org set-secret` writing the same row. Checked: Jaime replaces Órdago's `elevenlabs` from his phone on the beta and Productor's next run uses it.
2. Herramientas: give or take a key; the main agent's setting with its approval card.
3. The agent asks for a missing key in its chat; guides write the same kind; the check after storing.

## Slice 1: how it is built (2026-11-27, against `develop` at f8b875c)

**The row.** `public.org_secrets`, one per organisation and name: `name` (the vault's `org-<org>-secret-<name>`), `label` (what a person reads: «Contraseña de info@ordago.club»), `maker` (an id for the logo, optional), `stored_by`/`stored_by_name`/`stored_at` (null while only a member's value waits), `last_used_at`, `status` (`ok`, or `missing` when a run found the row but not the value), and `pending_by`/`pending_by_name`/`pending_at` for a member's value waiting for an owner. Members read their organisation's rows (nothing in them is secret); only the engine and `apps/sync` write, with the service role.

**A member's value** goes to the vault under its own name, `org-<org>-pending-<name>` (never the runner's, so no run reads it), and the row's `pending_*` says so. An owner's «Aprobar» moves it to `org-<org>-secret-<name>` and fills `stored_*` with the member's name; «Rechazar» deletes it (and the row, when nothing was ever stored). A member may also propose a new value for a stored key; the old one keeps working until an owner approves. Only owners remove.

**The order of writes.** Adding claims the name first (the row, unique per organisation), then writes the vault, and deletes the row if the vault fails: writing the vault first could overwrite a value someone else had just stored under the same name. Replacing writes the vault, then the row.

**Last used and health.** The runner already reads each secret an agent names for its run (`secretsAccess`); it then notes, best-effort, `last_used_at` on the ones it got and `status = 'missing'` on rows whose value it did not find.

**A key an agent names but nobody stored** (in `agents.secrets`, no row) shows in Claves as «Falta», with the agents that need it, and opens the secure field with that name, so the agent gets it on its next run.

**The backfill.** A migration cannot know what is in the vault. `org register-secrets --org <slug>` writes the row of each name the organisation's agents use whose value the vault already has (its `createTime` as `stored_at`, «Ghostaff» as who), with `--name/--label/--maker` to give one a better label. No value is read or typed.

### File structure

- `supabase/migrations/<after the newest on develop>_org_secrets.sql`, `supabase/tests/database/org_secrets.test.sql`
- `packages/shared/src/record/agents.ts`: `pendingSecretName`, `secretValueProblem`, `secretNameFromLabel`, `secretLabelFromName`
- `packages/shared/src/models/`: `OrgSecret`; `Agent.secrets`
- `packages/shared/src/services/index.ts`: `listOrgSecrets`, `storeOrgSecret`, `replaceOrgSecret`, `decideOrgSecret`, `removeOrgSecret`; `secrets` in the agent's columns
- `packages/shared/src/orgSecrets.ts`: `keyRows` (the stored keys and the missing ones, each with the agents that use it)
- `apps/engine/src/orgSecrets.ts` (+ test): store, replace, approve/reject, remove; `supabaseOrgSecretStore`
- `apps/engine/src/app.ts`, `server.ts`: `POST /orgs/:org/secrets`, `POST /orgs/:org/secrets/:name`, `POST …/:name/approve|reject`, `DELETE …/:name`
- `apps/engine/src/runner.ts`, `jobsStore.ts`: `RunnerStore.noteSecrets`
- `apps/sync/src/cli.ts`, `secrets.ts` (+ test): `set-secret` writes the row (`--label`, `--maker`); `register-secrets`
- `apps/mobile/components/connections/ConnectionsList.tsx`: the «Claves» section; `apps/mobile/app/(app)/(tabs)/empresa/conexiones/clave.tsx` (+ `components/connections/KeyPage.tsx`): add, replace, approve, remove; «Añadir conexión» gets a «Claves» group
- `docs/architecture.md`: the fourth kind of secret now has a row and a screen

### Tasks

- [ ] pgTAP: the table, its checks and its RLS (members read, nobody writes from the app, another organisation sees nothing)
- [ ] Shared helpers and models, with unit tests
- [ ] Engine `orgSecrets.ts`, test first: owner stores, member's waits, approve, reject, replace, remove, refusals, the value never echoed or logged
- [ ] Engine routes and the runner's `noteSecrets`
- [ ] `org set-secret` writes the row; `org register-secrets`
- [ ] App, Jest first: the Claves section (stored, pending, missing, agents that use each) and the key's page (add, replace, approve/reject, remove naming the agents)
- [ ] Local web check, `pnpm check`, PR, `pnpm pr:land`
- [ ] Beta: `org register-secrets --org ordago` with labels for the four; Claves shows them with their agents
- [ ] Jaime replaces `elevenlabs` from his phone; Productor's next run uses it

## Progress

| Step | Local | Beta |
|---|---|---|
| Code merged and deployed | ⬜ | ⬜ |
| Órdago's four rows backfilled | n/a | ⬜ |
| A key replaced from the phone, next run uses it | ⬜ | ⬜ |

Legend: ⬜ pending · ⏳ in progress · ✅ done · ⚠️ blocked (note inline)
