# End-to-end tests: a seeded record and a scripted agent reply

Jaime, 2026-11-26. Landed in #82 (`29e19b4`); first green on `develop` in run 45899435640.

## Context

The job that gates merges and the beta (`ci.yml`, `End-to-end (Android)`) stopped at creating a company. What the first version exists for, answering a decision, and an agent's reply in the team chat reached the phone untested as a release build. A fresh local database has no decisions (they come only from a record, through `apps/sync`), and no engine runs in e2e, so there is no agent reply.

## Decision

- **The run seeds its own company through the real sync.** `scripts/e2e/seed.sh` runs the sync CLI (`add-org`, `add-member`, `por-decidir`) on `.maestro/fixtures/record/`, in Órdago's `por-decidir/` format, with a per-run slug and one owner per flow. After the whole suite, `seed.sh verify` writes the app's answers back into a copy of the record and checks them. So every run covers record → database → app → record.
- **The agent's reply is written by a host-side Maestro script** (`.maestro/scripts/agent-reply.js`), the way the engine leaves a finished one, into whatever conversation holds the person's message. The flow checks that it arrives live. It leans only on what the person sees, so changes to how conversations are kept don't break it.
- The extra ~4 minutes on the job are accepted.
- The service-role key stays on the host (the sync CLI and the Maestro host scripts). It is the local instance's key and never enters the APK.

## Rejected alternatives

- **Rows in `supabase/seed.sql`.** This skips the sync and the record format, needs a login made in SQL, and a second local run meets an already answered decision.
- **The real engine in CI with `VAULT=memory` and a fake model.** It is the truest chat test (it would cover `askAgent`). But it puts a test-only model in the engine and a second service on a 7 GB runner that already dies booting the emulator.
- **One long flow instead of two.** A failure would name less, and a false red would cost the whole run.
- **The new flows only on `develop` pushes.** A pull request would merge green and break `develop`.

## What this binds

- A change to the `por-decidir/` format or to the sync CLI's commands updates the fixture record and `seed.sh` in the same change.
- A change to how the engine finishes a reply (`apps/engine/src/chatStore.ts`) updates `agent-reply.js`. Otherwise the test proves a shape the engine no longer writes.

## Revisit when

- The e2e job is steady enough to host the engine with a stand-in model. That is the next step, and it replaces `agent-reply.js`.
