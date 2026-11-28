# Dirección: one agent leads the team, answers in seconds and works in depth when it must

**Priority:** high — Jaime (2026-11-28): «no puedo visualizar la diferencia entre Secretaría y Dirección»; the agent that leads must have the power over everything
**Gate:** none
**Next:** land PR 1 (below); then, on the beta, the Órdago fusion (step «Órdago» below, with Jaime's OK) and ask Dirección something that needs BigQuery

**Goal:** Every organisation has one agent that leads its team and reports to its owners: **Dirección**. It knows the whole organisation (the record, every repo the team uses, what each agent did), talks to the other agents, creates and removes them (with an owner's OK), and proposes. It answers in chat in seconds, and when the answer needs real work (code, BigQuery, a transcript, changing the record) it launches itself on our runner and reports in the same chat.

## Context

Until today there were two heads, from two worlds ([conversation of 2026-11-28](#decisions-jaime-2026-11-28)):

- **Secretaría**, Ghostaff's main agent (`agents.is_main`, [agent-builder.md](agent-builder.md) slice 1): a chat agent. It answers in seconds, keeps the company's memory and proposes settings (create agents, accounts, access, routines). It clones nothing and has no timetable.
- **Dirección**, Órdago's coordinator, moved to our runner on 2026-11-26 ([ordago-agents-in-ghostaff.md](ordago-agents-in-ghostaff.md)): Claude Code in a container with `business` and `ordago-apps` cloned, BigQuery, the other agents' runs. A weekly review. Almost no power over the others: notes in `tablon/` and lowering a goal.

agent-builder.md decision 6 had already chosen one main agent and rejected two because «two agents on day one blur who leads»; Órdago, which came in through the technical door, ended up with exactly that.

## Decisions (Jaime, 2026-11-28)

1. **One main agent for every organisation, named «Dirección»** (Jaime: «llámalo como lo quieras llamar»; the name is mine, it is the department's and Órdago already uses it). `MAIN_AGENT_NAME` changes; the name stays one constant.
2. **It has the power over everything**: the whole context, talking to the other agents, creating and removing agents, proposing. Every change to the team still waits for an owner's «Aprobar» (agent-settings.md decision 3), now including removing an agent, which leaves agent-settings.md's hard limits.
3. **One head, two hands (approach A, picked over «always runner» and «always chat»):** one agent, one chat, one memory. Every message is answered by a chat turn in seconds; when the answer needs something the chat turn has no tool for, it launches itself on our runner with a brief and says so, and the run reports in the same chat. Its timetable always runs on the runner.
   - *Rejected, always runner:* every «hola» takes minutes and costs a container; a non-technical customer's first impression is a wait.
   - *Rejected, always chat:* loses «clone the whole organisation», and would rebuild by hand what Claude Code already does.
4. **How it knows which hand to use: by the tools it has, not by how hard the question looks.** In chat it has the memory, the settings and every agent's recent runs. If answering needs anything else (a repo's code or files, BigQuery or another query, a whole transcript, changing the record), it calls `trabajar_a_fondo`. «Míralo a fondo» from a person always goes deep. It may answer what it knows first and say it checks.

## Design

### The chat hand (engine, `chat.ts`)

The main agent, in a turn a person asked for, gets three tools besides today's (`delegation.ts`):

- `ver_ejecuciones(agente?, n?)`: the latest runs of the organisation's agents (or one), newest first: who, how it started, state, when and what it said (`agent_runs.summary`, cut). Read as the person who asked, so it shows only the agents they may see.
- `trabajar_a_fondo(encargo)`: launches the main agent itself on our runner with the brief.
- `encargar_a_agente(agente, encargo)`: brings another agent in with the brief. One on our runner (or a legacy job) starts a run; a chat agent answers at once in the same chat, as when a person @mentions it, told that Dirección asks.

The last two **run after the reply ends**: a thread has one reply being written at a time (`messages` unique index), so the reply writer keeps the call and, once Dirección's own message is done, starts the new reply in the same chat (`replyTo` the person's message) and launches it. One per reply; a second call in the same reply is refused with why. Whoever asks must be able to talk to the agent brought in.

`agent_runs.brief` (new column, ≤ 8000 characters) keeps the brief; the run's prompt (`composePrompt`) shows it as «Encargo de <quien>» besides the conversation.

The system prompt's lines for the main agent (`DIRECTION_LINES`) say it leads the team, what it has in chat, when to go deep (decision 4) and how to bring another agent in.

### The deep hand (runner)

- **The main agent can run on our runner whatever its `runner`** (`chat` for every new organisation): `runnerAgent`, `scheduledAgents`, `claimSchedule` and the record hook's agents read `runner = 'ghostaff' or is_main`. Its missing runner fields take defaults (`MAIN_AGENT_RUN`: model `claude-opus-5-5`, the tools of Órdago's Dirección, 120 turns); with no instructions in the record (`agentes/<slug>/AGENTS.md`), its task is `MAIN_AGENT_TASK`.
- **It reads every run of its organisation** (`readsOrgRuns` is true for the main agent: `ghostaff ejecuciones <agente>`).
- **It has every repo its team uses**: its own `repos`, plus every other agent's, read-only.
- **It needs a slug** (its record user and folder): `direccion` for the main agent, when free in its organisation.

### Removing an agent

`settings_remove_agent(agent_id)`: a card «Quitar a X del equipo», with what goes with it (its chat and its history, not undoable); runs `delete_agent` as the approving owner, which still refuses the main agent. `delete_agent` moves from `never` to `agent` in the catalogue.

### The rename

- `MAIN_AGENT_NAME = 'Dirección'`; `hire_main_agent` hires «Dirección» with slug `direccion`. Every string a person or an agent reads that said «Secretaría» for the main agent reads the constant. The ghost `secretaria` keeps its label: it is a drawing and the mail job's costume.
- **Migration:** every main agent still called «Secretaría» becomes «Dirección», unless its organisation already has an agent with that name (Órdago) — that one waits for the fusion below.

## PR 1 (this branch, `feat/direccion-main-agent`)

- [ ] Migration: `agent_runs.brief`; the rename and the slug; `hire_main_agent`.
- [ ] Shared: `MAIN_AGENT_NAME`; the strings; `settings_remove_agent` and the catalogue.
- [ ] Engine: `delegation.ts` (three tools), follow-ups after the reply, `DIRECTION_LINES`; runner: the main agent runs, defaults, brief in the prompt, every repo read-only, reads the org's runs; record hook includes it.
- [ ] Tests: engine unit tests for the tools, the follow-up and the runner's spec; pgTAP for the rename; e2e flows read «Dirección».

## Órdago (after PR 1, on the beta, with Jaime's OK)

Órdago keeps «Secretaría» as main and «Dirección» on our runner until this runs (one transaction, by hand: it changes Órdago's real rows):

```sql
begin;
update public.agents set is_main = false where org_id = :ordago and is_main;              -- Secretaría
update public.agents set is_main = true, runner = 'chat' where org_id = :ordago and slug = 'direccion';
commit;
```

Dirección then answers in seconds, keeps its weekly review on Monday at 10:00 (its timetable, on the runner) and its instructions in the record. The old Secretaría stays an ordinary chat agent with her history; an owner removes her from Equipo (or asks Dirección) when nobody needs it.

## Later

- **Changing another agent's instructions and goals with an owner's OK.** Today a chat agent has no instructions of its own (its job is its ghost's line) and a runner agent's live in `agentes/<slug>/AGENTS.md`, which the record's hook refuses to any agent. Needs a record write from an approval, as the owner. Until then, at Órdago, Dirección's deep run does what Órdago's `AGENTS.md` lets it (lower a goal, a note in `tablon/`).
- Dirección reading the answer of an agent it brought in and following up on its own (today the answer lands in the chat for the people).
- Creating an agent on the runner from chat (agent-builder.md slice 2 drafts: `runner`, repos, keys).
