# Build the first version: one engine for several organisations, then the app

**Priority:** high
**Gate:** none
**Next:** Scaffold the Expo + TypeScript monorepo and ask Álvaro for the Supabase account

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
