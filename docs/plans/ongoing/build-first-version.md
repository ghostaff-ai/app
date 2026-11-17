# Build the first version: one engine for several organisations, then the app

**Priority:** high
**Gate:** none
**Next:** Jaime into the TestFlight group once he accepts the team invitation; then the sync on a schedule

Covers phases 1 to 3 of [`ghostaff-producto.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#por-fases). We need them for our own projects whether or not Ghostaff becomes a business.

**Ghostaff is one of those organisations** ([decision 14](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#ghostaff-usa-ghostaff), Álvaro 2026-11-12). It joins in phase 1, next to Órdago, and every Ghostaff agent runs through the platform. Whatever we have to work around for it goes on the product spec list (phase 2).

1. **The engine serves several organisations.** Each with its own record, keys and settings. Build the own storage (record, database, file store, vault) and the connector layer here. Órdago's configuration moves out of `agents` (`proyectos/ordago/`) into its record.
2. **Cultuvilla joins, then Álvaro's mother's company.** For each, write down what was shared and what had to be custom. That list is the product spec.
3. **The app** on our phones (TestFlight and Google Play internal testing): decision inbox, weekly summary (also as audio), talking to a department, switching organisation. The way in is the Incorporación (onboarding) agent: paste links and documents, watch the record get built.

## Stack (Álvaro, 2026-11-12)

- **App:** Expo + TypeScript, one codebase for iPhone, Android and web. Reuse `cultuvilla/app`'s patterns and store release pipeline.
- **Database, login, file store:** Supabase, EU region (Frankfurt). Postgres with row-level security so one organisation's rows are never visible to another; metric readings stored with their date and source.
- **Engine and vault:** a new Google Cloud project under ghostaff.ai@gmail.com, region `europe-west1`, separate from Órdago's. Agents run on Cloud Run Jobs as `ghostaff-ai/agents` (moved from `ordago-app` 2026-11-15) does today; keys in Secret Manager.
- **The record:** Forgejo on a small server in that project, one repo per organisation, with an optional live copy to the organisation's Drive or GitHub.

## First slice

The app on our phones through TestFlight: sign in, pick an organisation, and a decision inbox fed by Órdago's real `por-decidir/` (Órdago is organisation zero). It forces the multi-organisation base from day one.

## Environments: beta and production (proposal, Jaime 2026-11-15, for Álvaro to decide)

Today `ghostaff-prod` acts as beta: its only service, `engine`, talks to the **beta** Supabase (its one secret is `SUPABASE_SERVICE_ROLE_KEY_BETA`, checked 2026-11-15), and there is no production Supabase. Proposal: one pair per environment, as Órdago does with `ordago-beta` and `ordago-prod`.

| Environment | Google Cloud | Supabase | App | Who is in it |
|---|---|---|---|---|
| Beta | `ghostaff-beta` (created 2026-11-15, empty) | `ghostaff-beta` | `ai.ghostaff.app.beta`, branch `develop` | us and test organisations |
| Production | `ghostaff-prod` | to create | `ai.ghostaff.app`, branch `main` | customers |

- **Why:** production will hold customers' AI keys and mailboxes in Secret Manager. A half-done deploy or a broken migration must never reach them while we test (invariant 1, applied to our own tests).
- **Steps:** deploy the engine to `ghostaff-beta` and move the beta Supabase key there; leave `ghostaff-prod` clean until the production Supabase exists, then pair them.
- **Where Órdago and Ghostaff live:** production, since their data is real and they are the first customers to notice what breaks. Beta keeps test organisations.
- **When:** not urgent while only we use it; clean before the first outside organisation (phase 4, which is also when the SL is constituted).

## What only Álvaro can do (ask when the work reaches it, not before)

- Sign up to Supabase with the Ghostaff Gmail.
- Turn on billing for the new Google Cloud project.
- Add the app in App Store Connect under his developer account.

## Progress

**2026-11-12, the first slice runs locally** (branch `feat/first-slice-scaffold`):

- [x] pnpm monorepo on cultuvilla/app's pattern: `apps/mobile` (Expo 58 since 2026-11-16, expo-router, NativeWind), `packages/shared`, per-env bundle ids `ai.ghostaff.app[.dev|.beta]`, `eas.json` profiles, commitlint, CI.
- [x] Database: organisations, memberships, decisions, with row-level security; the app answers only through `answer_decision()`. pgTAP proves one organisation's member sees and answers nothing of another's.
- [x] Sign in with a 6-digit email code; only people an organisation added can sign in.
- [ ] Sign in with Google (web, Android, iPhone) and Apple (iPhone), 2026-11-17, branch `feat/social-sign-in`. Google Auth Platform in `ghostaff-prod` ("Ghostaff", External): one web client for every env and for Supabase, an iOS client per bundle id, ids pinned in `app.config.ts`; the web client's secret in sops (`SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`). Providers on in local `supabase/config.toml` and in ghostaff-beta's dashboard (plus redirect URLs `exp://**`, `ghostaff://**`). Left: the Android OAuth clients (need the signing SHA-1s: EAS's keystore, then Play's app-signing key once the beta is on Play); Álvaro's one Apple login so EAS adds Sign in with Apple to the beta's App ID and profile, then a TestFlight build for Jaime; **publish the Google app** (it is in Testing: only the test users Álvaro's two Gmails and ghostaff.ai@gmail.com can use Google until then), which needs a home page and a privacy policy on ghostaff.ai; prod's Supabase project gets the same two providers when it exists.
- [x] Organisation picker, remembered on the device.
- [x] Decision inbox and decision screen: OK or no, a note, and a rule signed with its wording.
- [x] `apps/sync`: reads a record's `por-decidir/` into the database, closes what the agent deleted, and with `--write-back` writes app answers into the file and `agentes/historial-decisiones.csv`, as the Órdago panel does. Checked against Órdago's real `por-decidir/` (read only).
- [x] Hosted Supabase project `ghostaff-beta` (ref `rggvcvnstbitbdptiwtk`), Central EU (Frankfurt), in organisation Ghostaff under ghostaff.ai@gmail.com. Schema applied (recorded in `supabase_migrations`, so `db push` skips it), sign-ups off, 6-digit codes; Órdago created with Álvaro as owner; synced (its `por-decidir/` is empty today). Keys in `secrets/` via `secret`.
- [x] Sign-in codes by email: Resend, domain `ghostaff.ai` verified (Ireland), sender noreply@ghostaff.ai, Supabase custom SMTP and the code template; key in `secrets/`.
- [x] Anon key in EAS's `preview` environment for beta builds.
- [x] Expo account `ghostaff.ai`, EAS project pinned in `app.config.ts`.
- [x] Bundle id `ai.ghostaff.app.beta` and App Store Connect app "Ghostaff Beta" (`ascAppId` 6833926912, team 8HWS4483VD, Álvaro's developer account), in `eas.json`.
- [x] Signed in on the beta, on the web and on a Pixel through Expo Go (Álvaro, 2026-11-12).
- [x] The way in (Álvaro, 2026-11-12): anyone signs up with their email; a welcome screen asks their name (required), what they do and how they heard of us; then **create a company** (name, plus optionally web, what they do and other links, the light first step of Incorporación) or **join one** that invited their email. Owners invite from Organizaciones. pgTAP proves nobody sees or joins an organisation that did not invite them.
- [ ] A beta build to TestFlight, for Jaime (Álvaro has no iPhone; he tests on his Pixel through Expo Go). Build 5 uploaded 2026-11-13 after Álvaro's one Apple login; signing certificate, profile and an App Store Connect API key (`MRSFCG84GJ`, Admin) now live on EAS's servers, so later builds and submits run without him (`eas build -p ios --profile beta --auto-submit`). Jaime (Apple ID `jaimerd43@icloud.com`) invited to the Apple team 2026-11-13, role Marketing, Ghostaff Beta only. Left: once he accepts, add him to the internal TestFlight group "Team (Expo)".
- [x] Google Cloud project `ghostaff-prod` under ghostaff.ai@gmail.com. Billing: Órdago's account (`0140DA-ACC4C8-DF8BAE`, Álvaro 2026-11-12); the Ghostaff Gmail has Billing Account User on it. Google raised the account's project quota (2026-11-12) and the project is linked.
- [x] Google Cloud project `ghostaff-beta` (number 1002624835789), created 2026-11-15 by Jaime from ghostaff.ai@gmail.com, billed to the same account as `ghostaff-prod`; empty, for trying the engine before `ghostaff-prod`. Which services go there is still to decide. A gcloud configuration `ghostaff-prod` (account ghostaff.ai@gmail.com, region `europe-west1`) now exists on Jaime's Mac.
- [ ] Organisation Ghostaff in the beta project, with its own record. Its first agent is its own Finanzas, keeping Ghostaff's invoices apart from Órdago's ([decision 15](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#ghostaff-usa-ghostaff)); until it runs, they are booked by hand.
- [ ] An organisation's own AI account (keys or Google Cloud), the first connector and the first piece of the engine on Cloud Run: [llm-connectors](llm-connectors.md). Live on the beta 2026-11-14; not yet tried with a real key.
- [ ] The sync on a schedule, in the engine's Google Cloud project, reading Órdago's record from GitHub and committing write-backs — needs the project's billing.

Decisions taken while building (Álvaro can overturn any):

- **Open sign-up, anyone can create a company** (Álvaro, 2026-11-12, against my pick of a beta code). Note for phase 4 of the product plan: from the first outside organisation that creates one, we hold its data, which is the trigger for constituting the SL. A ceiling of 10 organisations per account stops a runaway account.
- **Joining is by invitation to your email only:** no search, no join codes; the list of organisations is never shown. We send no invitation mail yet: the inviter tells the person, who sees it on signing in.
- ~~Sign-in by emailed code, not a link or Google.~~ **Google and Apple too** (Álvaro, 2026-11-17: "the best option long term, the most comfortable login"). Google: the phone's own account sheet in real builds, Google's button and One Tap on the web (an ID token, so Google's screen never shows supabase.co and no custom auth domain is needed), a browser window in Expo Go. Apple: the iPhone's system sheet. The email code stays for everyone else. Same email, same account: Supabase links the identities. Someone who hides their email with Apple gets a relay address, so an invitation to their real email does not reach them; they sign in with their email instead (adding a real email to such an account is a later step if it happens).
- An answer in the app is stored in the database first and reaches the file through the sync, never directly: the app reads the database, the agents the files (invariant 4). If the panel answers the same file first, the file wins and the sync reports the conflict.
- The decision's area is free text per organisation, not Órdago's fixed list of panel tabs.
- **The engine (Álvaro, 2026-11-12):** Claude Agent SDK (TypeScript) on Cloud Run in `europe-west1`, models through Vertex AI in the EU; Cloud Run Jobs for scheduled runs plus one always-on service for talking to a department; the work queue in Supabase Postgres (pgmq). Not Managed Agents (the loop runs in the US and Anthropic keeps the sessions), not Cloudflare or Vercel (no confirmed EU-only setup on storage we own).
