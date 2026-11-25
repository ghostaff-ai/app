# Notifications: an agent's reply and the decisions that wait reach a person without opening the app

**Priority:** high — Telegram is today the only thing that reaches a person outside the app, and it goes off once Órdago's agents run on our runner ([ordago-agents-in-ghostaff.md](ordago-agents-in-ghostaff.md), decision 3)
**Gate:** `blocked:founder — APNs key and Firebase per environment (design part 6)`
**Next:** `Jaime stores the APNs key with scripts/apns-key.mjs and adds Firebase to ghostaff-beta and ghostaff-prod; then check a real reply push on the beta`

**Goal:** When an agent finishes a message in a conversation a person can see and hasn't read, that person's phone says so («Legal · Te ha contestado») within seconds, and a tap opens that chat; once a day at 09:00 their time, if decisions wait for them, one notification says how many, and a tap opens Decisiones. Nothing from the record's words leaves for Apple or Google.

## Why, and why now (Jaime, 2026-11-24)

Telegram tells Órdago's founders when an agent answered, reported, opened a decision or failed. The day it goes off, nothing does. The worst case is a runner agent, which takes minutes to answer: you write, close the app and never learn it replied. Jaime first set this for «before Telegram goes off», then asked the same day to build it now. He chose approach A below («trigger + cola»).

## What exists (`develop`, `ee584cd`, 2026-11-24)

- Nothing sends or receives a notification: no `expo-notifications` in `apps/mobile/package.json`, no push config in `apps/mobile/app.config.ts`, no table for devices, no time zone on `profiles`.
- **Who sees a conversation** is `public.thread_level_for(thread, member)` (`20261124200000_conversation_visibility.sql`): a personal chat (`threads.personal_of`) only its person; a shared conversation by its `visibility` and the member's level on the agent. What an agent does on its own is copied into each person's chat (three-tabs.md decision 12, `20261123300000_no_notices.sql`).
- **Agent messages** are rows of `public.messages` with `author_kind = 'agent'` and `state` `working` → `done` | `failed` (`20261118200000_agent_replies.sql`). The engine closes them from about ten places (`apps/engine/src/chat.ts`, `jobs.ts`, `runner.ts`: a chat reply, a runner's report, a job that died, the hello of a new agent), and SQL functions insert some already `done`.
- **Unread** is `public.thread_reads(thread_id, user_id, read_at)`; the chat screen marks it while open. `my_threads` calls a thread unread when its last message's `created_at` is after `read_at`, but an agent reply is inserted `working` and only filled in later (`finished_at`, set by `updateReply` in `chatStore.ts`): write to a runner agent, see «Trabajando…», close the app, and the reply minutes later already counts as read. Today that hides the unread dot; here it would swallow exactly the push that matters most.
- **Following a shared conversation** is already defined in `my_threads.following`: you opened or started it, you have a read mark on it, you wrote in it, or you were @mentioned.
- **A run that opens decisions says so in the chat**: `reportRun` in `apps/engine/src/jobs.ts` marks it noteworthy and posts «Te he dejado N decisiones…» with each question in the run's chat (or each person's chat for a scheduled run, through `post_to_personal_chats` from `jobsStore.ts`).
- **An OK card runs only once an owner approves it** (`20261119000000_account_connections.sql`).
- **Decisions waiting** for a person: `public.decisions` with `answer is null and closed_at is null` in an organisation they belong to, minus their own `decision_snoozes` whose `until` is in the future; and the OK cards agents put in a chat, `public.agent_actions` with `status = 'pending'`, in threads the person can see.
- **The engine's tick**: Cloud Scheduler calls `POST /cron` every five minutes (`tick()` in `apps/engine/src/server.ts`).
- **cultuvilla's push** works in production and is the code to port (`~/cultuvilla-app`): `functions/src/push/` (`apnsJwt.ts`, `apnsTransport.ts`, `fcmTransport.ts`, `transport.ts`, `deliverPush.ts`) and `apps/mobile/lib/push/` (`pushClient.ts`, `PushProvider.tsx`, `softAskPolicy.ts`).

## Goals, non-goals, anti-goals

- **Goals:** a reply reaches its person outside the app; waiting decisions are recalled once a day; Telegram can go off without anyone losing anything.
- **Non-goals (later, on the same sender):** «vence hoy» pushes, «money leaving», `@Ana` in a chat, web notifications, email, a weekly summary, a settings screen.
- **Anti-goals:** a phone that buzzes for every line of a conversation it is looking at; the text of a message or a decision on Apple's or Google's servers or on a lock screen; a push that fails silently forever.

## Approaches

How the engine learns that an agent message is finished and who to tell:

- **A. A database trigger fills an outbox; the engine drains it** — **chosen (Jaime, 2026-11-24).** When an agent message becomes `done` or `failed`, Postgres writes one row per person to notify. The engine drains the outbox right after it writes a message, and the tick drains it every five minutes as the safety net. Every path that writes agent messages, today's and tomorrow's, is covered without remembering to call anything; who is told is one SQL rule, the one that changes if [group-chat-per-agent.md](../ideas/group-chat-per-agent.md) is decided.
- **B. Call `notify()` from each place that closes a message.** More direct, but ten places today and every new one must remember; a missed path is a reply nobody hears about.
- **C. Only the tick**, scanning unread agent messages every five minutes. Least code, up to five minutes late: too slow for «te ha contestado».

Sending, decided on 2026-11-22 and kept: **straight to Apple (APNs) and Google (FCM) from our engine**, not Expo's push service, which would add a third company with no stated region (invariant 2). Expo documents this route ([sending through FCM and APNs](https://docs.expo.dev/push-notifications/sending-notifications-custom/)).

## Design

### 1. What a person gets

| Kind | When | Title · body | Tap |
|---|---|---|---|
| `reply` | an agent message in a conversation they can see becomes `done`, still unread by them | «Legal» · «Te ha contestado» | the chat: `/chat/<agent>` (or `/conversacion/<id>` for a shared conversation), switching to its organisation |
| `reply` (failed) | same, `failed` | «Legal» · «No ha podido acabar» | same |
| `daily` | 09:00 in the person's time zone, if anything waits | «Órdago» · «3 decisiones te esperan»; several organisations: «Ghostaff» · «5 decisiones te esperan en 2 organizaciones» | Decisiones, in that organisation when there is one |

- **Only names leave**: the agent's and the organisation's, as the 2026-11-22 design allowed the organisation's. Never the message, the question or the card's label.
- **One notification per conversation on the screen**: pushes for the same thread replace each other (`apns-collapse-id` and FCM `collapse_key` set to the thread id), so five messages are one line, the latest.
- **Not while you look**: the app's foreground handler hides a `reply` for the chat on screen.
- **Not when already read**: the sender checks `thread_reads` just before sending, against the message's `finished_at` (its `created_at` when it was inserted finished), never its `created_at` alone (see «What exists»). `my_threads`' unread flag is fixed the same way in this migration, so the dot and the push agree.
- **The daily one is skipped** when nothing waits, and sent once per person and local day.
- **No quiet hours for replies** (my call): Telegram has none today, a reply follows something the person asked, and the phone's own Do Not Disturb exists. The daily one only fires at 09:00.
- **Who, today:** a personal chat's person; in a shared conversation, those who can read it (`thread_level_for <> 'none'`) **and follow it** in `my_threads`' sense (opened, read, wrote or were @mentioned), not everyone with access to the agent (my call, after the builder check: otherwise every reply in every shared thread buzzes every member). The author of the message that started the reply is not special: they get it like anyone who hasn't read it.
- **A decision an agent opens** reaches people through the run's own report in the chat («Te he dejado una decisión…»), which is a `reply` push like any other; no separate push per decision (my call). A decision that appears only through the record sync, with no run behind it, waits for the daily one. Telegram covers the legacy agents until each moves.
- **OK cards count only for owners** in the daily one, since only an owner can approve them; a member's daily count is decisions only.

### 2. Asking permission

Once, after the person sends their **first message to an agent**: a line of ours under it («¿Te aviso cuando te conteste?» · «Sí, avísame» / «Ahora no»), and only on «Sí» the phone's dialog. Never at launch. «Ahora no» asks again after a week, at most three times (cultuvilla's `softAskPolicy`). Someone who already allowed notifications is never asked.

### 3. Database (one migration, `supabase/migrations/<date>_notifications.sql`)

- **`device_tokens`**: `user_id`, `token` (unique), `platform` (`ios`/`android`), `apns_environment` (`production`/`sandbox`, iOS only), `bundle_id`, `time_zone` (IANA), `updated_at`. A device belongs to a person, not to an organisation, like `profiles`, so it has no `org_id`. Row-level security on; a person reads only their own rows; no write policy.
- **`push_outbox`**: `id`, `user_id`, `org_id`, `kind` (`reply`/`daily`), `thread_id`, `message_id`, `agent_id`, `payload jsonb` (title, body, route), `created_at`, `sent_at`, `attempts`, `last_error`; unique `(user_id, message_id)` for replies and `(user_id, kind, local_day)` for the daily one. Row-level security on with **no policy**: only the engine's service role touches it.
- **The trigger** `messages_notify` on `public.messages`, after insert or update of `state`: when `author_kind = 'agent'` and the row becomes `done` or `failed` (inserted so, or from `working`), insert one `reply` row for each recipient of part 1 (the personal chat's person; a shared conversation's followers who can read it) with at least one device. The «follows» rule moves out of `my_threads` into one function both use. Security definer, `search_path = ''`.
- **`my_threads`**: its unread flag compares `read_at` with `coalesce(finished_at, created_at)` of the last message.
- **Functions** (security definer, checking `auth.uid()`): `register_device(token, platform, apns_environment, bundle_id, time_zone)` (a token held by someone else moves to the caller: the phone changed hands), `forget_device(token)` (on sign-out). Both classified `never` in `packages/shared/src/services/settings.ts` (AGENTS.md rule 6): a person's own phone is not an organisation setting an agent may propose; unclassified, `apps/engine/test/settings.test.ts` fails.
- **pgTAP**, `supabase/tests/database/notifications.test.sql`: a reply in a personal chat queues only its person; a shared `read` conversation queues its followers who can read it, not a reader who never opened it, and nobody with `none`; a reply that finishes after the person's read mark is still unread; a `working` message, a person's message and a second update of a `done` message queue nothing; nobody reads `push_outbox` from the app; another person cannot read, move or delete my device; the functions refuse an anonymous caller.

### 4. The engine

- **`apps/engine/src/push/`**, ported from cultuvilla: `transport.ts` (the port: `send(device, push) → delivered | dead | retry`), `apns.ts` (HTTP/2, provider token signed with the `.p8`, cached 50 minutes), `fcm.ts` (FCM v1 with the engine's own service account).
- **`drainOutbox()`**: claims unsent rows (`for update skip locked`), drops a `reply` whose thread the person has read since, sends to each of the person's devices, marks `sent_at`; `dead` deletes the token; `retry` bumps `attempts` and leaves it for the next drain, giving up after five with `last_error` kept.
- **When it runs**: after each write of an agent message by the engine (in `chatStore.ts`, and after `post_to_personal_chats` in `jobsStore.ts`, fire and forget) and in every `tick()`. Missing the first is harmless: the tick sends it within five minutes.
- **`planDaily(now, people, waiting, sent)`**, pure: who is at 09:00 local in this tick's window and has something waiting; the tick writes those as `daily` rows and the drain sends them.
- **Off until configured**, like the connectors: without the APNs key and the Firebase project the drain leaves the outbox alone and the tick logs it once.

### 5. The app (`apps/mobile/lib/push/`)

- `expo-notifications` with its config plugin. `pushClient.ts` is the only file that imports it (permission, Android channel, native token from `getDevicePushTokenAsync`, foreground handler, tap); `pushClient.web.ts` answers «unsupported».
- `PushProvider` under `ActiveOrgProvider`: registers the device after sign-in through `@ghostaff/shared/services` (rule 1), routes a tap (switching organisation), knows which chat is on screen for the foreground handler.
- The soft ask in `chat/[agent].tsx` after the first message.
- `AuthContext.tsx` calls `forget_device` before signing out.
- Android: one `google-services.json` per package, committed (it holds no secret), wired in `app.config.ts` only when present.
- Adding a native module changes the fingerprint, so the first push to `develop` starts a new beta build by itself; people on the old build simply get nothing until they update.

### 6. What only a founder does

- **An APNs key** on team `8HWS4483VD` (team-scoped, Sandbox & Production), put into Secret Manager of `ghostaff-beta` and `ghostaff-prod` under the same name by a script (never pasted). The push key `54D676WU4J` of Órdago's app serves if its file is still at hand.
- **Firebase** on `ghostaff-beta` (packages `ai.ghostaff.app.beta`, `.dev`) and `ghostaff-prod` (`ai.ghostaff.app`), and their `google-services.json`.
- The Push Notifications capability on the three iOS App IDs (EAS adds it on the next build when the entitlement appears; checked then).
- Before the store: «Device or other IDs» in Play Data Safety and the device token in the privacy text.

## Left to the builder

- The exact SQL for the recipients and the claim query, the payload's shape, how the daily window is computed inside a five-minute tick, the soft ask's look within the chat's existing components.

## Testing

- **vitest**: `planDaily` with a fixed clock (two time zones, the day rolling over, nothing waiting, snoozed decisions, pending cards counted, sent once); `drainOutbox` with an in-memory transport (read since → skipped, dead → token deleted, retry → not marked sent, gives up after five); APNs JWT and FCM request shapes as cultuvilla tests them, no network.
- **pgTAP** as in part 3.
- **Jest**: `PushProvider` with `pushClient` mocked (registers after sign-in, a tap routes and switches organisation, the foreground handler hides the open chat's push); the soft ask's policy.
- **Maestro**: the soft ask declined in a chat. Real delivery is checked once by hand on the beta, since the CI emulator receives nothing.

## Paths

- `supabase/migrations/<date>_notifications.sql`, `supabase/tests/database/notifications.test.sql` (new)
- `packages/shared/src/services/` (devices), `packages/shared/src/models/`
- `apps/engine/src/push/` (new), `apps/engine/src/notify.ts` (new: drain and daily), `apps/engine/src/chatStore.ts`, `apps/engine/src/server.ts`, `apps/engine/test/` (new tests)
- `scripts/deploy-engine.sh`, `scripts/env.sh` (Firebase project per environment), `scripts/apns-key.mjs` (new)
- `apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/app.config.ts`, `apps/mobile/google-services/` (new)
- `apps/mobile/lib/push/` (new), `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(app)/chat/[agent].tsx`, `apps/mobile/lib/auth/AuthContext.tsx`, `apps/mobile/__tests__/`
- `.maestro/flows/ci/` (the soft ask)
- `packages/shared/src/services/settings.ts` (classify the two functions)
- `docs/architecture.md` (the push path), `README.md` (the Firebase files and the APNs secret), `docs/plans/ongoing/app-design.md` (decision 14 replaced, below) and `team-chat.md` (its «own plan» line points here)

## What it replaces

[app-design.md](app-design.md) decision 14 («one a day at the person's hour, plus a push only for a decision due today or money leaving») is replaced on Jaime's word (2026-11-24, he asked for a notification when an agent writes in the chat): a push per agent reply, collapsed per conversation, plus the daily one. «Due today» and «money leaving» stay as later kinds on the same sender.

## Picks in this design that Jaime can change

The two kinds and their wording; names but never text in a push; one push per thread, replacing; no quiet hours for replies; 09:00 in the phone's time zone with no settings screen (the phone's settings turn it off; a screen would need Secretaría to change it too, AGENTS.md rule 6); the ask after the first message to an agent; who is told following today's conversation model, followers only in a shared one; no push per decision beyond the run's report; OK cards in the daily count for owners only.

---

## Progress

Tasks 1 to 6 are built on `feat/notifications` (task 7, these documents, lands with them):

- `284a167` feat(db): device tokens, push outbox and the trigger that fills it
- `8c59ccc` fix(db): whole-name mentions, and leave a claimed push to its drain
- `dce0f91` feat(engine): add push transports for apns and fcm, ported from cultuvilla
- `3d76aae` feat(engine): drain the push outbox and plan the daily one
- `6e63ce4` fix(engine): time out and settle stalled apns http2 requests
- `f5d3375` feat(engine): send pushes after agent writes and on every tick
- `6903209` fix(db): close replies over an hour old as stale instead of sending a backlog
- `48ba1b7` fix(engine): send a request's pushes before it answers, and close rows before pruning
- `47564c8` fix(engine): cap a request's wait for its pushes at 3 s, and time out fcm calls
- `8c05617` feat(mobile): receive pushes and open what they point at
- `43406d1` fix(mobile): open a tapped push from the app layout, and bound sign-out's forget
- `f6ddb8f` feat(mobile): ask once, after the first message, before the phone's dialog

**Not verified.** No push has reached a real device yet: it needs the APNs key and Firebase (Gate). The Maestro flow `push-ask.yaml` first runs in CI.

# Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the design above, built on branch `feat/notifications` in its own worktree, landed with `pnpm pr:land`.

**Architecture:** a Postgres trigger on `messages` queues one `push_outbox` row per recipient; the engine drains the outbox (right after it writes an agent message, and on every tick), sending straight to APNs (HTTP/2, `.p8` JWT) and FCM v1 (Google auth from the engine's service account); the tick also queues the daily one from a pure planner. The app registers its native token and routes taps.

**Tech stack:** Supabase Postgres + pgTAP; engine on Node 22 (Hono, vitest, `google-auth-library`, `node:http2`); Expo SDK 58 with `expo-notifications`, jest-expo, Maestro.

**Spec:** the design above, in this same file.

## Global constraints

- Code and comments in English; every word a person sees in Spanish (AGENTS.md rule 5).
- Screens never call Supabase: data through `@ghostaff/shared/services` (rule 1). The app writes only through `security definer` functions (rule 2).
- Every new database function classified in `DATABASE_FUNCTIONS` (`packages/shared/src/services/settings.ts`), or `apps/engine/test/settings.test.ts` fails (rule 6).
- No Expo push service. No message, question or card text in any payload: only the agent's and the organisation's names.
- `pushClient.ts` is the only file that imports `expo-notifications`.
- Secrets only in Secret Manager; nothing pasted, nothing committed. `google-services.json` is committed (no secret in it).
- Commit headers ≤ 100 characters (commitlint).

## Review focus

1. **A reply finished after the person's read mark** (write, see «Trabajando…», close the app) must push and show unread. Test in Task 1 (pgTAP) and Task 3 (drain skips only when `read_at >= finished_at`).
2. **Two drains at once** (the post-write drain and the tick) must not send twice. Test in Task 1 (`claim_pushes` claims a row once) and Task 3.
3. **A token that moved to another person** (phone changed hands, or signed in as someone else) must stop receiving the first person's pushes. Test in Task 1 (`register_device` moves the row).
4. **A transient APNs/FCM failure** must not delete a token; only the dead reasons do. Test in Task 2.
5. **The engine without the APNs key or the Firebase project** must leave the outbox untouched and keep ticking. Test in Task 4.

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261125500000_notifications.sql` (new) | `device_tokens`, `push_outbox`, `follows_thread`, the trigger, the unread fix in `my_threads`, `register_device`, `forget_device`, `claim_pushes`, `daily_push_candidates` |
| `supabase/tests/database/notifications.test.sql` (new) | pgTAP for all of it |
| `packages/shared/src/services/settings.ts` | classify the new functions |
| `packages/shared/src/services/index.ts`, `packages/shared/src/models/index.ts` | `registerDevice`, `forgetDevice`, `DevicePlatform`, `PushData` |
| `apps/engine/src/push/transport.ts` (new) | the port and its types |
| `apps/engine/src/push/apns.ts` (new) | JWT, HTTP/2 request, outcome per device |
| `apps/engine/src/push/fcm.ts` (new) | FCM v1 request, outcome per device |
| `apps/engine/src/notify.ts` (new) | `drainOutbox`, `planDaily`, the Supabase outbox store |
| `apps/engine/src/server.ts`, `chatStore.ts`, `jobsStore.ts` | wiring: drain after writes and on tick; queue the daily one |
| `scripts/deploy-engine.sh`, `scripts/env.sh`, `scripts/apns-key.mjs` (new) | config per environment; the key into Secret Manager |
| `apps/mobile/lib/push/pushClient.ts`, `pushClient.web.ts`, `PushProvider.tsx`, `softAsk.ts` (new) | device token, foreground handler, taps, the ask's policy |
| `apps/mobile/app/_layout.tsx`, `app/(app)/chat/[agent].tsx`, `lib/auth/AuthContext.tsx`, `app.config.ts`, `package.json`, `google-services/` | wiring |

---

### Task 1: Database

**Files:** Create `supabase/migrations/20261125500000_notifications.sql` (pick the next free timestamp after the latest migration on `develop` at build time), `supabase/tests/database/notifications.test.sql`. Modify `packages/shared/src/services/settings.ts`.

**Interfaces — produces:**
- `public.device_tokens(user_id uuid, token text unique, platform text check in ('ios','android'), apns_environment text null check in ('production','sandbox'), bundle_id text, time_zone text, updated_at timestamptz)`; RLS on, select own rows only, no write grants.
- `public.push_outbox(id uuid pk, user_id uuid, org_id uuid null, kind text check in ('reply','daily'), thread_id uuid null, message_id uuid null, local_day date null, title text, body text, data jsonb, collapse_id text null, created_at, claimed_at timestamptz null, sent_at timestamptz null, outcome text null check in ('sent','read','no_device','gave_up'), attempts int default 0, last_error text null)`; unique `(user_id, message_id) where kind = 'reply'`, unique `(user_id, local_day) where kind = 'daily'`; RLS on, no policy, no grants to `anon`/`authenticated`.
- `public.follows_thread(target_thread uuid, member uuid) returns boolean` — personal chat of `member`, or created by them, or a `thread_reads` row, or a message by them, or an @mention of their `display_name` (the rule now inline in `my_threads`; `my_threads` calls it).
- `my_threads`: `unread` compares `read_at` with `coalesce(lm.finished_at, lm.created_at)`.
- Trigger `messages_notify` (after insert or update of `state` on `public.messages`): for `author_kind = 'agent'`, new `state in ('done','failed')`, and (`tg_op = 'INSERT'` or old `state = 'working'`): insert per recipient with a device — personal chat: `personal_of`; shared: members with `thread_level_for(thread, m) <> 'none' and follows_thread(thread, m)`. `title` = `author_name`; `body` = `'Te ha contestado'` or `'No ha podido acabar'`; `data` = `{"kind":"reply","orgId":…,"route":"/chat/<agent_id>"}` for a personal chat, `"/conversacion/<thread_id>"` for a shared one; `collapse_id` = thread id. `on conflict do nothing`.
- `register_device(token text, platform text, apns_environment text, bundle_id text, time_zone text) returns void` — authenticated; upsert on `token`, setting `user_id = auth.uid()`.
- `forget_device(token text) returns void` — deletes the caller's row only.
- `claim_pushes(max_rows int) returns setof push_outbox` — service role only. Marks `outcome = 'read'`, `sent_at = now()` on unsent `reply` rows whose person's `read_at >= coalesce(finished_at, created_at)` of the message; then claims (`for update skip locked`) unsent rows with `claimed_at is null or claimed_at < now() - interval '2 minutes'`, sets `claimed_at = now()`, returns them.
- `daily_push_candidates() returns table (user_id uuid, time_zone text, org_id uuid, org_name text, waiting int)` — service role only; one row per person with a device and organisation with `waiting > 0`. `waiting` = open decisions (`answer is null and closed_at is null`) not snoozed by them (`until > now()`), plus, for owners, `agent_actions` with `status = 'pending'` in threads where `thread_level_for(thread, person) <> 'none'`. `time_zone` from their most recently updated device.
- `DATABASE_FUNCTIONS`: `register_device`, `forget_device`: `{ reach: 'never', why: "a person's own phone, not the organisation's" }`; `follows_thread`, `claim_pushes`, `daily_push_candidates`, `messages_notify`: `{ reach: 'not_a_setting' }`.

- [ ] **Step 1: Write the pgTAP tests** (`notifications.test.sql`, seeded like `personal_chats.test.sql`): a `working` agent message queues nothing; updating it to `done` queues one row for the chat's person and none for another member; updating `done` → `done` again queues nothing; an agent message inserted `done` in a personal chat queues one; a person's message queues nothing; a shared `read` conversation queues a follower who can read it and not a member who never opened it, nor a member with `none`; a member without a device gets no row; `claim_pushes` returns a row once and a second call returns nothing; a reply whose message finished after the person's `read_at` is claimed, one finished before is marked `read`; `my_threads.unread` is true for a reply finished after `read_at`; `register_device` with another person's token moves it to the caller; `forget_device` cannot delete someone else's row; an authenticated user cannot select `push_outbox` nor call `claim_pushes`/`daily_push_candidates`; anon cannot call `register_device`; `daily_push_candidates` counts a member's open decisions, skips a snoozed one, counts pending cards for an owner only.
- [ ] **Step 2: Run** `pnpm db:test`. Expected: FAIL (relations missing).
- [ ] **Step 3: Write the migration** with the interfaces above; classify the functions in `settings.ts`.
- [ ] **Step 4: Run** `pnpm db:test` and `pnpm check`. Expected: PASS, `settings.test.ts` included.
- [ ] **Step 5: Commit** `feat(db): device tokens, push outbox and the trigger that fills it`.

### Task 2: The transports

**Files:** Create `apps/engine/src/push/transport.ts`, `apns.ts`, `fcm.ts`; tests `apps/engine/test/apns.test.ts`, `fcm.test.ts`. Port from `~/cultuvilla-app/functions/src/push/` (`apnsJwt.ts`, `apnsTransport.ts`, `fcmTransport.ts`), without `firebase-functions` or `firebase-admin`.

**Interfaces — produces:**
```ts
export interface Device { token: string; platform: 'ios' | 'android'; apnsEnvironment: 'production' | 'sandbox' | null; bundleId: string }
export interface Push { title: string; body: string; data: Record<string, string>; collapseId: string | null }
export type Outcome = 'delivered' | 'dead' | 'retry';
export interface PushTransport { send(device: Device, push: Push): Promise<Outcome> }
// apns.ts
export interface ApnsCredentials { teamId: string; keyId: string; privateKey: string }
export function parseApnsSecret(raw: string): ApnsCredentials | null;
export function apnsTransport(creds: ApnsCredentials, opts?: { request?: ApnsRequest; now?: () => Date }): PushTransport;
// fcm.ts
export function fcmTransport(projectId: string, opts?: { accessToken?: () => Promise<string>; fetch?: typeof fetch }): PushTransport;
// one transport per platform
export function byPlatform(ios: PushTransport | null, android: PushTransport | null): PushTransport;
```
- APNs: `POST /3/device/<token>` to `api.push.apple.com` or `api.sandbox.push.apple.com` by `apnsEnvironment`; headers `apns-topic: <bundleId>`, `apns-push-type: alert`, `apns-priority: 10`, `apns-collapse-id` when set, `authorization: bearer <jwt>`; JWT ES256 `{alg, kid}` / `{iss: teamId, iat}`, cached 50 minutes. `410`, or `400` with `BadDeviceToken` / `DeviceTokenNotForTopic`, → `dead`; `429`, `5xx`, network errors → `retry`; `200` → `delivered`. `ApnsRequest` is the injectable `(host, path, headers, body) => Promise<{status, body}>` over `node:http2`.
- FCM: `POST https://fcm.googleapis.com/v1/projects/<id>/messages:send` with `{message: {token, notification: {title, body}, data, android: {priority: 'high', collapse_key, notification: {channel_id: 'default'}}}}`; access token from `google-auth-library` with scope `https://www.googleapis.com/auth/firebase.messaging`. `404` or `400` with `UNREGISTERED`/`INVALID_ARGUMENT` on the token → `dead`; `429`, `5xx` → `retry`.
- `byPlatform` returns `retry` for a platform whose transport is null.

- [ ] **Step 1: Write the tests**: the JWT's header and claims decode to `{alg:'ES256',kid}` / `{iss,iat}` and verify with the test key's public half; the JWT is reused within 50 minutes and remade after; APNs request path, host per environment and headers (collapse id present only when set); `410` → `dead`, `503` → `retry`, `200` → `delivered`; FCM body shape, `404` → `dead`, `500` → `retry`; `parseApnsSecret` rejects missing fields. No network.
- [ ] **Step 2: Run** `pnpm --filter @ghostaff/engine test -- apns fcm`. Expected: FAIL.
- [ ] **Step 3: Implement** the three files.
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): APNs and FCM transports, ported from cultuvilla`.

### Task 3: Drain and daily planner

**Files:** Create `apps/engine/src/notify.ts`, `apps/engine/test/notify.test.ts`.

**Interfaces — consumes** Task 1's tables and functions, Task 2's `PushTransport`, `Device`, `Push`. **Produces:**
```ts
export interface OutboxRow { id: string; userId: string; orgId: string | null; kind: 'reply' | 'daily'; title: string; body: string; data: Record<string, string>; collapseId: string | null; attempts: number }
export interface Candidate { userId: string; timeZone: string; orgId: string; orgName: string; waiting: number }
export interface DailyRow { userId: string; localDay: string; orgId: string | null; title: string; body: string; data: Record<string, string> }
export interface OutboxStore {
  claim(max: number): Promise<OutboxRow[]>;
  devicesOf(userId: string): Promise<Device[]>;
  finish(id: string, outcome: 'sent' | 'no_device' | 'gave_up', error?: string): Promise<void>;
  retryLater(id: string, error: string): Promise<void>;        // attempts + 1, claimed_at = null
  forgetToken(token: string): Promise<void>;
  dailyCandidates(): Promise<Candidate[]>;
  queueDaily(rows: DailyRow[]): Promise<void>;                 // insert … on conflict do nothing
}
export function supabaseOutboxStore(admin: SupabaseClient): OutboxStore;
export async function drainOutbox(store: OutboxStore, transport: PushTransport, opts?: { max?: number }): Promise<{ sent: number; skipped: number; retried: number }>;
export function planDaily(now: Date, candidates: Candidate[]): DailyRow[];
export const MAX_ATTEMPTS = 5;
```
- `drainOutbox`: claims up to `max` (default 100); for each row, sends to every device of the person; any `delivered` → `finish('sent')`; no devices → `finish('no_device')`; each `dead` → `forgetToken`; otherwise `retryLater`, and `finish('gave_up')` once `attempts + 1 >= MAX_ATTEMPTS`.
- `planDaily`: groups candidates per person; a person is due when their local time (from `timeZone`, falling back to `Europe/Madrid` when invalid) is between 09:00 and 11:59; `localDay` is that local date. One organisation: title its name, body `'1 decisión te espera'` / `'N decisiones te esperan'`, `data` `{kind:'daily', orgId, route:'/decisiones'}`. Several: title `'Ghostaff'`, body `'N decisiones te esperan en M organizaciones'`, `orgId` null, `data` without `orgId`.

- [ ] **Step 1: Write the tests** with an in-memory `OutboxStore` and a scripted transport: delivered → `sent`; no devices → `no_device`; one device `dead` and another `delivered` → token forgotten, row `sent`; all `retry` → `retryLater`; the fifth failure → `gave_up`. `planDaily` with a fixed clock: 08:59 Madrid → nothing; 09:00 Madrid → one row with Madrid's date; the same instant is 03:00 in `America/New_York` → nothing for that person; 12:00 → nothing; two organisations → one row with the summed count and «en 2 organizaciones»; 1 → singular copy; invalid time zone → Madrid.
- [ ] **Step 2: Run** `pnpm --filter @ghostaff/engine test -- notify`. Expected: FAIL.
- [ ] **Step 3: Implement** `notify.ts`, including `supabaseOutboxStore` (RPCs `claim_pushes`, `daily_push_candidates`; direct updates with the service role).
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): drain the push outbox and plan the daily one`.

### Task 4: Wiring and configuration

**Files:** Modify `apps/engine/src/server.ts`, `apps/engine/src/chatStore.ts`, `apps/engine/src/jobsStore.ts`, `scripts/deploy-engine.sh`, `scripts/env.sh`; create `scripts/apns-key.mjs`; test `apps/engine/test/notify.test.ts` (wiring cases).

**Interfaces — consumes** Task 3. **Produces:**
- `export function pushFromEnv(env: NodeJS.ProcessEnv): PushTransport | null` in `notify.ts`: `APNS_AUTH_KEY` (JSON `{teamId, keyId, privateKey}`) → APNs; `FIREBASE_PROJECT` → FCM; neither → `null`, logged once at start (`push off: no APNS_AUTH_KEY and no FIREBASE_PROJECT`).
- `tick()` gains, after `startScheduled`: when push is on, `queueDaily(planDaily(new Date(), await dailyCandidates()))` then `drainOutbox`; its result adds `pushes: {sent, skipped, retried}` or `pushes: 'off'`. A failure there is caught and logged; it never fails the tick.
- `supabaseChatStore(admin, { afterAgentWrite?: () => void })` and the jobs store: call `afterAgentWrite` after `updateReply` with a final state and after `post_to_personal_chats`; `server.ts` passes a debounced (`500 ms`) fire-and-forget `drainOutbox`.
- `scripts/env.sh`: `FIREBASE_PROJECT` per environment (`ghostaff-beta`, `ghostaff-prod`). `deploy-engine.sh`: `connector Push FIREBASE_PROJECT "$FIREBASE_PROJECT" APNS_AUTH_KEY apns-auth-key`.
- `scripts/apns-key.mjs <env> <path-to-.p8> <keyId> <teamId>`: writes `{teamId,keyId,privateKey}` as a new version of secret `apns-auth-key` in that environment's project via `gcloud secrets`, reading the file itself; never prints the key.

- [ ] **Step 1: Write the tests**: `pushFromEnv` returns `null` with neither variable and does not throw with a malformed `APNS_AUTH_KEY` (returns Android only, logs); with push off the tick result has `pushes: 'off'` and the store's `claim` is never called; a throwing `dailyCandidates` is logged and the tick still returns.
- [ ] **Step 2: Run** `pnpm --filter @ghostaff/engine test -- notify`. Expected: FAIL.
- [ ] **Step 3: Implement** the wiring and scripts; run `bash -n scripts/deploy-engine.sh`.
- [ ] **Step 4: Run** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(engine): send pushes after agent writes and on every tick`.

### Task 5: The app receives

**Files:** Modify `apps/mobile/package.json` (`npx expo install expo-notifications`), `pnpm-lock.yaml`, `apps/mobile/app.config.ts`, `apps/mobile/app/_layout.tsx`, `apps/mobile/lib/auth/AuthContext.tsx`, `packages/shared/src/services/index.ts`, `packages/shared/src/models/index.ts`. Create `apps/mobile/lib/push/pushClient.ts`, `pushClient.web.ts`, `PushProvider.tsx`, `apps/mobile/google-services/README.md`, `apps/mobile/__tests__/PushProvider.test.tsx`.

**Interfaces — consumes** Task 1's `register_device`, `forget_device`. **Produces:**
```ts
// shared
export type DevicePlatform = 'ios' | 'android';
export interface PushData { kind: 'reply' | 'daily'; orgId?: string; route: string }
export async function registerDevice(client, d: { token: string; platform: DevicePlatform; apnsEnvironment: 'production' | 'sandbox' | null; bundleId: string; timeZone: string }): Promise<void>;
export async function forgetDevice(client, token: string): Promise<void>;
// pushClient.ts
export type Permission = 'granted' | 'denied' | 'undetermined' | 'unsupported';
export function permission(): Promise<Permission>;
export function requestPermission(): Promise<Permission>;
export function deviceToken(): Promise<{ token: string; platform: DevicePlatform; apnsEnvironment: 'production' | 'sandbox' | null; bundleId: string } | null>;
export function onTap(cb: (data: PushData) => void): () => void;      // includes the tap that cold-started the app
export function setForegroundFilter(hide: (data: PushData) => boolean): void;
// PushProvider.tsx
export function PushProvider({ children }): JSX.Element;
export function usePush(): { permission: Permission; ask(): Promise<Permission>; setOnScreen(route: string | null): void };
```
- `apnsEnvironment`: `sandbox` for `APP_ENV=dev`, `production` otherwise. Android channel `default`, importance high, created once.
- `PushProvider` sits inside `ActiveOrgProvider` in `_layout.tsx`. When signed in and permission is `granted`, registers the token (once per session and token). A tap: `choose(orgId)` when present and different, then `router.push(route)`. The foreground filter hides a `reply` whose `route` equals the route on screen.
- `AuthContext.signOut` calls `forgetDevice` with the current token before `supabase.auth.signOut()`, ignoring its error.
- `app.config.ts`: the `expo-notifications` plugin; `android.googleServicesFile` = `./google-services/<env>.json` only when that file exists. `google-services/README.md` says which Firebase project each file comes from.

- [ ] **Step 1: Write the tests** (`pushClient` mocked): registers after sign-in when granted, not when undetermined; a tap with another organisation's id calls `choose` then pushes the route; the filter hides a `reply` for the route on screen and shows one for another chat; sign-out calls `forgetDevice`.
- [ ] **Step 2: Run** `pnpm --filter mobile test -- PushProvider`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): receive pushes and open what they point at`.

### Task 6: Asking, in the chat

**Files:** Create `apps/mobile/lib/push/softAsk.ts`, `apps/mobile/__tests__/softAsk.test.ts`, `.maestro/flows/ci/push-ask.yaml`. Modify `apps/mobile/app/(app)/chat/[agent].tsx`.

**Interfaces — consumes** `usePush()`. **Produces:**
```ts
export interface AskState { declines: number; lastDeclinedAt: string | null }
export function shouldAsk(p: Permission, s: AskState, now: Date): boolean; // undetermined, declines < 3, a week since the last
export function loadAskState(): Promise<AskState>;                        // AsyncStorage key 'ghostaff.pushAsk'
export function saveDecline(now: Date): Promise<void>;
```
- After the person's first message in the chat in this session, if `shouldAsk`: a line under it in the chat's quiet style, «¿Te aviso cuando te conteste?», with «Sí, avísame» (calls `ask()`) and «Ahora no» (calls `saveDecline`). It goes away after either, and never shows on the web (`permission` is `unsupported`).

- [ ] **Step 1: Write the tests**: `shouldAsk` false when granted, denied or unsupported; true when undetermined with no declines; false 6 days after a decline, true after 7; false after the third decline.
- [ ] **Step 2: Run** `pnpm --filter mobile test -- softAsk`. Expected: FAIL.
- [ ] **Step 3: Implement**, and the Maestro flow: send a message to Secretaría, see «¿Te aviso cuando te conteste?», tap «Ahora no», see it go.
- [ ] **Step 4: Run** `pnpm check` and `pnpm e2e`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(mobile): ask once, after the first message, before the phone's dialog`.

### Task 7: Documents and landing

**Files:** `docs/architecture.md` (the push path: trigger → outbox → engine → APNs/FCM), `README.md` (setup: the `google-services` files, `scripts/apns-key.mjs`), `docs/plans/ongoing/app-design.md` (decision 14 replaced, pointing here), `docs/plans/ongoing/team-chat.md` (its «own plan» line), this plan moved to `ongoing/` with a Progress section.

- [ ] **Step 1:** write the changes.
- [ ] **Step 2:** `pnpm check`. Expected: PASS.
- [ ] **Step 3:** commit `docs: the push path`, then `pnpm pr:land` until it exits `0`.
- [ ] **Step 4:** tell Jaime what only he does (part 6 of the design): the APNs key through `scripts/apns-key.mjs`, Firebase on `ghostaff-beta` and `ghostaff-prod` with their `google-services.json`, then the check on a real phone on the beta.
