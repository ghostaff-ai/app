# Notifications: a decision reaches its person without opening the app

**Priority:** high — the product's promise is to bring people the decisions that are theirs, and once Telegram goes off (ordago-agents-in-ghostaff.md, decision 3) nothing leaves the app to tell anyone a decision waits
**Gate:** blocked:ordago-agents-in-ghostaff — built before Telegram goes off, once the last Órdago agents are about to move (Jaime, 2026-11-24)
**Next:** rewrite this plan for the three-tabs app and the chat (below), then build it before Telegram goes off

## When, and what it covers (Jaime, 2026-11-24)

- **Before Telegram goes off, not now.** Telegram is today the only thing that reaches a person outside the app (an agent's reply, a report, a decision, a failed run). While it is on it covers that; the day it goes off ([ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md), decision 3), notifications must already be there, or nobody learns anything without opening Ghostaff. The worst case is a runner agent, which takes minutes to answer: you write, close the app, and never know it replied.
- **My proposal for the rewrite, not yet decided:** the plumbing (device tokens, the engine sending straight to APNs and FCM, the permission ask) plus two notifications: **an agent replied to you** («Legal te ha contestado»), the one Telegram covers today, and **the daily one for waiting decisions**.
- **What the design below misses, as of 2026-11-24:** Hoy no longer exists ([three-tabs.md](../ongoing/three-tabs.md)), so the daily one lands on Decisiones; an agent's OK card in a chat (`agent_actions`) is a decision too and should count; a reply in a chat is left out of scope below, and it is now the first thing to cover.
- **Who gets a chat notification depends on [group-chat-per-agent.md](group-chat-per-agent.md)**: the members of the agent's group who haven't read it, or only the owner of a private chat. The plumbing doesn't.

The design below (2026-11-22) still holds for the plumbing and the privacy rule: notifications go from our engine straight to Apple and Google, and never carry the record's words.

**Goal:** A person gets one notification a day at their hour when something waits for them, and one more when a decision is due today, and a tap lands on that decision; so a decision stops depending on someone remembering to open Ghostaff.

## Context

As of `339f87e` (2026-11-22).

**What is already decided, and stays as it is:**

- [app-design.md](../ongoing/app-design.md) decision 14: «one a day at the person's hour, plus a push only for a decision due today or money leaving». Decision 28: the ghost «never nags». Its checklist leaves «Notifications, the weekly summary, the widget: each its own plan when the engine sends them». This is that plan, for notifications only.
- [team-chat.md](../ongoing/team-chat.md) decision 9: `@Ana` sends her a push; its progress note: «an @person sends no push yet (notifications are their own plan)».
- [entry-flows.md](entry-flows.md) counts on links from a notification.
- [ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md) decision 3: Telegram goes off once every agent's replies and reports arrive in the app. Today Telegram is the only thing that reaches a person who is not looking.

**What exists:**

- Nothing sends or receives a notification: `apps/mobile/package.json` has no `expo-notifications`, `apps/mobile/app.config.ts` has no push plugin or Firebase config, no table holds a device, and `public.profiles` has no hour or time zone.
- The engine has a tick: Cloud Scheduler calls `POST /cron` every five minutes (`apps/engine/src/app.ts`; `tick()` in `apps/engine/src/server.ts` syncs records, expires runs and starts scheduled agents; `scripts/deploy-engine.sh` creates the `tick` job).
- The backend is moving to one Google Cloud project per environment ([environments.md](../ongoing/environments.md), Jaime 2026-11-22; open #36): beta's engine in `ghostaff-beta`, production's in `ghostaff-prod`, each with its own Secret Manager and the same secret names, the deploy scripts taking `beta` or `prod`, a one-time `scripts/setup-env.sh`, and CI deploying migrations, engine and runner (its Task 7). On 2026-11-22 it is blocked: GitHub Actions refuses every job in `ghostaff-ai` over billing, so nothing reaches the beta, a new beta build included, until that is fixed.
- `public.decisions` has `due_on` (`vence`), `answer`, `closed_at` and `org_id`, and no person it is for: every member of the organisation sees every decision (`is_member(org_id)`).
- A link opened cold lands where it points since `0ede8af` «fix(mobile): a link opened cold lands where it points, not on Hoy» (2026-11-19).
- A native change already ships itself: `runtimeVersion` is the fingerprint, and `.github/workflows/beta.yml` starts a new beta build (TestFlight, and an APK) when no build has that fingerprint. Adding a native module is such a change; it cannot go over the air.
- `cultuvilla/app`, the reference repo named in AGENTS.md, has this working on prod: native device tokens from `expo-notifications`, sent from its own backend straight to APNs and FCM (`functions/src/push/apnsTransport.ts`, `fcmTransport.ts`, `apnsJwt.ts`; `apps/mobile/lib/push/pushClient.ts`; `docs/plans/ongoing/device-notifications.md`).

**Where the data goes (invariant 2).** Any push to a phone passes through Apple (APNs) or Google (FCM); neither offers an EU-only route. Expo's own push service would add a third company in between: its FAQ says contents are kept «only in memory and in message queues» and says nothing about the region it runs in ([Expo push FAQ](https://docs.expo.dev/push-notifications/faq/), read 2026-11-21). Expo documents sending without it, with the native token from `getDevicePushTokenAsync` ([sending through FCM and APNs](https://docs.expo.dev/push-notifications/sending-notifications-custom/)). So the design keeps Expo out and keeps the record's words out of the payload.

## Design

**1. What a person gets**

- **The daily one.** At the person's hour (09:00 in their phone's time zone until they change it), if at least one open decision is unanswered in any of their organisations: one notification. «Órdago: 3 decisiones te esperan». Several organisations: «5 decisiones te esperan en 2 organizaciones». Nothing waits: nothing is sent.
- **Due today.** A decision whose `due_on` is today, still unanswered: «Órdago: una decisión vence hoy», once per decision and person. If it is already due when the daily one goes out, the daily one says so («…, una vence hoy») and no second one follows. One that appears later in the day is sent on the next tick, never between 22:00 and 08:00 local.
- **Tapping** opens that decision (`/decision/<id>`), or Hoy for the daily one, in the right organisation (the payload carries the organisation's id and the decision's uuid, nothing else from the record).
- **Asking permission** happens once, after the person answers their first decision, with our own line first («¿Te aviso cuando haya algo tuyo? Una vez al día como mucho.») and only then the phone's dialog. Never at launch.
- **«Notificaciones»**, a small screen: the hour, a switch for the daily one, a switch for «vence hoy». The first native picker and switches, so it brings in Expo UI (app-design decision 33).
- **Who.** Every member of the organisation, because a decision has no person yet. When decisions get one, the sender narrows to them.
- The web gets nothing here: `pushClient.web.ts` answers «unsupported».

**2. Database** (one migration, `supabase/migrations/<date>_notifications.sql`)

- `device_tokens`: `user_id`, `token` (unique), `platform` (`ios`/`android`), `apns_environment` (`production`/`sandbox`), `bundle_id`, `updated_at`. A device belongs to a person, not to an organisation, so it carries `user_id`, not `org_id`, like `profiles`. Row-level security on; a person reads only their own rows; no write policy.
- `notification_prefs`: `user_id`, `hour` (0–23, default 9), `time_zone` (IANA name, default `Europe/Madrid`), `daily` and `due_today` (default true). Same policies.
- `notification_sends`: `user_id`, `kind` (`daily`/`due`), `decision_id`, `local_day`, unique on all four; row-level security on with no policy, so only the engine's service role touches it. It is what makes the tick send once.
- Functions, `security definer`, checking `auth.uid()`: `register_device(token, platform, apns_environment, bundle_id, time_zone)` (a token already held by someone else moves to the caller: the phone changed hands), `forget_device(token)` (called on sign-out), `save_notification_prefs(hour, time_zone, daily, due_today)`.
- pgTAP, `supabase/tests/database/notifications.test.sql`: another person cannot read, move or delete my device or my preferences; nobody reads `notification_sends` from the app; the functions refuse an anonymous caller.

**3. The engine** (`apps/engine/src/notify.ts`, called from `tick()`)

- A pure planner, illustrative: `planPushes(now, people, waiting, sent): Push[]`, where `people` are members with a device and their preferences, `waiting` the open unanswered decisions per organisation, `sent` today's rows. All the rules of part 1 live here.
- A port, illustrative: `PushTransport.send(device, push): Promise<'sent' | 'dead' | 'retry'>`, with two adapters ported from cultuvilla/app: APNs (HTTP/2, a provider token signed with the `.p8` key, cached 50 minutes) and FCM v1 (the engine's own service account). `dead` deletes the token.
- A row goes into `notification_sends` before sending, so a tick that dies halfway does not send twice.
- Off until configured, like every connector in `scripts/deploy-engine.sh`: without the APNs secret and the Firebase project id the tick skips it and says so.

**4. The app** (`apps/mobile/lib/push/`)

- `expo-notifications` and its config plugin; `pushClient.ts` is the only file that imports it (permission, the Android channel, the native token, the tap), with `pushClient.web.ts` beside it; a `PushProvider` under `ActiveOrgProvider` registers the device after sign-in and handles the tap. Data goes through `@ghostaff/shared/services` (rule 1).
- Android needs `google-services.json` per environment, committed as cultuvilla/app does (it holds no secret), wired in `app.config.ts` only when the file exists.
- The first push to `develop` with this starts a new beta build by itself; people on the old build keep working and simply get no notifications until they update.

**5. What only a founder does**

- Add Firebase for the three Android packages (`ai.ghostaff.app`, `.beta`, `.dev`). Which Google Cloud project holds it follows [environments.md](../ongoing/environments.md): `.beta` and `.dev` in `ghostaff-beta`, `ai.ghostaff.app` in `ghostaff-prod`, so each engine sends as its own project's account; to settle when building, since that plan does not mention Firebase.
- An APNs key on team `8HWS4483VD`, team-scoped, Sandbox & Production, put straight into each environment's Secret Manager under the same name (environments.md decisions 1 and 3) by a script like `scripts/github-app-registro.mjs` (never pasted). `ordago-app/ordago-apps/docs/ops/apple-developer-access.md` names a push key `54D676WU4J` on that team, held by EAS and Firebase for Órdago's app; if it is team-scoped and its file is still at hand it serves Ghostaff too, otherwise make a second one.
- Run `scripts/deploy-engine.sh` (with the environment, `beta` or `prod`, once #36 lands); install the new beta build.
- Before the store: declare «Device or other IDs» in Play Data Safety and add the device token to the privacy text (cultuvilla/app left this for last and it is still open there).

**Build order:** database and services; the engine's planner and transports (testable with no phone); the app; then one real decision due today on a founder's phone on the beta. Build it after #36 (environments) lands, since both change `scripts/deploy-engine.sh` and `apps/mobile/app.config.ts`. Once Task 7 of [environments.md](../ongoing/environments.md) is in (CI deploys migrations, engine and runner), the migration and the engine go out from the same push as the app, and «run `scripts/deploy-engine.sh`» drops out of part 5.

**Not in this plan:** the push for «money leaving» (no por-decidir field says a decision moves money; by rule 4 that field starts in Órdago's `por-decidir/README.md`, and the planner takes it as one more rule once it exists); the push for `@Ana` (team-chat decision 9; one more kind on the same sender); a push when an agent writes in someone's chat on its own (the daily one counts decisions only; whether a report deserves a notification is a product decision nobody has taken); the weekly summary and the widget (their own plans).

**Alternatives considered:**

- **Expo's push service** (one HTTP call, no APNs or Firebase credentials on our side): less to build, but a third company holding every token and seeing every payload, with no stated region. Lost to invariant 2, and to cultuvilla/app already having the direct route working.
- **The question in the notification** («¿Publicamos el torneo del sábado?»): more useful at a glance, but the record's words would sit on Apple's and Google's servers and on lock screens. Lost as the default; it could come back later as a per-person switch. This is the gate's question.
- **A daily email instead:** no native build, but needs a mail provider and a sender domain, and it is not what decision 14 chose.
- **A local notification scheduled by the app:** no server and no token, but it can only repeat what the app knew when it was last open, which is the problem.

**Testing strategy:** vitest on `planPushes` with a fixed clock (the hour in two time zones, the day rolling over, nothing waiting, due today folded into the daily one, the night window, sent once) and on the tick with an in-memory `PushTransport` (a dead token is deleted, a retry is not marked sent); the APNs token and FCM request shapes tested as cultuvilla/app tests them, with no network. pgTAP as in part 2. Jest on `PushProvider` with `pushClient` mocked (asks only after the first answer; a tap routes to the decision and switches organisation). Maestro: a flow in `.maestro/flows/ci/` that opens «Notificaciones», changes the hour and declines the ask; real delivery is checked once by hand on the beta, because the CI emulator receives nothing.

## Paths

As of 2026-11-22.

- `supabase/migrations/<date>_notifications.sql` (new)
- `supabase/tests/database/notifications.test.sql` (new)
- `packages/shared/src/services/index.ts`, `packages/shared/src/models/` (device, preferences)
- `apps/engine/src/notify.ts` (new), `apps/engine/src/apns.ts` (new), `apps/engine/src/fcm.ts` (new), `apps/engine/src/server.ts`
- `apps/engine/test/notify.test.ts` (new), `apps/engine/test/apns.test.ts` (new), `apps/engine/test/fcm.test.ts` (new)
- `scripts/deploy-engine.sh`, `scripts/apns-key.mjs` (new); after #36 also `scripts/env.sh` (the Firebase project id per environment)
- `apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/app.config.ts`
- `apps/mobile/google-services/` (new: one `google-services.json` per environment, and a README)
- `apps/mobile/lib/push/` (new: `pushClient.ts`, `pushClient.web.ts`, `PushProvider.tsx`)
- `apps/mobile/app/_layout.tsx`, `apps/mobile/app/(app)/notificaciones.tsx` (new), `apps/mobile/app/(app)/decision/[id].tsx` (the ask after the first answer), `apps/mobile/lib/auth/AuthContext.tsx` (forget the device on sign-out)
- `apps/mobile/__tests__/` (new test for `PushProvider`)
- `.maestro/flows/ci/notificaciones.yaml` (new)
- `docs/plans/ongoing/app-design.md`, `docs/plans/ongoing/team-chat.md` (point their «own plan» lines here)
- `README.md` (setup: the Firebase files and the APNs secret)

## Approval

**Needs your yes**, from either founder (AGENTS.md: either founder decides alone) — the `Gate` question: notifications go from our engine straight to Apple and Google, with no Expo push service, and say only how many decisions wait and in which organisation, never the question itself. Recommended answer: yes, because any push crosses Apple or Google, which have no EU-only route (invariant 2), so the record's words stay out of the payload; the question text can come back later as a per-person switch.

Picks made here that the same yes takes, and that either founder can change: the hour is 09:00 in the phone's time zone until the person changes it; nothing is sent between 22:00 and 08:00; permission is asked after the first answered decision, never at launch; every member of the organisation is notified, because a decision has no person yet.

No path here is a hard stop. The founder-only steps are in part 5 of the design.

## Out of scope

- The push for «money leaving» (decision 14's third trigger): no `por-decidir` field marks it, and by rule 4 that field starts in Órdago's `por-decidir/README.md`.
- The push for `@Ana` (team-chat decision 9) and a push for what an agent writes on its own in a person's chat: more kinds on the same sender, each its own decision.
- The weekly summary and the widget (app-design's checklist: each its own plan).
- Web notifications, email, and the question's text in the notification.
- Assigning a decision to a person.
