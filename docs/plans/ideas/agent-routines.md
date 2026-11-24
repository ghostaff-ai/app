# Routines: a clock on the agent, and as many timetables as you need

**Priority:** high — «runs its routine work» is half of what Ghostaff promises, and today no customer can make an agent work on a timetable: only we can, by CLI
**Gate:** decision:the open questions below, Jaime's to answer (recheck 2026-12-01)
**Next:** answer the open questions, then move to `ready/`

**Goal:** Anyone who talks to an agent can give it routines («cada viernes a las 9, mándame el resumen de ventas»), from a clock on top of its chat or by asking, and each routine's answer lands in their chat with that agent as if they had written to it at that hour.

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
- **Secretaría** can propose a routine for any agent; **each agent** can propose its own (that is the «¿cada lunes?» above). Who approves is open question 1.

### Data

- A table `agent_routines`: `id`, `org_id`, `agent_id`, `created_by`, `audience` (`me` | `team`), `instruction`, `schedule` (cron, stored from the fields), `timezone`, `paused`, `last_fired_at`, `created_at`. Row-level security and a pgTAP test (rule 2): a member sees their own routines and the team's of the agents they can see; another organisation sees nothing.
- Written only through `security definer` functions (`create_routine`, `update_routine`, `pause_routine`, `delete_routine`), each classified in `settings.ts`.
- `agent_runs` gets `routine_id`, so «Hecho sin ti» and a routine's history can say which one ran.
- **The tick** fires routines instead of agents: `startScheduled` reads due routines (any runner), claims each by moving `last_fired_at` atomically as it does `last_scheduled_at` today, and starts a chat turn or a runner run with the routine's instruction as the request. A `me` routine answers in its creator's chat; a `team` routine, in everyone's who can see the agent.
- **`agents.schedule` becomes a routine**: each agent with one (Órdago's, moved by `org add-agents`) gets a `team` routine whose instruction is «tu tarea habitual», and the column goes once the tick no longer reads it.

## Open questions

1. **Who approves a routine.** My pick: a «Solo para mí» routine needs only the person who will receive it (it is what they could already write by hand, at an hour), and a «Para todo el equipo» one needs an owner, like any setting. Or: every routine needs an owner, since each one spends the organisation's AI.
2. **Limits.** A floor on frequency (no more than once an hour?) and a cap per person or per organisation, so a routine cannot burn a subscription's limit. My pick: once an hour at most, 10 routines per person, and the AI account card shows what routines spend.
3. **Settings tools in a routine's turn.** A chat turn reads and proposes settings as the person who wrote (`asPerson`, their token); at the tick there is no token. My pick: a routine's turn has no settings tools; it says in its answer what it would change, and the person asks from there.
4. **Timezone.** Everything is Madrid time today. My pick: the organisation's timezone, Madrid by default, until a person needs their own.
5. **A routine whose creator leaves**, or loses access to the agent: paused, and its owners told; or deleted.

## Builds on, and changes

- [agent-memory.md](../ready/agent-memory.md) decision 3: this is the plan it asks for. Memory does not wait for it.
- [agent-settings.md](../ongoing/agent-settings.md): closes «the agent's own rules and schedule as settings» for the schedule half.
- [three-tabs.md](../ongoing/three-tabs.md) decision 12: a `team` routine posts where scheduled runs post today; a `me` routine, only to its creator.
- [wearables.md](../ongoing/wearables.md) phase 3: still needed for routines of runner agents.
- [ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md): `org add-agents` writes a `team` routine instead of `agents.schedule`.
