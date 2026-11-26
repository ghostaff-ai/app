# End-to-end tests for answering a decision and the team chat

**Priority:** medium — merges and the beta are gated on flows that stop at creating a company; what the first version is for (answering a decision) and an agent's reply in the chat reach the phone untested as a release build
**Gate:** none
**Next:** #82 landed (2026-11-26, `29e19b4`); once `develop`'s run of `29e19b4` passes the end-to-end lane, retire this plan to `docs/decisions/` (last task below)

**Goal:** The job that gates merges and the beta also proves, on the release build, that a person can answer a decision and write in the team chat, so a crash or a broken screen there stops at CI instead of reaching the founders' phones.

## Decision

**Yes** (Jaime, 2026-11-26): the end-to-end run seeds a test organisation from a fixture record and adds two flows to the job that gates merges and the beta: (1) answering a decision; (2) writing in the team chat and seeing a reply. The extra ~4 minutes on a job of 30 to 37 are accepted. The agent's reply is the one this plan proposes, a message written by a host-side Maestro script (Design 3); the real engine with a fake model stays the later step.

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

As built against the code of 2026-11-26 (`1cc4d4f`); «Checked against the code» below says what changed since this was proposed.

**1. A seeded organisation, through the real sync.** A new `scripts/e2e/seed.sh`, called by `android.sh test` before Maestro, runs the existing CLI (`apps/sync/src/cli.ts`, through `tsx` with no `.env`, so it can only reach the local Supabase) with a per-run slug, so a rerun never meets an answered decision:

```bash
# illustrative
org add-org --slug "e2e-$RUN" --name "Gestoría E2E $RUN"
org add-member --org "e2e-$RUN" --email "e2e-dec-$RUN@ghostaff.test" --name "Ana E2E" --role owner
org add-member --org "e2e-$RUN" --email "e2e-chat-$RUN@ghostaff.test" --name "Bea E2E" --role owner
por-decidir --org "e2e-$RUN" --record .maestro/fixtures/record
```

Two owners, one per flow: `mailpit-code.js` reads the last code mailed to an address, so two sign-ins to one address could read the older code. `add-org` gives the organisation Secretaría (`ensure_main_agent`); `add-member` makes confirmed logins with a profile, so they skip the welcome. `.maestro/fixtures/record/por-decidir/` holds two decisions in Órdago's format, both proposed by `secretaria`: a rich one (`recomienda`, `con_si`, `con_no`, `cita`, `fuentes`), newer, so the deck shows it first, and a plain one. The company name and both emails go to Maestro as `-e SEED_COMPANY`, `-e DECIDER_EMAIL`, `-e CHAT_EMAIL`. Each flow gives the company its stand-in AI accounts with the existing `connect-ai.js` before signing in (an owner can't get past «Conecta tu IA» without them), which now skips an organisation that already has them. This exercises record → database → app on every run, with no hosted project and no copy of Órdago's record.

**2. `flows/ci/answer-decision.yaml`.** Sign in as the decider (`subflows/sign-in-email.yaml`), land on Equipo, open Decisiones: «Quedan 2» and the rich card on top. Tap the card for the whole decision, see «Con el sí», answer with the main button (`choice-ok`, labelled with the fixture's `recomienda`), see the answered block (`answered`), go back: «Queda 1» and the plain card; answer it from the deck (`deck-ok`, «OK»): «Nada que decidir». «Ver lo decidido» opens Registro with both; open the rich one, «Cambiar la respuesta» brings its buttons back, and answer it No (`choice-no`). After Maestro, `seed.sh verify` runs `por-decidir --write-back` on a temporary copy of the fixture and checks the rich file carries `decision: no` and the plain one `decision: ok`, which closes the loop the first version exists for. It runs only after the whole `flows/ci/` suite, not after a single flow passed by hand.

**3. `flows/ci/team-chat.yaml`.** Sign in as the second owner, open Secretaría's chat from Equipo (`agent-secretaria`), write a line unique to the run in «Escribe a Secretaría», send it and see it. Then the reply: a host-side Maestro script (`.maestro/scripts/agent-reply.js`, like `connect-ai.js`) finds that message by its text in the seeded company, and writes one agent message in the same conversation the way the engine finishes a reply (`author_kind` agent, `state` done, the conversation's `last_message_at` touched), through the local API with the local service-role key; the flow waits for its text. That proves live delivery (Realtime and the agent's bubble) on the release build. The flow leans only on what the person sees (texts, `agent-secretaria`) and the script only on «the conversation that message is in», so it survives `group-chat-per-agent.md` and `agent-context.md`, which change how conversations are kept and how the engine builds a turn.

The e2e build has no engine URL, so sending also shows «El agente no ha podido contestar ahora…» (`letAgentAnswer` in `lib/hooks/useChat.ts`). The flow tolerates the line rather than the app learning that an empty URL means «no engine»: the line is what a person would see too, and it changes nothing for a test. The answer buttons already have test ids (`choice-*` on the decision, `deck-*` on the deck), so no app code changes.

**4. Docs.** `.maestro/README.md` gains the two flows and the seed; `ci.yml`'s job comment lists them. No workflow step, job or filter changes (CI already calls `android.sh test`), so `.agents/land.config.json` stays as it is.

Rule 3 holds: the service-role key stays on the host (the sync CLI and two Maestro host scripts), is the local instance's key, and never enters the APK.

**Alternatives considered:**
- *Rows in `supabase/seed.sql`*: skips the sync and the record format, needs a login created in SQL, and a second local run meets an already answered decision.
- *The real engine in CI with `VAULT=memory` and a fake model*: the truest chat test (it would cover `askAgent`), but it puts a test-only model in the engine and a second service in a 7 GB runner that already dies booting the emulator. The step after this one, once the gate is steady.
- *One long flow instead of two*: one sign-in less, but a failure names less and a false red costs the whole run.
- *Run the new flows only on develop pushes, not on pull requests*: the beta would still be gated, but a pull request would merge green and break develop.

**Testing strategy:** the flows are the tests. `seed.sh` runs locally with `pnpm e2e` exactly as in CI. Nothing becomes redundant: the unit tests of the sync and the pgTAP tests of `answer_decision` stay, as they cover cases a flow cannot.

## Checked against the code (2026-11-26)

What moved since the proposal (`339f87e`, 2026-11-22), and what it changes here:

- `flows/ci/` now holds seven flows (`create-personal`, `conversation-visibility`, `routines`, `push-ask` were added); the job took 32 minutes on run 45594970546 (2026-11-25).
- Decisions live in their own tab, Decisiones, as a deck (`components/DecisionDeck.tsx`, `deck-card`, `deck-ok`, `deck-no`, `deck-later`); Hoy and «Respondidas» are gone, and what was decided is in Empresa, Registro («Ver lo decidido» on the empty deck). The whole decision is still `DecisionView` (`choice-*`, `answered`, «Cambiar la respuesta»).
- Each person has one chat per agent (`useAgentChat`, `chat/[agent].tsx`), reached from Equipo; Secretaría comes with every organisation, so the chat flow needs no vacancy (`create-company.yaml` still fills one).
- Conexiones and «Añadir conexión» are already walked by `create-company.yaml`: the smoke check of the proposal is dropped.
- An owner can't pass «Conecta tu IA» without an AI account: the seeded company gets them from `connect-ai.js`.
- `automerge.yml` is gone; `pnpm pr:land` requires the same three lanes.

## File Structure

- `.maestro/fixtures/record/por-decidir/secretaria-horario-navidad.yaml` (new): the rich decision
- `.maestro/fixtures/record/por-decidir/secretaria-proveedor-harina.yaml` (new): the plain one
- `scripts/e2e/seed.sh` (new): `seed` (organisation, two owners, the sync; prints the values for Maestro) and `verify <slug>` (the write-back check)
- `scripts/e2e/android.sh` (`cmd_test`): seed before Maestro, pass the values with `-e`, verify after the full suite
- `.maestro/scripts/connect-ai.js`: skip an organisation that already has an AI account
- `.maestro/scripts/agent-reply.js` (new)
- `.maestro/flows/ci/answer-decision.yaml` (new)
- `.maestro/flows/ci/team-chat.yaml` (new)
- `.maestro/README.md`, `.github/workflows/ci.yml` (the job's comment only)

## Tasks

Seed
- [x] The two fixture decisions; check they read with `readDecision` (the sync reports `skipped` otherwise)
- [x] `scripts/e2e/seed.sh seed` and `verify`; run both by hand against the local Supabase
- [x] `android.sh test` seeds, passes `SEED_COMPANY`, `DECIDER_EMAIL`, `CHAT_EMAIL`, and verifies after the full suite
- [x] `connect-ai.js` skips an organisation that already has AI accounts

Flows
- [x] `answer-decision.yaml`
- [x] `agent-reply.js` and `team-chat.yaml`
- [ ] `pnpm e2e` green locally: waived, not run, because this Mac has no Android SDK and `android.sh` boots an x86_64 image, so Jaime chose (2026-11-26) to let the PR's CI lane be the first run; arm64 support in `android.sh` is left for its own PR

Docs and landing
- [x] `.maestro/README.md` and `ci.yml`'s comment
- [x] `pnpm pr:land` to exit 0 (#82, merged as `29e19b4`); the end-to-end lane green on the PR, all ten flows (run 45896774098). Still owed: green on `develop`
- [ ] Retire this plan once `develop`'s run passes with the two flows; the rationale (seeded record, scripted reply, why not the engine yet) goes to `docs/decisions/`

## Handoff

What the PR's runs taught (2026-11-26):
- The first run caught a real bug: on Android the deck's buttons in Decisiones fell under the tab bar, so `deck-ok` was not tappable. `develop` had fixed it meanwhile (`b686493`), so the PR dropped its own fix.
- `create-company.yaml` failed twice on this branch with the app gone from the screen (once at `hideKeyboard`, once after the cold relaunch), then passed; it never failed on `develop` in the same window. Nothing in the job saves logcat, so the cause is unknown. If it recurs, dump `adb logcat` into the `maestro-debug` artifact before guessing.

The local stack: `pnpm db:start`, `pnpm e2e:avd`, `pnpm e2e:build` (again after native or config changes), `pnpm e2e`. A single flow by hand (`bash scripts/e2e/android.sh test .maestro/flows/ci/team-chat.yaml`) still seeds, but skips the write-back check.

## Out of scope

- Making the job faster or steadier (the 18-minute build, the runner dying at emulator boot, the unexplained «Panadería E2E» failure): a separate concern; this plan only avoids making it worse.
- The way in (invitation links, keeping the target across sign-in, Bienvenida): `docs/plans/ideas/entry-flows.md` owns it and its flows. #19 (merged 2026-11-22) changed `subflows/sign-in-email.yaml` (the sixth digit signs in on its own, no «Entrar» tap); these flows reuse it as it now is.
- Connecting a real account or AI key in Conexiones, and a real agent answer: they need outside accounts.
- iPhone and web runs, the desktop layout included.
