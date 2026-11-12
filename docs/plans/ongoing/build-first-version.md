# Build the first version: one engine for several organisations, then the app

**Priority:** high
**Gate:** none
**Next:** Álvaro signs up to Supabase with the Ghostaff Gmail and creates the Expo account; then the hosted project, the beta build and TestFlight

Covers phases 1 to 3 of [`ghostaff-producto.md`](https://github.com/ordago-app/business/blob/main/docs/plans/ideas/ghostaff-producto.md#por-fases). We need them for our own projects whether or not Ghostaff becomes a business.

1. **The engine serves several organisations.** Each with its own record, keys and settings. Build the own storage (record, database, file store, vault) and the connector layer here. Órdago's configuration moves out of `agents` (`proyectos/ordago/`) into its record.
2. **Cultuvilla joins, then Álvaro's mother's company.** For each, write down what was shared and what had to be custom. That list is the product spec.
3. **The app** on our phones (TestFlight and Google Play internal testing): decision inbox, weekly summary (also as audio), talking to a department, switching organisation. The way in is the Incorporación (onboarding) agent: paste links and documents, watch the record get built.

## Stack (Álvaro, 2026-11-12)

- **App:** Expo + TypeScript, one codebase for iPhone, Android and web. Reuse `cultuvilla/app`'s patterns and store release pipeline.
- **Database, login, file store:** Supabase, EU region (Frankfurt). Postgres with row-level security so one organisation's rows are never visible to another; metric readings stored with their date and source.
- **Engine and vault:** a new Google Cloud project under ghostaff.ai@gmail.com, region `europe-west1`, separate from Órdago's. Agents run on Cloud Run Jobs as `ordago-app/agents` does today; keys in Secret Manager.
- **The record:** Forgejo on a small server in that project, one repo per organisation, with an optional live copy to the organisation's Drive or GitHub.

## First slice

The app on our phones through TestFlight: sign in, pick an organisation, and a decision inbox fed by Órdago's real `por-decidir/` (Órdago is organisation zero). It forces the multi-organisation base from day one.

## What only Álvaro can do (ask when the work reaches it, not before)

- Sign up to Supabase with the Ghostaff Gmail.
- Turn on billing for the new Google Cloud project.
- Add the app in App Store Connect under his developer account.

## Progress

**2026-11-12, the first slice runs locally** (branch `feat/first-slice-scaffold`):

- [x] pnpm monorepo on cultuvilla/app's pattern: `apps/mobile` (Expo 56, expo-router, NativeWind), `packages/shared`, per-env bundle ids `ai.ghostaff.app[.dev|.beta]`, `eas.json` profiles, commitlint, CI.
- [x] Database: organisations, memberships, decisions, with row-level security; the app answers only through `answer_decision()`. pgTAP proves one organisation's member sees and answers nothing of another's.
- [x] Sign in with a 6-digit email code; only people an organisation added can sign in.
- [x] Organisation picker, remembered on the device.
- [x] Decision inbox and decision screen: OK or no, a note, and a rule signed with its wording.
- [x] `apps/sync`: reads a record's `por-decidir/` into the database, closes what the agent deleted, and with `--write-back` writes app answers into the file and `agentes/historial-decisiones.csv`, as the Órdago panel does. Checked against Órdago's real `por-decidir/` (read only).
- [ ] Hosted Supabase project, EU (Frankfurt) — **needs Álvaro's sign-up**.
- [ ] Expo account and EAS project for the builds — **needs Álvaro** (not in the list above; same kind of step as Supabase).
- [ ] App Store Connect app `ai.ghostaff.app.beta`, then a beta build to TestFlight — **needs Álvaro**.
- [ ] The sync on a schedule, in the engine's Google Cloud project, reading Órdago's record from GitHub and committing write-backs — needs the project's billing.

Decisions taken while building (Álvaro can overturn any):

- Sign-in by emailed code, not a link or Google: the same on phone and web, no OAuth clients or deep links to set up.
- An answer in the app is stored in the database first and reaches the file through the sync, never directly: the app reads the database, the agents the files (invariant 4). If the panel answers the same file first, the file wins and the sync reports the conflict.
- The decision's area is free text per organisation, not Órdago's fixed list of panel tabs.

