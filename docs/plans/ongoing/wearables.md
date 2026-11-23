# Wearables: health data from any band, for the agents and the pages a person asks for

**Priority:** high — Jaime's Whoop subscription ends soon (2026-11-23) and his history must be in Ghostaff before the API stops answering; his own first use of Ghostaff is personal (welcome-and-spaces.md)
**Gate:** none
**Next:** phase 1, task 4: Jaime finishes his Whoop export, exposes `health` on beta's Data API, and the import runs against beta

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

- **Kind A in [connectors.md](connectors.md):** no wearable maker publishes an MCP server, so each is our own app on the maker's platform, our OAuth, our code, like Instagram and TikTok (`apps/engine/src/tiktok.ts` is the closest shape: `OAuthProvider`, `Tool`, `ToolContext`).
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
- After the maker's consent, one screen in the app: «¿Guardamos tu histórico de salud?» with what it means in one line each (we keep a copy in the EU; you can delete it at any time; without it, agents ask the band only when needed; whatever an agent reads is processed by the AI account the space has connected, which may be outside the EU: decision 6). Default **no**. Saying yes creates the account's row in `health.sources` (below), with the consent's timestamp and wording version: history mode is on exactly while that row exists. It can be turned on later from the card. It is a setting in the sense of AGENTS.md rule 6: defined in `packages/shared/src/services/settings.ts`, so Secretaría or the metrics agent can propose turning it on and it runs only once the person approves.

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
- Row-level security on both: readable only by the person whose personal space it is (`health.is_own_space`, since personal spaces take invitations on 2026-11-23: someone invited into your space never reads your health), writable by no one but the engine's service role. pgTAP proves another organisation's member sees nothing.
- Partition by month when the tables grow; nothing else changes. If volume ever outgrows Postgres, `health.*` moves alone.

### Readers

- **Agents:** read-only tools, no approval needed (they change nothing outside Ghostaff): `health_metrics(from, to, metrics[])`, `health_events(kind, from, to)` (sleeps, workouts, with their details), `health_sources()` (which bands, which mode, since when). In history mode they read `health.*`; otherwise they call the maker. Same answer shape either way.
- **Pages and the app:** read `health.*` through `@ghostaff/shared/services` with the person's own session, like every screen. A page needs history mode; without it, the page says so and offers to turn it on.
- **Export:** the person's history downloads as CSV from the card.

### When an agent needs history it doesn't have

If a task needs the past (a trend, «compárame con hace tres meses») and the connection is on demand, the agent opens a decision for the person: «¿Guardo tu histórico de Whoop para poder comparar?». Only the person's answer turns it on.

## Phases

Ordered by Jaime's deadline (2026-11-23: his Whoop subscription ends soon), so storage and his history come before the live connector.

1. **Storage and Jaime's history.** `health.*` with its pgTAP, the Whoop normalisation into `health.metrics`, and an import of the export script's dump (`~/Desktop/whoop-export/data/<date>/*.json`) into Jaime's personal space by hand (a script with the service role, run once per environment). Nothing in the app yet. Done when his whole Whoop history is in beta's `health.*`, before the subscription ends.
2. **Whoop connector, both modes.** The card, OAuth, the consent screen and the setting, the three tools (live and from storage), the backfill with its limiter, the webhook (registered in Whoop's dashboard for beta), the reconcile, delete and CSV export. Jaime's imported source is joined to his connection when he connects (same Whoop `user_id`); if his subscription has ended by then, the import alone is his history. Production gets its own Whoop app (Claude's call): a Whoop app has one webhook address `[unknown: confirm in Whoop's dashboard]`, and one app per environment keeps beta's tests out of production's rate limit.
3. **Scheduled agents get the connected accounts' tools** (Jaime, 2026-11-23: «la gracia es poder setear agentes que corran con scheduler con estos accesos»). Today only chat replies get them (`claudeWriter.ts` serves `AgentTools` to Claude Code through `toolServer.ts`); a scheduled run on our runner (`apps/runner/`) gets only Claude Code's own tools and the record. The runner gets the same per-run MCP server, reached from its Cloud Run job, with the run's organisation fixed by the engine and writes still gated by an owner's approval. It also closes the runner's known gap before anyone but Órdago uses it: the Claude subscription token readable from the agent's environment (ordago-agents-in-ghostaff.md, «Known gap»). Every connector benefits, not only health; Órdago's migrated agents too. Done when Jaime's metrics agent, on a weekly timetable, reads his health tools and writes its report to his record.
4. **Google Health API**, once Jaime has the band: on our Google OAuth (decision 3), Jaime as a test user; the mapping into the same metric names. Then Jaime's agent compares both.
5. **On demand:** Oura, Withings, Polar (open OAuth APIs); Garmin (partner programme approval); Apple Health (HealthKit in the iOS app, a connector of another kind).

Phase 3 depends on nothing here but the record existing for Jaime's personal space; it can run beside phases 1 and 2.

Each phase adds its line to connectors.md's checklist (kind A) and goes through its four steps there.

## Decisions taken in this design

1. **Own connectors, not an aggregator** (Jaime, 2026-11-23).
2. **Personal spaces only** (Claude's call, to confirm): health data is about one person; in a company space every member would read it. A company feature, if ever, needs its own privacy design.
3. **Google Health on which OAuth client** `[open]`: its restricted scopes put a security review on whatever client asks for them. If it shares «Ghostaff Conectores», that review may hold up verification of the other Google cards. Likely a separate client (or project) for Google Health; decide in phase 3.
4. **Default mode «Solo cuando lo pida»** (Claude's recommendation, Jaime asked for the option that scales best): stores nothing unasked, and what does scale (history, pages) is one tap away.
5. **Scheduled agents get connectors in this plan** (Jaime, 2026-11-23), phase 3.
6. **Health data may reach an AI provider outside the EU** (Jaime, 2026-11-23): what an agent reads goes to the space's connected AI account (a Claude subscription, an Anthropic or OpenAI key), as mail or Notion already does; only Vertex AI keeps it in the EU. The storage stays in the EU (invariant 2); the consent screen says the processing may not.

## Open questions

1. Whoop's rate limit, per app or per member (Context). Changes how hard the limiter must be, not the design.
2. Whether Whoop's app review is needed before people other than test members can connect, and how many test members an unreviewed app takes.
3. Where pages built by agents live and how they authenticate (its own plan; this design only needs them to read through the person's session).

## Implementation (phase 1: storage and Jaime's history)

**Goal:** Jaime's whole Whoop history lives in beta's `health.*`, as the maker's records and as daily metrics, before his subscription ends.

**Architecture:** a migration adds the `health` schema (three tables, row-level security, a trigger that keeps it to personal spaces). A pure module in `@ghostaff/shared/health` holds the metric catalogue and turns Whoop's records into daily metrics; the engine reuses it in phase 2. A command of the sync CLI reads the export script's folder and writes it with the service role, idempotently.

**Tech stack:** Supabase Postgres 17 and pgTAP; TypeScript, vitest; `apps/sync` (tsx, supabase-js).

**For agentic workers:** work task by task (superpowers:subagent-driven-development or superpowers:executing-plans), on branch `feat/health-history` in `.claude/worktrees/health-history` (AGENTS.md, Branches), landed with `pnpm pr:land`.

### Global constraints

- Every table has `org_id`, row-level security on, and a pgTAP test proving another organisation's member sees nothing (AGENTS.md rule 2). Only the service role writes `health.*`; members only read.
- `health.sources` rows belong to organisations of kind `personal` only (decision 2).
- A number in `health.metrics` is computed by code from `health.records`, never typed by a model (anti-goal).
- Code and comments in English.
- No secret on the command line or in a file in the repo: the service-role key comes from `apps/sync/.env` (local) or the environment.

### Review focus

1. **Importing the same folder twice** gives the same rows, no duplicates (Task 3 test `import is idempotent`).
2. **A cycle that starts late in the evening** counts for the next day, in the record's own time zone, east or west of UTC (Task 2 tests `cycle day is the wake day` and `negative offset`).
3. **Unscored records and the current, open cycle** are stored but produce no metric (Task 2 test `skips unscored and open`).
4. **Naps** are stored but don't count as the night's sleep (Task 2 test `naps are not the night`).
5. **A company space** can never hold health data, and another organisation's member reads nothing (Task 1 pgTAP).

### Progress

- [x] Tasks 1–3 landed in [#53](https://github.com/ghostaff-ai/app/pull/53) (2026-11-23). Changes from the plan after the final review: records and metrics reference `(source_id, org_id)` together (`sources` has `unique (id, org_id)`), so neither can sit in a space other than its source's; daily metrics are recomputed from every stored record of the source and replaced as a whole through `health.replace_metrics(source, rows jsonb)` (service role only), so a re-import never leaves stale numbers; the body record's id is `body:<YYYY-MM-DD>`, one per export day. An import never deletes records missing from its folder (it may be an older or partial export); deletions come with phase 2's webhooks. A member writing `health.*` gets `42501`. Tried locally with a synthetic 800-day dump, imported twice: same 2,402 records and 15,202 metrics.
- [ ] Task 4: waits on Jaime's real Whoop export (the field mapping is checked against Whoop's v2 docs, not yet against his data).
- Deferred minors: pgTAP writes as `postgres`, not `service_role`; Whoop's `step_count` is not mapped to `steps` yet (the payload keeps it); a duplicated id inside one batch would abort an import (dedupe in `whoopRecords`); exposing `health` on hosted projects is manual (could go into `setup-env.sh` through the Management API, keeping `public` and `graphql_public` in the list); no cycle test where the offset alone moves the day.

### Task 1: The `health` schema

**Files:** create `supabase/migrations/20261124000000_health.sql`, `supabase/tests/database/health.test.sql`; modify `supabase/config.toml` (`[api] schemas` gains `"health"`).

**Produces:**
- `health.sources (id uuid pk default gen_random_uuid(), org_id uuid not null references public.organizations on delete cascade, provider text not null check (provider ~ '^[a-z][a-z0-9]{1,30}$'), external_user_id text not null, connection_id uuid null references public.connections on delete set null, consented_at timestamptz not null, consent_version text not null, created_at timestamptz not null default now(), unique (org_id, provider, external_user_id))`.
- `health.records (id bigint generated always as identity pk, org_id uuid not null, source_id uuid not null references health.sources on delete cascade, provider text not null, kind text not null check (kind in ('cycle','recovery','sleep','workout','body')), external_id text not null, starts_at timestamptz, ends_at timestamptz, payload jsonb not null, updated_at timestamptz not null, unique (source_id, kind, external_id))`, index on `(org_id, kind, starts_at)`.
- `health.metrics (id bigint generated always as identity pk, org_id uuid not null, source_id uuid not null references health.sources on delete cascade, source text not null, day date not null, metric text not null check (metric ~ '^[a-z][a-z0-9_]{1,40}$'), value numeric not null, unit text not null, unique (source_id, day, metric))`, index on `(org_id, metric, day)`.
- A trigger `health.sources_personal_only` (before insert or update) raising `22023` «health data belongs to a personal space» when the organisation's `kind` is not `personal`.
- `grant usage on schema health to authenticated, service_role`; `grant select` on the three tables to `authenticated`; `grant all` to `service_role`. Policies `members read …` using `public.is_member(org_id)` on each table, for select only.

- [ ] **Step 1: Write the pgTAP test** `health.test.sql`, modelled on `refresh_leases.test.sql` (two users, a personal space for Ana, a company and a personal space for Bea). Assertions:
  - as the service role, a source, two records and two metrics insert into Ana's personal space;
  - `throws_ok` inserting a source into the company, code `22023`;
  - a second source with the same `(org_id, provider, external_user_id)` throws `23505`;
  - as Ana (`set local role authenticated`, her claims): she reads her 1 source, 2 records, 2 metrics;
  - as Ana: `insert into health.metrics …` throws `42501`, and `update`/`delete` change 0 rows;
  - as Bea: she reads 0 sources, 0 records, 0 metrics of Ana's;
  - back as the service role: deleting Ana's source leaves 0 records and 0 metrics (cascade).
- [ ] **Step 2: Run** `pnpm db:test`. Expected: `health.test.sql` fails (`schema "health" does not exist`).
- [ ] **Step 3: Write the migration** with what Produces lists, and add `"health"` to `schemas` in `supabase/config.toml`.
- [ ] **Step 4: Run** `pnpm db:start` (restart so the API exposes the schema) and `pnpm db:test`. Expected: every file passes.
- [ ] **Step 5: Commit** `feat(health): health schema for kept health history`.

### Task 2: Metric catalogue and Whoop's daily metrics

**Files:** create `packages/shared/src/health/metrics.ts`, `packages/shared/src/health/whoop.ts`, `packages/shared/src/health/index.ts`, `packages/shared/test/healthWhoop.test.ts`; modify `packages/shared/package.json` (`exports` gains `"./health": "./src/health/index.ts"`).

**Produces** (`@ghostaff/shared/health`):
- `METRICS: Record<MetricName, { unit: string }>` and `type MetricName`, exactly: `strain` (`score`), `energy_kj` (`kJ`), `avg_hr_bpm`, `max_hr_bpm`, `resting_hr_bpm` (`bpm`), `recovery_pct`, `spo2_pct`, `sleep_performance_pct`, `sleep_efficiency_pct`, `sleep_consistency_pct` (`%`), `hrv_ms` (`ms`), `skin_temp_c` (`°C`), `respiratory_rate` (`breaths/min`), `sleep_minutes`, `in_bed_minutes`, `light_sleep_minutes`, `deep_sleep_minutes`, `rem_sleep_minutes`, `awake_minutes`, `workout_minutes` (`min`), `workout_count` (`count`), `weight_kg` (`kg`), `height_m` (`m`).
- `interface HealthRecord { kind: 'cycle'|'recovery'|'sleep'|'workout'|'body'; externalId: string; startsAt: string|null; endsAt: string|null; payload: Record<string, unknown> }`.
- `interface DailyMetric { day: string /* YYYY-MM-DD */; metric: MetricName; value: number; unit: string }`.
- `whoopRecords(dump: WhoopDump): HealthRecord[]` where `WhoopDump = { profile: {user_id: number}; body_measurement: {...} | {}; cycles: unknown[]; recoveries: unknown[]; sleeps: unknown[]; workouts: unknown[]; exportedAt: string }`. External ids: cycle, sleep and workout `id` as a string; recovery its `cycle_id`; body the literal `body` with `startsAt = exportedAt`.
- `whoopDailyMetrics(records: HealthRecord[]): DailyMetric[]`.

The rules the tests pin (Whoop v2 field names as its docs give them; Task 3 checks them against the real dump):
- **Day:** a record's local time is its UTC time shifted by its `timezone_offset` (`"+01:00"`, `"-05:00"`). Cycle → local date of `start + 12 h` (a cycle begins when you fall asleep, so 23:30 Monday is Tuesday's). Sleep → local date of `end`. Recovery → its cycle's day. Workout → local date of `start`. Body → UTC date of `exportedAt`.
- **Only scored:** a record whose `score_state` is not `SCORED`, or a cycle with `end: null`, gives no metric.
- **Cycle:** `strain` ← `score.strain`, `energy_kj` ← `score.kilojoule`, `avg_hr_bpm`, `max_hr_bpm` ← `score.average_heart_rate`, `score.max_heart_rate`.
- **Recovery:** `recovery_pct` ← `score.recovery_score`, `resting_hr_bpm` ← `score.resting_heart_rate`, `hrv_ms` ← `score.hrv_rmssd_milli`, `spo2_pct` ← `score.spo2_percentage`, `skin_temp_c` ← `score.skin_temp_celsius` (each only when present).
- **Sleep:** naps (`nap: true`) give nothing. A day's non-nap sleeps add up: `light_sleep_minutes`, `deep_sleep_minutes` (`total_slow_wave_sleep_time_milli`), `rem_sleep_minutes`, `awake_minutes`, `in_bed_minutes` from `score.stage_summary`, and `sleep_minutes` = light + deep + rem; each ms ÷ 60,000, rounded to the minute. The percentages and `respiratory_rate` come from that day's longest sleep by time in bed.
- **Workouts:** per day, `workout_count` and `workout_minutes` (`end − start`, rounded).
- **Body:** `weight_kg` ← `weight_kilogram`, `height_m` ← `height_meter`.

- [ ] **Step 1: Write the failing tests** in `healthWhoop.test.ts`, with small fixtures built in the file:
  - `cycle day is the wake day`: cycle `start 2026-11-09T22:30:00Z`, offset `+01:00`, scored strain 12.3 → `{ day: '2026-11-10', metric: 'strain', value: 12.3, unit: 'score' }`.
  - `negative offset`: sleep `end 2026-11-10T04:30:00Z`, offset `-05:00` → its metrics on `2026-11-09`.
  - `recovery takes its cycle's day`: recovery with `cycle_id` of the cycle above, `hrv_rmssd_milli` 54.2 → `hrv_ms` 54.2 on `2026-11-10`.
  - `skips unscored and open`: a `PENDING_SCORE` sleep and a scored cycle with `end: null` → no metric; `whoopRecords` still returns both.
  - `naps are not the night`: a night sleep of 7 h asleep and a nap of 30 min the same day → `sleep_minutes` 420.
  - `two night sleeps add up`: 5 h and 2 h on one day → `sleep_minutes` 420, and `sleep_performance_pct` from the longer one.
  - `body is dated by the export`: `{ weight_kilogram: 78.4 }`, `exportedAt 2026-11-23T10:10:10Z` → `weight_kg` 78.4 on `2026-11-23`.
  - `units come from the catalogue`: every metric returned has `unit === METRICS[metric].unit`.
- [ ] **Step 2: Run** `pnpm --filter @ghostaff/shared test -- healthWhoop`. Expected: fails, module not found.
- [ ] **Step 3: Implement** `metrics.ts`, `whoop.ts` and `index.ts` with the signatures above, and the `exports` entry.
- [ ] **Step 4: Run** the same command, then `pnpm check`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(health): metric catalogue and Whoop daily metrics`.

### Task 3: `org import-health`

**Files:** create `apps/sync/src/healthImport.ts`, `apps/sync/test/healthImport.test.ts`; modify `apps/sync/src/cli.ts` (the command, its options `--provider`, `--dir`, the usage comment at the top and the `default:` message).

**Consumes:** Task 1's tables, Task 2's `whoopRecords`, `whoopDailyMetrics`.

**Produces:**
- `readWhoopDump(dir: string): WhoopDump`: reads `profile.json`, `body_measurement.json`, `cycles.json`, `recoveries.json`, `sleeps.json`, `workouts.json` and `summary.json` (`exported_at`, `YYYY-MM-DDTHHMMSSZ` → ISO) from the export script's folder; a missing collection file is an error naming it.
- `importHealth(db: SupabaseClient, opts: { org: string; provider: 'whoop'; dir: string }): Promise<{ records: number; metrics: number }>`: finds the organisation by slug and refuses one whose `kind` is not `personal` («health data goes only into a personal space»); upserts the source (`external_user_id` = `profile.user_id` as text, `connection_id` null, `consented_at` now on first insert only, `consent_version` `'import-v1'`), then records in batches of 500 on `(source_id, kind, external_id)`, then metrics in batches of 500 on `(source_id, day, metric)`, all through `db.schema('health')`. Prints counts per kind and per metric.
- Command: `pnpm --filter @ghostaff/sync org import-health --org <slug> --provider whoop --dir <folder>`.

- [ ] **Step 1: Write the failing tests** in `healthImport.test.ts` (a fake `db` recording calls, as `agents.test.ts` does, and a temp folder with the six files):
  - `reads the export script's folder`: counts of `whoopRecords(readWhoopDump(dir))` match the fixture's.
  - `names a missing file`: without `sleeps.json` → throws mentioning `sleeps.json`.
  - `refuses a company space`: an organisation of kind `company` → throws «personal space», nothing written.
  - `import is idempotent`: upserts use `onConflict` `source_id,kind,external_id` and `source_id,day,metric`, and the source upsert never overwrites `consented_at`.
  - `batches of 500`: 1,203 records → 3 upsert calls.
- [ ] **Step 2: Run** `pnpm --filter @ghostaff/sync test -- healthImport`. Expected: fails, module not found.
- [ ] **Step 3: Implement** `healthImport.ts` and the command in `cli.ts`.
- [ ] **Step 4: Run** the same command, then `pnpm check`. Expected: all pass.
- [ ] **Step 5: Try it locally against Jaime's real dump** (it needs the export finished: `~/Desktop/whoop-export/data/<date>/`). With the local stack up and a personal space for `jaime@ghostaff.local`: run the command twice. Expected: the same counts both times, and `select metric, count(*), min(day), max(day) from health.metrics group by 1` showing his whole range. If a Whoop field name differs from Task 2's, fix the mapping and its test there.
- [ ] **Step 6: Commit** `feat(health): import a Whoop export into a personal space`, then `pnpm pr:land` until it exits 0.

### Task 4: Jaime's history on beta

Not code. Needs the PR landed and Jaime's personal space on beta.

- [ ] **Step 1:** Jaime, in Supabase's dashboard for `ghostaff-beta` (`rggvcvnstbitbdptiwtk`): Project Settings → Data API → Exposed schemas, add `health`. Same for `ghostaff-prod` when production gets this.
- [ ] **Step 2:** `npx supabase link --project-ref rggvcvnstbitbdptiwtk` and `npx supabase db push` (the migration, if CI hasn't applied it).
- [ ] **Step 3:** with beta's service-role key in the environment (from the dashboard, never pasted into a conversation), `pnpm --filter @ghostaff/sync org import-health --org <Jaime's personal slug> --provider whoop --dir ~/Desktop/whoop-export/data/<date>`.
- [ ] **Step 4: Verify** with the SQL of Task 3 step 5 on beta: the same counts as locally. Then tick phase 1 in this file and set **Next** to phase 2.
