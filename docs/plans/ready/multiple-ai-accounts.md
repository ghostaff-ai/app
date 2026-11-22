# Several AI accounts per organisation, in an order the owner picks, each with its usage in view

**Priority:** high — Álvaro (2026-11-22): an owner adds as many AI accounts as they like and decides which goes first
**Gate:** blocked:PR #38 (fix/claude-signin-resume) merged, since it changes the same files (recheck 2026-11-24)
**Next:** the migration (`position`, `label`, one secret per connection) and the engine trying accounts in order

Follows [llm-connectors.md](../ongoing/llm-connectors.md), which built one AI account per provider.

## The ask (Álvaro, 2026-11-22)

An owner can add a second AI account after the first, even another sign-in to the same Claude subscription. In Conexiones they pick which goes first, which second, and so on. And each account's usage is easy to see.

## Today

- `public.connections` has `unique (org_id, provider)`: one Claude subscription, one Anthropic key, one Google Cloud project.
- The vault secret is `org-<uuid>-ai-<provider>` (`apps/engine/src/vault.ts`), so a second account would overwrite the first.
- The order is fixed in `chatStore.ts` `aiAccount()`: Google Cloud, then the subscription, then the Anthropic key (only behind the subscription).

## Decisions (Álvaro, 2026-11-22, taking every proposed pick; Jaime to confirm, it is a product decision)

1. **The owner sets the order by hand.** A new account goes to the bottom. Google Cloud cards carry a «datos en la UE» tag instead of being forced first.
2. **Failover, not load spreading.** The engine uses #1; it moves to #2 only when #1 fails before writing (limit reached, token revoked, key refused), and so on. A failing account shows «falla» with the reason and is tried again later. Spreading work across accounts may come later.
3. **The same Claude subscription twice is allowed.** Its card says both share one usage limit: a second sign-in is a spare token, not more capacity. The subscription warning also says that pooling several people's subscriptions for one team is further from what Anthropic calls «individual usage».
4. **Reordering with up and down arrows** on each card: easy to tap, the same on the web, simple for Maestro.
5. **Built after PR #38 merges.**

## Usage (Álvaro, 2026-11-22: «see the usage of each account easily»)

Each card in Conexiones → IA shows its usage on its face, no extra tap:

- **Claude subscription:** the two limits Claude Code itself shows, the 5-hour window and the week, as bars with when each renews («Semana 62 % · se renueva el jueves»). Read passively from the `rate_limit_event` lines Claude Code already writes in the `stream-json` we run (`five_hour`, `seven_day`; confirmed in the 2026-11-22 binary, exact fields to pin while building). We do not call Anthropic's private usage endpoint with the token: that would be us using the token outside Claude Code.
- **Anthropic key and Google Cloud:** tokens and an estimated cost this month («Este mes · 1,2 M tokens · ~18 €»), counted by the engine from each reply's `usage` at list price. Marked as an estimate; the real bill is the provider's.
- **All:** replies this month and the last time it answered, so an account that never gets used (because #1 never fails) is visible as such.

Tapping a card opens its detail: usage per day for the last 30 days and per agent.

How it is stored:

- `public.ai_usage`: one row per reply or run, `org_id`, `connection_id`, `agent_id`, time, input and output tokens, estimated cost, outcome (`ok`, `limited`, `failed`). Members read their organisation's rows, only the engine writes (row-level security and a pgTAP test, rule 2).
- `connections.limits` (jsonb): the latest 5-hour and weekly state of a subscription, with when it was read.

## Steps

- [ ] Migration: drop `unique (org_id, provider)`; add `position int`, `label text`, `limits jsonb`; `ai_usage` with its pgTAP test.
- [ ] Vault: one secret per connection, `org-<uuid>-ai-<connection-id>`; move today's secrets over once.
- [ ] Engine: `POST /connections/ai` and the Claude sign-in add a new connection instead of replacing; `PATCH /connections/ai/:id` (label, position); `DELETE` by id. `aiAccounts()` returns the ordered list; the writer tries each in turn. Record usage and subscription limits on every reply and runner run.
- [ ] App: the IA list in order, arrows, «Añadir otra cuenta», editable name, usage on each card, the detail page. Spanish copy.
- [ ] Maestro: add a second account, move it up, see the order change.
