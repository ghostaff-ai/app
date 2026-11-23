# Wearables: health data from any band, for the agents and the pages a person asks for

**Priority:** medium — Jaime's own first use of Ghostaff is personal (welcome-and-spaces.md) and he is moving from Whoop to a Google band now; no customer has asked yet
**Gate:** decision:Jaime approves this design
**Next:** Jaime approves or corrects this design; then phase 1 (Whoop, «solo cuando lo pida») gets its implementation plan

Jaime (2026-11-23): he is leaving Whoop for a Google band and wants his whole Whoop history kept, read later next to the new band's. He wants Ghostaff to connect health wearables through their APIs so that a personal agent («mi agente de métricas») can do whatever the person asks with that data: a weekly review of trends, a daily dashboard page, cross it with voice notes. The connector does not decide what is done with the data; the person tells the agent.

## Goal

A person connects their band in Conexiones with one button, and from then on their agents, and pages those agents build, can read their health data in one shape whatever the brand, with the person choosing whether Ghostaff keeps a history or only asks the band when needed.

## Non-goals

- **What the agent does with the data.** A metrics agent is a task, a timetable and tools, written in plain language (`agents.task`, schedule, `tools`); nothing here is specific to it.
- **Hosting the pages agents build.** Where a page an agent made lives and is served is its own feature. This design only guarantees the data can be read by such a page without the agent (Readers, below).
- **Company wellness.** Health data in a company space, seen by colleagues, is out (decision 2).
- **Raw streams.** Second-by-second heart rate or HRV: no wearable API here gives them (Whoop's API gives aggregates only).
- **Advice.** No diagnosis or medical claims in tools or prompts; the agent reports numbers and trends.

## Anti-goals

- Keeping a person's health history they did not ask us to keep.
- A dashboard that breaks when the person's subscription to the band ends.
- The model copying numbers into storage: a number in the history is never written by a model.

## Context

- **Kind A in [connectors.md](../ongoing/connectors.md):** no wearable maker publishes an MCP server, so each is our own app on the maker's platform, our OAuth, our code, like Instagram and TikTok (`apps/engine/src/tiktok.ts` is the closest shape: `OAuthProvider`, `Tool`, `ToolContext`).
- **Whoop:** Developer API v2, OAuth 2 with `offline` for refresh, scopes `read:profile read:body_measurement read:cycles read:recovery read:sleep read:workout`. Collections paged 25 at a time with `nextToken`. Webhooks for `recovery.*`, `sleep.*`, `workout.*` (updated and deleted). Not in the API: the journal and raw streams; those come only from the app's own export (CSV by mail). Our app «Ghostaff» exists since 2026-11-23 (Jaime's Whoop developer account, client ID `ee8b66ab-c4d3-480d-aac1-d05a4ccec312`, three redirect URIs: the export script's `http://localhost:8788/callback`, the local engine and beta's `/connections/oauth/whoop/callback`). Rate limits documented as 100 requests a minute and 10,000 a day `[unknown: per app or per member; the design assumes per app, the safe case]`.
- **Google (Fitbit and Pixel bands):** the Fitbit Web API is replaced by the [Google Health API](https://developers.google.com/health/about) with Google OAuth; the old one is turned off in autumn 2026. **Every Google Health API scope is restricted**: listed test users work, anyone else needs Google's security review.
- **Apple Watch** has no cloud API: HealthKit is read on the phone, by our iOS app. A different kind of connector, not in this design's phases.
- **Personal spaces** are organisations of kind `personal` with one member (`20261122300000_spaces.sql`).
- **Jaime's history today:** a one-off export script (`~/Desktop/whoop-export/whoop_export.py`, outside any repo) dumps the API's six collections to JSON and CSV; he also asked Whoop's app for its CSV export (journal included).

## Approaches considered

1. **An aggregator** (Terra, Junction, Rook…): one integration for dozens of brands, Garmin included. Rejected by Jaime (2026-11-23): health data passes through a third party, usually in the US (invariant 2), a per-user cost, and the approval each platform gives is theirs, not ours.
2. **Only on demand:** never store; the engine asks the band each time. Rejected as the only mode: the history dies with the subscription (Jaime's exact case), a page showing a year asks the band dozens of times on every view and meets the per-app limit as users grow, and every reader has to know each brand's format.
3. **Always sync everything:** a copy of every connected person's data. Rejected as the default: it keeps sensitive data nobody may use (GDPR minimisation; health is a special category, art. 9).
4. **Chosen: our own connectors with two modes the person picks.** «Solo cuando lo pida» (default) stores nothing; «Guardar mi histórico» keeps a synced copy, fed by the band's webhooks, deletable with one button. Same tools either way. It scales on both axes that matter: calls to the maker grow with new data, not with readers (a page never calls the maker), and storage grows only for people who asked for it (about 30 rows a person a day: 10,000 people a year is roughly 100 million rows, a few GB).

## Design

### Connecting

- A card per maker in Conexiones (`packages/shared/src/connectors.ts`), only in a personal space (decision 2). Connecting is the usual flow: one-time state, PKCE where the maker takes it, tokens in the vault, `connections` row with `kind = 'account'`, the account's name and scopes.
- After the maker's consent, one screen in the app: «¿Guardamos tu histórico de salud?» with what it means in one line each (we keep a copy in the EU; you can delete it at any time; without it, agents ask the band only when needed). Default **no**. Saying yes creates the account's row in `health.sources` (below), with the consent's timestamp and wording version: history mode is on exactly while that row exists. It can be turned on later from the card.

### Mode «Solo cuando lo pida» (default)

- The agent's tools call the maker live, through the engine, with the person's token, and return the normalised shape (below). Nothing is written.
- Only agents call the maker live. A page never does (Readers).

### Mode «Guardar mi histórico»

- **Backfill:** turning it on queues the whole history for that connection, paged, behind one limiter per maker shared by every engine instance (the per-app limit is shared by all our users), so a hundred people turning it on at once is slow, not refused.
- **Staying current:** the maker's webhook (`POST /webhooks/<maker>`, signature checked with our app's secret) names the record that changed; the engine fetches that one record and upserts it, or deletes it on a `*.deleted` event. A reconcile on the tick re-reads the last three days of each connection, for webhooks that never arrived. A maker without webhooks is polled by that same reconcile.
- **The band going away:** when the maker stops honouring the token (subscription ended, access revoked), the connection turns `failing` as today, and the stored history stays. Losing the band never deletes data; only the person does.
- **Turning it off is deleting** (Claude's call): the switch is the art. 9 consent, so switching it off withdraws it. The app confirms («Se borrará tu histórico de Whoop») and deletes every stored row of that source; there is no frozen-history state for tools and pages to reason about.
- **Disconnecting** keeps or deletes the history, as the person chooses. Kept history outlives the `connections` row (`disconnectAccount` deletes that row today), which is why storage is keyed by source, not by connection.
- **Importing:** a stored history can also be filled from a file of the maker's own export (Jaime's Whoop dump first), with no live connection needed. Phase 2 imports the export script's JSON for Jaime's space by hand; a general upload is kind C's «subir un archivo». The journal, which only Whoop's app export has (CSV), stays out of Ghostaff for now (Claude's call); Jaime keeps that CSV himself.

### Storage (history mode only)

In the same Supabase Postgres (Frankfurt), its own schema `health`, apart from the app's tables but under the same rules (invariant 1, rule 2 of AGENTS.md):

- `health.sources`: one row per band account whose history is kept. `org_id`, `provider`, `external_user_id` (the maker's id for the person, e.g. Whoop's `user_id`), `connection_id` (nullable: null after a disconnect that kept the history, or for an import with no connection), `consented_at`, `consent_version`; unique `(org_id, provider, external_user_id)`. A second Whoop account in the same space is a second source, never mixed with the first. The rows below hang from `source_id`, so deleting a source deletes its history in one cascade.
- `health.records`: the maker's record as it came. `org_id`, `source_id`, `provider`, `kind` (`cycle`, `recovery`, `sleep`, `workout`, `body`, …), `external_id`, `starts_at`, `ends_at`, `payload jsonb`, `updated_at`; unique `(source_id, kind, external_id)`. Keeping the original means a better normalisation later is a re-run, not a re-download (the band may be gone).
- `health.metrics`: one row per day, metric and source, written only by the engine's code from `records`. `org_id`, `source_id`, `source` (`whoop`, `google`…), `day date`, `metric`, `value numeric`, `unit`; unique `(source_id, day, metric)`. The metric names are ours and shared by every brand (`sleep_minutes`, `hrv_ms`, `resting_hr_bpm`, `recovery_pct`, `strain`, `steps`, `weight_kg`…), each brand mapping what it has; a brand that lacks one simply has no row.
- Row-level security on both: readable by members of the organisation (in a personal space, its one person), writable by no one but the engine's service role. pgTAP proves another organisation's member sees nothing.
- Partition by month when the tables grow; nothing else changes. If volume ever outgrows Postgres, `health.*` moves alone.

### Readers

- **Agents:** read-only tools, no approval needed (they change nothing outside Ghostaff): `health_metrics(from, to, metrics[])`, `health_events(kind, from, to)` (sleeps, workouts, with their details), `health_sources()` (which bands, which mode, since when). In history mode they read `health.*`; otherwise they call the maker. Same answer shape either way.
- **Pages and the app:** read `health.*` through `@ghostaff/shared/services` with the person's own session, like every screen. A page needs history mode; without it, the page says so and offers to turn it on.
- **Export:** the person's history downloads as CSV from the card.

### When an agent needs history it doesn't have

If a task needs the past (a trend, «compárame con hace tres meses») and the connection is on demand, the agent opens a decision for the person: «¿Guardo tu histórico de Whoop para poder comparar?». Only the person's answer turns it on.

## Phases

1. **Whoop, on demand.** The card, OAuth, the three tools calling Whoop live, the normalisation. Proven with Jaime's personal space on the local stack and beta.
2. **Whoop, history.** The consent screen, `health.*` with its pgTAP, the backfill with its limiter, the webhook (registered in Whoop's dashboard for beta), the reconcile, delete and CSV export. Production gets its own Whoop app (Claude's call): a Whoop app has one webhook address `[unknown: confirm in Whoop's dashboard]`, and one app per environment keeps beta's tests out of production's rate limit. Jaime's Whoop dump imported into his space before his subscription ends.
3. **Google Health API**, once Jaime has the band: on our Google OAuth (decision 3), Jaime as a test user; the mapping into the same metric names. Then Jaime's agent compares both.
4. **On demand:** Oura, Withings, Polar (open OAuth APIs); Garmin (partner programme approval); Apple Health (HealthKit in the iOS app, a connector of another kind).

Each phase adds its line to connectors.md's checklist (kind A) and goes through its four steps there.

## Decisions taken in this design

1. **Own connectors, not an aggregator** (Jaime, 2026-11-23).
2. **Personal spaces only** (Claude's call, to confirm): health data is about one person; in a company space every member would read it. A company feature, if ever, needs its own privacy design.
3. **Google Health on which OAuth client** `[open]`: its restricted scopes put a security review on whatever client asks for them. If it shares «Ghostaff Conectores», that review may hold up verification of the other Google cards. Likely a separate client (or project) for Google Health; decide in phase 3.
4. **Default mode «Solo cuando lo pida»** (Claude's recommendation, Jaime asked for the option that scales best): stores nothing unasked, and what does scale (history, pages) is one tap away.

## Open questions

1. Whoop's rate limit, per app or per member (Context). Changes how hard the limiter must be, not the design.
2. Whether Whoop's app review is needed before people other than test members can connect, and how many test members an unreviewed app takes.
3. Where pages built by agents live and how they authenticate (its own plan; this design only needs them to read through the person's session).
