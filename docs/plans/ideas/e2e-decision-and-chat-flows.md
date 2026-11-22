# End-to-end tests for answering a decision and the team chat

**Priority:** medium — merges and the beta are gated on three flows that stop at creating a company; what the first version is for (answering a decision) and the chat reach the phone untested as a release build
**Gate:** decision:Shall the end-to-end run seed a test organisation from a fixture record and add two flows (answer a decision; write in the team chat and see a reply) to the job that gates merges and the beta, about 4 more minutes on a job of 30 to 37?

**Goal:** The job that gates merges and the beta also proves, on the release build, that a person can answer a decision and write in the team chat, so a crash or a broken screen there stops at CI instead of reaching the founders' phones.

## Context

As of `339f87e` (2026-11-22, `origin/develop`; the code is that of `bda452d`, the merge of #19, with plan notes on top).

- `AGENTS.md` («Branches»): «A main flow has an end-to-end test in `.maestro/flows/ci/`». That folder holds `launch.yaml`, `sign-in-email.yaml` and `create-company.yaml` only. `create-company.yaml` ends at Equipo, a hired agent's page and Registro, and says why it goes no further: «no engine runs in e2e, so no first thread».
- Nothing downstream is covered: `apps/mobile/components/DecisionView.tsx` (`DecisionView`, shown by `app/(app)/decision/[id].tsx` on the phone), `conversacion/nueva.tsx`, `conversacion/[id].tsx`, `conexiones/index.tsx`. A new company on a fresh local database has no decisions (they come only from a record through `apps/sync`), and an agent's reply comes only from the engine with the organisation's AI account.
- The gate now matters twice: `.github/workflows/automerge.yml` (`52e6ea1`, 2026-11-21) merges a pull request labelled `automerge` once the whole CI has passed, and `beta.yml` ships `develop` after it. What the flows do not cover, nothing checks before the phone. Open #35 replaces the `automerge` label and its workflow with `pnpm pr:land`, which still requires all three CI jobs, so the gate stays the same job. On 2026-11-22 GitHub Actions refuses every job in `ghostaff-ai` over billing (run 45013447901 on `develop`: no job started), so no run, this plan's included, can pass until that is fixed.
- The release build has already hidden crashes Metro never showed: `667152f` fix(mobile): the Android beta no longer crashes once a company exists; e2e gates the beta. `.maestro/README.md` records the first (the 3D ghost on Hoy, R8, 2026-11-17). `apps/mobile` is the module with the most fixes in the window (churn 216, 26 fixes).
- **The job's time.** `End-to-end (Android)` took 30 minutes on run 44927582522 (`d0a348b`: the release APK build 18, the emulator step under 8, of which the three flows 1m46s + 2m13s + 9s) and 37 minutes on run 44955718393 (`23b69e7`). The timeout is 60. Two more flows of the same size add about 4 minutes.
- **The failures are of two kinds.** In the 50 runs read on 2026-11-21, 39 were CI, 10 failed and 4 were cancelled; the six failures read were all in `End-to-end (Android)`, with typecheck and pgTAP green. The eleven CI runs since (to `23b69e7`) all passed, one on its second attempt (#19).
  - Runner, not code: runs 44601321624 and 44492413588 (`feat/connectors-google`) end with «The runner has received a shutdown signal» while the emulator boots; 44401836639 and 44384500475 (#19) show the same boot loop and no Maestro output at all. `ci.yml` already notes the cause (a private repo's runner has about 7 GB).
  - One flow, unexplained: run 44901256372 on develop (`3fea05b`, merge of #25) failed `create-company.yaml` on «"Panadería E2E" is visible» while the other two passed; it was not rerun, and the next develop run (`50646f9`) passed with no fix to that screen in between. The same assertion failed once before, on 2026-11-17 (run 44179586996). The flow waits on that text more than once (after creating the company; after the cold relaunch, 60 s) and the log does not say which.
  So each added flow is also one more chance of a false red on the gate; the design keeps them short and reuses one sign-in.
- **What can stand in for the record and the AI key, already in the repo:**
  - `apps/sync/src/cli.ts`: `add-org`, `add-member` (creates a confirmed login that signs in with the emailed code and skips the welcome screen) and `por-decidir --org --record <folder> [--write-back]`; a record folder that is not a git checkout is accepted («fine for a test folder»). It needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment. The fixture format is in `packages/shared/test/porDecidir.test.ts`.
  - The local Supabase prints its service-role key (`supabase status -o env`); `scripts/e2e/android.sh` `supabase_env` already reads `ANON_KEY` and `MAILPIT_URL` from there.
  - Chat needs no seed for the person's side: `start_thread` and `post_message` are database functions (`supabase/migrations/20261118000000_team_chat.sql`), and filling a vacancy creates the agent.
  - CI starts the local Supabase with Realtime on (it is not in the `-x` list of `supabase start`), which is how a reply reaches the thread.

## Design

**1. A seeded organisation, through the real sync.** A new `scripts/e2e/seed.sh`, called by `android.sh test` before Maestro, runs the existing CLI against the local Supabase with a per-run slug and email (as the current flows do, so a rerun never meets an answered decision):

```bash
# illustrative
org add-org --slug "e2e-$RUN" --name "Gestoría E2E"
org add-member --org "e2e-$RUN" --email "e2e-owner-$RUN@ghostaff.test" --name "Ana E2E" --role owner
por-decidir --org "e2e-$RUN" --record .maestro/fixtures/record
```

`.maestro/fixtures/record/por-decidir/` holds one or two decision files in Órdago's format (one plain, one with `recomienda`, `fuentes`, `con_si` and `con_no`). The email goes to Maestro as `-e DECIDER_EMAIL=…`. This exercises record → database → app on every run, with no hosted project and no copy of Órdago's record.

**2. `flows/ci/answer-decision.yaml`.** Sign in as the seeded owner (the existing `subflows/sign-in-email.yaml`), land on Hoy with «Te esperan», open the card, read the question, answer with the main button (its label is the fixture's `recomienda`, else «OK»), see the answered block (`testID="answered"`), go back and find it under «Respondidas»; then «Cambiar la respuesta» brings it back. After Maestro, `seed.sh verify` runs `por-decidir --write-back` on a temporary copy of the fixture and checks the file carries `respuesta:`, which closes the loop the first version exists for.

**3. `flows/ci/team-chat.yaml`.** In the same seeded organisation (one sign-in less than a new company): Equipo, fill a vacancy (`vacancy-…`, «Que empiece»), «Nueva» on the agent's page, write a message, see it in the thread. Then the reply: a host-side Maestro script (`.maestro/scripts/agent-reply.js`, like `mailpit-code.js`) inserts one agent message in that thread through the local API with the local service-role key, and the flow waits for its text. That proves live delivery (Realtime, the list, the agent's bubble) on the release build. A last step opens Conexiones from the organisation switcher (the «Conexiones» row in `organizaciones.tsx`) and checks the list draws (a `connector-…` row; the rows come from the catalogue in `@/lib/connections`, so they draw with no engine), a smoke check only.

Two things the build must settle against that day's code: with no engine URL in the e2e build, sending shows «El agente no ha podido contestar ahora…» (`letAgentAnswer` in `lib/hooks/useChat.ts`; `useEngine` in `lib/hooks/useConnections.ts` returns an engine whenever there is a session, even with an empty URL), so either the e2e build treats an empty engine URL as «no engine», or the flow tolerates the line; and the answer buttons get test ids as the vacancies already have, so the outcome of `decision-deck.md` (swipe or buttons) changes one flow, not the selectors of several.

**4. Docs.** `.maestro/README.md` gains the two flows and the seed; `ci.yml`'s job comment lists them. No workflow step changes: CI already calls `android.sh test`.

Rule 3 holds: the service-role key stays on the host (the sync CLI and one Maestro host script), is the local instance's key, and never enters the APK.

**Alternatives considered:**
- *Rows in `supabase/seed.sql`*: skips the sync and the record format, needs a login created in SQL, and a second local run meets an already answered decision.
- *The real engine in CI with `VAULT=memory` and a fake model*: the truest chat test (it would cover `askAgent` and «Que empiece»'s first thread), but it puts a test-only model in the engine and a second service in a 7 GB runner that already dies booting the emulator. The step after this one, once the gate is steady.
- *One long flow instead of two*: one sign-in less, but a failure names less and a false red costs the whole run.
- *Run the new flows only on develop pushes, not on pull requests*: the beta would still be gated, but a pull request would merge green and break develop.

**Testing strategy:** the flows are the tests. `seed.sh` runs locally with `pnpm e2e` exactly as in CI. Nothing becomes redundant: the unit tests of the sync and the pgTAP tests of `answer_decision` stay, as they cover cases a flow cannot.

## Paths

As of 2026-11-22.

- `.maestro/flows/ci/answer-decision.yaml` (new)
- `.maestro/flows/ci/team-chat.yaml` (new)
- `.maestro/fixtures/record/por-decidir/` (new)
- `.maestro/scripts/agent-reply.js` (new)
- `scripts/e2e/seed.sh` (new)
- `scripts/e2e/android.sh` (`supabase_env`, `cmd_test`)
- `.maestro/README.md`
- `.github/workflows/ci.yml` (the job's comment)
- `apps/mobile/components/DecisionView.tsx` (test ids on the answer buttons)
- `apps/mobile/lib/hooks/useConnections.ts` or `useChat.ts` (only if an empty engine URL becomes «no engine»)

## Approval

**Needs your yes** — the `Gate` question; recommended answer: yes, because answering a decision is what the first version is for and today only a founder's phone tests it, and 4 minutes on a job of 30 to 37 is cheap next to a broken beta. `AGENTS.md` has no `## Approval` section, so nothing is pre-approved.

No path here is a hard stop. The two small changes under `apps/mobile` (test ids; an empty engine URL meaning «no engine») are there only to make the flows possible and steady.

## Out of scope

- Making the job faster or steadier (the 18-minute build, the runner dying at emulator boot, the unexplained «Panadería E2E» failure): a separate concern; this plan only avoids making it worse.
- The way in (invitation links, keeping the target across sign-in, Bienvenida): `docs/plans/ideas/entry-flows.md` owns it and its flows. #19 (merged 2026-11-22) changed `subflows/sign-in-email.yaml` (the sixth digit signs in on its own, no «Entrar» tap); these flows reuse it as it now is.
- Connecting a real account or AI key in Conexiones, and a real agent answer: they need outside accounts.
- iPhone and web runs, the desktop layout included.
