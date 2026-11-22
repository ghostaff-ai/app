# Several AI accounts per organisation, in an order the owner picks, each with its usage in view

**Priority:** high — Álvaro (2026-11-22): an owner adds as many AI accounts as they like and decides which goes first
**Gate:** none
**Next:** the PR (branch `feat/multiple-ai-accounts`) green and merged, rebased over PR #38 if that lands first; then the engine deployed, and a real second Claude sign-in tried on the beta

Follows [llm-connectors.md](llm-connectors.md), which built one AI account per provider.

## The ask (Álvaro, 2026-11-22)

An owner can add a second AI account after the first, even another sign-in to the same Claude subscription. In Conexiones they pick which goes first, which second, and so on. And each account's usage is easy to see.

## Today

- `public.connections` has `unique (org_id, provider)`: one Claude subscription, one Anthropic key, one Google Cloud project.
- The vault secret is `org-<uuid>-ai-<provider>` (`apps/engine/src/vault.ts`), so a second account would overwrite the first.
- The order is fixed in `chatStore.ts` `aiAccount()`: Google Cloud, then the subscription, then the Anthropic key (only behind the subscription).

## Decisions (Álvaro, 2026-11-22, taking every proposed pick)

1. **The owner sets the order by hand.** A new account goes to the bottom. Google Cloud cards carry a «datos en la UE» tag instead of being forced first.
2. **Failover, not load spreading.** The engine uses #1; it moves to #2 only when #1 fails before writing (limit reached, token revoked, key refused), and so on. A failing account shows «falla» with the reason and is tried again later. Spreading work across accounts may come later.
3. **The same Claude subscription twice is allowed.** Its card says both share one usage limit: a second sign-in is a spare token, not more capacity. The subscription warning also says that pooling several people's subscriptions for one team is further from what Anthropic calls «individual usage».
4. **Reordering with up and down arrows** on each card: easy to tap, the same on the web, simple for Maestro.
5. **Built at once** (Álvaro, 2026-11-22: «go ahead»), alongside PR #38; whichever lands second rebases.

## Usage (Álvaro, 2026-11-22: «see the usage of each account easily»)

Each card in Conexiones → IA shows its usage on its face, no extra tap:

- **Claude subscription:** the two limits Claude Code itself shows, the 5-hour window and the week, as bars with when each renews («Semana 62 % · se renueva el jueves»). Read passively from the `rate_limit_event` lines Claude Code already writes in the `stream-json` we run: `rate_limit_info.unifiedWindows.{five_hour,seven_day}.{utilization,resetsAt,status}` (seen in a real run of Claude Code 2.1.330 on 2026-11-22; parser and fixture in `packages/shared/src/aiUsage.ts`). We do not call Anthropic's private usage endpoint with the token: that would be us using the token outside Claude Code.
- **Anthropic key and Google Cloud:** tokens and an estimated cost this month («Este mes · 1,2 M tokens · ~18 €»), counted by the engine from each reply's `usage` at list price. Marked as an estimate; the real bill is the provider's.
- **All:** replies this month and the last time it answered, so an account that never gets used (because #1 never fails) is visible as such.

Tapping a card opens its detail: usage per day for the last 30 days and per agent.

How it is stored:

- `public.ai_usage`: one row per reply or run, `org_id`, `connection_id`, `agent_id`, time, input and output tokens, estimated cost, outcome (`ok`, `limited`, `failed`). Members read their organisation's rows, only the engine writes (row-level security and a pgTAP test, rule 2).
- `connections.limits` (jsonb): the latest 5-hour and weekly state of a subscription, with when it was read.

## How it works (built 2026-11-22)

- **Database** (`20261122200000_multiple_ai_accounts.sql`): `connections` loses `unique (org_id, provider)`; outside accounts keep one per provider through a generated `account_key` (the engine's upsert targets `org_id,account_key`). New columns `position` (a trigger puts a new AI account last), `label`, `limits`, `status_reason`, `last_used_at`. Owners reorder and rename through `set_ai_order` and `rename_ai_connection` (security definer). `ai_usage`, one row per reply or run, and `ai_usage_daily()` for the app. `agent_runs.connection_id`: which subscription a run worked on. pgTAP: `ai_accounts.test.sql`.
- **Vault**: one secret per connection, `org-<uuid>-ai-<connection id>`. Connections from before keep their `org-<uuid>-ai-<provider>` secret, read as a fallback (`readAiSecret`) and removed with the last account of that provider. No one-off move.
- **Engine**: adding a key, a Google Cloud project or a Claude sign-in always inserts a new connection. `DELETE /connections/ai/:id` (a provider name still works while there is only one of it, for apps from before). The chat tries the accounts in order (`chatStore.ts` `orderAccounts`: the owner's, a subscription at a limit that has not reset moved last; `chat.ts` `writeReply`): the next answers only when one fails before writing a word or running a tool. A failure marks the account `failing` with `limited`, `refused` or `failed`; a busy Claude Code (all slots taken) is not the account's fault and moves on without marking. An agent with tools tries the accounts that have them first (subscriptions have no tools yet). Our runner works on the first subscription in order and reports Claude Code's usage and limits with its run.
- **App**: Conexiones lists the AI accounts numbered, with their usage under the name and up/down arrows for an owner, then «Añadir otra cuenta de IA» with a row per kind. An account's page (`/conexiones/ia/<kind>?id=<id>`) has its name, its limit bars (subscriptions), its last 30 days (uses, tokens, estimated cost, per day and per agent) and «Quitar esta cuenta». «Cambiar la clave» is gone: add the new one and remove the old.

## Steps

- [x] Migration, `ai_usage`, `set_ai_order`, `rename_ai_connection`, pgTAP.
- [x] Vault: one secret per connection, old secrets read as a fallback (no one-off move needed).
- [x] Engine: every connect adds an account; delete by id; failover in order; usage and limits recorded on every reply and runner run. Naming and ordering are database functions the app calls, not engine routes.
- [x] App: the list in order with arrows, «Añadir otra cuenta de IA», name, usage on each row, the account's page.
- [x] Maestro: `create-company.yaml` gets a key and a subscription and moves the key down.
- [ ] Deployed (engine and runner by CI on merge) and the migration on beta.
- [ ] Tried with a real second Claude sign-in on the beta, and the limit bars filled by a real reply.
