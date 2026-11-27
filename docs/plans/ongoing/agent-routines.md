# Routines: a clock on the agent, and as many timetables as you need

**Priority:** high — «runs its routine work» is half of what Ghostaff promises, and today no customer can make an agent work on a timetable: only we can, by CLI
**Gate:** none
**Next:** once group-chat-per-agent's two PRs are on beta, make a routine with a chat agent a few minutes ahead and check it answers in the agent's chat; then one by asking Secretaría, approving its card

**Goal:** Anyone who talks to an agent can give it routines («cada viernes a las 9, mándame el resumen de ventas»), from a clock on top of its chat or by asking, and each routine's answer lands in their chat with that agent as if they had written to it at that hour.

**Changed 2026-11-26 ([group-chat-per-agent.md](group-chat-per-agent.md), decision 6, Jaime):** there is no «Solo para mí» any more. An agent has one chat everyone with access reads, so every routine is the team's and answers there; anyone who talks to the agent makes one, and its creator or an owner changes, pauses or deletes it. What this plan says below about «Solo para mí», «para quién» and owners-only team routines is history.

**Changed 2026-11-27 (Jaime):** «rutina» read as a technical word. Everything a person sees or reads, and what the agents are told, now says **«tarea programada»** («Tareas programadas», «Nueva tarea programada», «Tarea programada · Resumen de ventas» in the chat), and the screens moved to `/tareas-programadas/[agent]` and `/tarea-programada`. Code, database and tools keep `routine`. Where this plan quotes «Rutina» in the UI, read «Tarea programada».

## Context

Jaime (2026-11-24) was worried that nothing tells a person whether an agent is «a chat or a job», nor how to make it run on its own. The decision already exists, without a plan: [agent-memory.md](../ready/agent-memory.md), decision 3, «Nobody picks chat or job when creating an agent», an agent is one thing you can always write to, and a timetable is an option shown as a clock on the agent. This is that plan.

What the code does today (`develop`, 2026-11-24):

- `agents.runner` (`chat` | `ordago_job` | `ghostaff`) is the chat/job split, and `agents.schedule` holds **one** cron per agent, Madrid time.
- The tick only starts agents with `runner = 'ghostaff'` and a schedule (`jobsStore.ts` `scheduledAgents`, `runner.ts` `startScheduled`). A `chat` agent with a schedule never fires.
- Every agent hired in the app is `runner = 'chat'` with no schedule; `settings_create_agent` takes none. The only way to set one is `org add-agents --runner ghostaff`, from a yaml (`apps/sync/src/cli.ts`). [agent-settings.md](../ongoing/agent-settings.md) has it open: «The agent's own rules and schedule as settings».
- A scheduled run has no instruction of its own: it runs the agent's whole usual task (`composePrompt`, «Te ha lanzado tu horario»), and its answer goes to the personal chat of everyone who can see the agent (`post_to_personal_chats`, [three-tabs.md](../ongoing/three-tabs.md) decision 12).

Jaime chose (2026-11-24) **several routines per agent**, not one schedule: Finanzas sends the weekly report on Fridays *and* checks invoices every morning.

## Design

### A routine is a message the clock writes for you

A routine is **what** (an instruction in plain words), **when** (a timetable) and **for whom**. When it fires, the engine does exactly what it does when that person writes the instruction to the agent: the same kind of turn, the same tools, the answer in the same chat. So:

- **Nobody picks chat or job.** A `chat` agent answers a routine with a chat turn; an agent on our runner, with a run. The engine already makes that choice per agent; it now makes it for the clock too, and `runner` stops being something a person ever sees.
- **Chat agents' routines get their connected accounts for free**: chat turns already have them (`restrictTo`). Runner agents still wait for [wearables.md](../ongoing/wearables.md) phase 3.
- **There is a precedent**: Secretaría's hello (`POST /agents/:id/hello`) is already a turn the engine starts without a person writing.

In the chat, a routine's turn shows as a small line above the answer, «🕘 Rutina · Resumen de ventas», so the person knows why the agent spoke. When there is nothing to say, the agent answers `SIN NOVEDAD` and nothing reaches anyone, as scheduled runs do today.

### The clock, on top of the chat

```
 ←  Finanzas                       🕘 Vie 9:00
```

- **In the chat header**, right of the name (`chat/[agent].tsx`). Empty outline when the person has no routine with this agent; with the next one's time when they do.
- **Tapping it** opens «Rutinas»: the person's routines with this agent («Cada viernes, 9:00 · Resumen de ventas»), each with a switch to pause it, and «Nueva rutina».
- **«Nueva rutina»** asks **qué** (free text, with two or three suggestions from the agent's ghost) and **cuándo** (cada día / unos días de la semana / cada mes, and the hour). An owner also sees **para quién**: «Solo para mí» or «Para todo el equipo».
- **The same list** is a row «Rutinas» on the agent's page (`agente/[id].tsx`), beside «Herramientas».
- **Not at hiring.** «Que empiece» stays one tap. Instead, the agent's first message, which already proposes a first piece of work, may end with «¿Quieres que te lo prepare cada lunes?», and a yes brings the routine's card.

### By asking (rule 6)

Routines are settings: defined once in `packages/shared/src/services/settings.ts`, the screen and the agents' tool call the same service functions, and the tool's card says what changes («Ahora: solo cuando le escribes / Después: cada viernes a las 9, resumen de ventas»).

- The tool takes **structured fields** (days, hour, instruction), never raw cron: the model turns «los viernes a las 9» into fields, and the card's preview is written from them, so what a person approves is what will run.
- **Secretaría** can propose a routine for any agent; **each agent** can propose its own (that is the «¿cada lunes?» above). Who approves is decision 1.

### Data

- A table `agent_routines`: `id`, `org_id`, `agent_id`, `created_by`, `audience` (`me` | `team`), `title`, `instruction`, the timetable as fields (`kind` `days` | `monthly`, `weekdays` ISO 1–7, `month_day` 1–28, `hour`, `minute`), `timezone`, `paused`, `paused_reason`, `last_fired_at`. The cron is built from the fields in one place (`packages/shared/src/routines.ts`), never stored. Row-level security and a pgTAP test (rule 2): a member sees their own routines and the team's of the agents they can see; another organisation sees nothing.
- Written only through `security definer` functions (`create_routine`, `update_routine`, `set_routine_paused`, `delete_routine`), each classified in `settings.ts`.
- `agent_runs` gets `routine_id` and the origin `routine`; a run of someone's «Solo para mí» routine is read only by them. `messages` gets `routine_id`, which the chat draws as «🕘 Rutina · Resumen de ventas» above the answer.
- **The tick** fires due routines beside `startScheduled`, claiming each by moving `last_fired_at` atomically as `last_scheduled_at` is today. A chat agent answers with a chat turn in its creator's chat; an agent on our runner with a run whose request is the instruction. A `team` routine's answer also reaches, as a copy, everyone else who can see the agent.
- **`agents.schedule` stays**, as the agent's own timetable from its definition (Órdago's yaml, through `org add-agents`), read-only in the app. *Changed while building (2026-11-24):* the plan made it a routine, but Órdago's crons don't fit the routine's fields without loss (`0 2-5 * * *`, `30 9 2 * 1`, `0 9 15 1 *`), and those agents' timetables are their definition's, not a person's.
- **No hourly routines in this version.** The fields allow once a day at most, which keeps decision 2 by construction; hourly, with a window of hours, when someone asks for it.
- **Agents still run as Órdago's jobs (`ordago_job`) take no routines** until they move to our runner.

## File Structure

- `supabase/migrations/20261126000000_agent_routines.sql` (new): the table, its policy, the four functions, `agent_runs.routine_id`, `messages.routine_id`, `post_routine_copies` and `notify_owners` for the engine.
- `supabase/tests/database/agent_routines.test.sql` (new).
- `packages/shared/src/routines.ts` (new): the `Routine` model, `routineCron`, `nextFire`, `describeWhen` («Cada viernes, 9:00»).
- `packages/shared/src/services/index.ts`: `listRoutines`, `createRoutine`, `updateRoutine`, `setRoutinePaused`, `deleteRoutine`; `routineId` on messages; «Hecho sin ti» counts routine runs.
- `packages/shared/src/services/settings.ts`: `settings_create_routine`, `settings_update_routine`, `settings_pause_routine`; `delete_routine` is `never`.
- `apps/engine/src/routines.ts` (new): the tick's `startRoutines`, the routine's chat turn and runner run, pausing a routine whose creator left.
- `apps/engine/src/chat.ts`, `chatStore.ts`, `jobs.ts`, `jobsStore.ts`, `runner.ts`, `actions.ts`, `server.ts`: the routine's turn, its run and its report; a «Solo para mí» routine's card is approved by its receiver; every agent gets the routine tools for itself, Secretaría for any agent.
- `apps/mobile/app/(app)/chat/[agent].tsx`: the clock in the header. `apps/mobile/app/(app)/rutinas/[agent].tsx` (new): the list. `apps/mobile/app/(app)/rutina.tsx` (new): new or edit. `agente/[id].tsx`: the «Rutinas» row. `components/chat/Message.tsx`: the routine line.

## Tasks

- [x] Migration and pgTAP test
- [x] Shared: model, timetable helpers with unit tests, services
- [x] Engine: tick, chat turn, runner run, report, pause on creator gone, with unit tests
- [x] Settings tools and approval by the receiver, with tests
- [x] App: clock, list, form, agent page row, routine line in the chat
- [x] End-to-end flow in `.maestro/flows/ci/`
- [ ] Landed on beta and checked with a real routine
- [ ] Next stage: the engine picks each turn's kind (below)

### Next stage: the engine picks the turn, not the agent's runner

Jaime (2026-11-24). Today a routine runs however its agent runs: one of a `chat` agent is one model call in the engine, in seconds; one of an agent on our runner starts `agent-runner` every time (a container, a clone of the record, Claude Code for up to `maxTurns`, minutes, and only on a Claude subscription). A routine of Legal that only reads and answers («¿hay novedades en el BOE sobre el juego?») pays a container it does not need.

That is half of [agent-memory.md](../ready/agent-memory.md) decision 3: «whether a turn runs as a quick model call or in a container is the engine's choice, by what the turn needs». To decide when this stage starts, against that day's code:

- **What decides**: a rule (the turn needs the record's files, or writes them → container; otherwise a chat turn), the model itself choosing a tool that hands off to the runner, or a field on the routine set when it is made.
- **What a chat turn of a runner agent gets**: its instructions (`agents.task`, projected from the record), its memory stores once [agent-memory.md](../ready/agent-memory.md) lands, and the connected accounts' tools; no clone.
- **The same for messages, not only routines**: a person writing to Legal also starts a container today.
- **Measure first**: per routine run, origin, runner, time and tokens (`agent_runs`, the AI account's card), so the saving is seen, not guessed.

## Done

- 2026-11-24, [#70](https://github.com/ghostaff-ai/app/pull/70) merged: everything but beta. Checked locally: `pnpm check`, every pgTAP file, the screens on web against a local Supabase; CI green, end-to-end included. Not checked: a routine firing against a real AI account.

## Decisions

Jaime accepted these (2026-11-24).

1. **Who approves a routine.** A «Solo para mí» routine needs only the person who will receive it: it is what they could already write by hand, at an hour, and they need `talk` on the agent. A «Para todo el equipo» routine needs an owner, like any setting. *Rejected:* an owner for every routine, since it would make owners approve what members can already do by writing.
2. **Limits.** A routine fires at most once an hour, and a person has at most 10 routines in an organisation, so routines cannot burn a subscription's limit. The AI account's card shows what routines spend.
3. **No settings tools in a routine's turn.** A chat turn reads and proposes settings as the person who wrote (`asPerson`, their token), and at the tick there is no token. The routine's answer says what it would change, and the person asks from there.
4. **Timezone.** The organisation's, Madrid by default, until a person needs their own.
5. **A routine whose creator leaves** the organisation, or loses `talk` on the agent, is paused, and the owners are told in their chat with Secretaría. Nothing is deleted.

## Builds on, and changes

- [agent-memory.md](../ready/agent-memory.md) decision 3: this is the plan it asks for. Memory does not wait for it.
- [agent-settings.md](../ongoing/agent-settings.md): closes «the agent's own rules and schedule as settings» for the schedule half.
- [three-tabs.md](../ongoing/three-tabs.md) decision 12: a `team` routine posts where scheduled runs post today; a `me` routine, only to its creator.
- [wearables.md](../ongoing/wearables.md) phase 3: still needed for routines of runner agents.
- [ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md): `org add-agents` writes a `team` routine instead of `agents.schedule`.
