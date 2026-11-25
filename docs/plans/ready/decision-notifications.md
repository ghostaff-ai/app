# Notifications: an agent's reply and the decisions that wait reach a person without opening the app

**Priority:** high — Telegram is today the only thing that reaches a person outside the app, and it goes off once Órdago's agents run on our runner ([ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md), decision 3)
**Gate:** none — design approved by Jaime (2026-11-25)
**Next:** write the implementation plan (File Structure and Tasks) and build it on `feat/notifications`

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

[app-design.md](../ongoing/app-design.md) decision 14 («one a day at the person's hour, plus a push only for a decision due today or money leaving») is replaced on Jaime's word (2026-11-24, he asked for a notification when an agent writes in the chat): a push per agent reply, collapsed per conversation, plus the daily one. «Due today» and «money leaving» stay as later kinds on the same sender.

## Picks in this design that Jaime can change

The two kinds and their wording; names but never text in a push; one push per thread, replacing; no quiet hours for replies; 09:00 in the phone's time zone with no settings screen (the phone's settings turn it off; a screen would need Secretaría to change it too, AGENTS.md rule 6); the ask after the first message to an agent; who is told following today's conversation model, followers only in a shared one; no push per decision beyond the run's report; OK cards in the daily count for owners only.
