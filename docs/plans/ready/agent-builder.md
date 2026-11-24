# Creating an agent is a conversation with the main agent

**Priority:** high — Jaime (2026-11-24): «un agente de finanzas no me dice nada»; today an agent is a costume (ghost, name, department) and every organisation's real work is its own
**Gate:** none
**Next:** Task 1 of [slice 1](#build-slice-1-the-main-agent-as-a-role), in a worktree off `develop`: the migration `20261126200000_main_agent.sql` and its pgTAP test

## Goal

An owner creates an agent by telling the organisation's **main agent** what they want, in their own words (a long text or a voice note), and going back and forth with it until the agent is set: what it does, which connectors it uses (connected right there), when it works, what it does alone, what it brings to a person, and how often it asks for feedback. While they talk, the agent's card fills in above the conversation. A trial shows what it would have done today, without touching anything. «Que empiece» makes it real.

Afterwards the same card is one tap away (the ghost on top of its chat), with all of it, and «Ajustar con …» reopens the conversation where it was made. Equipo lists every agent; it is the inventory.

## Why (Jaime, 2026-11-24)

- A ready-made «Finanzas» says nothing about *this* organisation. The ready-made agents become **examples** that start the conversation, not agents you hire as they are.
- A small business can't write a prompt (product plan, «Agentes a medida», Jaime 2026-11-14: «tendrá que iterarlo con un modelo; ese flujo está por definir»). This is that flow.
- People must understand that one agent leads the team. Calling it Secretaría says the opposite, so the main agent gets another name (still to choose), and filtering the mail becomes one more agent you can create.

## What exists today (develop, 2026-11-24)

- **Way in:** profile → space → AI account → Equipo, each a guard in `apps/mobile/app/(app)/_layout.tsx`. Every new space is created with Secretaría (`hire_secretaria`, migration `20261122300000_spaces.sql`).
- **Adding an agent:** Equipo's last row → `anadir-agente.tsx` (the starting team's free jobs, then «Agente a medida») → `contratar.tsx` («Que empiece»: `create_agent`, then `POST /agents/:id/hello`) or `nuevo-agente.tsx` (ghost, name, department; no job, no hello). The custom agent's footer promises «Descríbele el trabajo», and nothing asks for it.
- **What a new agent is:** a row with `runner = 'chat'`, no `slug`, no `task`, no `schedule`, `accounts = null`. Its behaviour is `systemPrompt` in `apps/engine/src/chat.ts`: its name, department and its ghost's one-line job (`AGENT_JOBS`). `systemPrompt` does not read `task` today.
- **Instructions live in the record** (Jaime, 2026-11-24): `agentes/<slug>/AGENTS.md`, projected into `agents.task` by the sync (`projectInstructions` in `apps/engine/src/recordSync.ts`, `task_in_record`). Only the engine writes an `AGENTS.md`, as a commit after an owner ([record-store.md](../ongoing/record-store.md)); an organisation without a record yet keeps `task` as the row's own.
- **The main agent** is `isMainAgent` (`packages/shared/src/services/settings.ts`): `ghost === 'secretaria'`. An agent drawn as that ghost is «main» too; removing Secretaría leaves none. The app shows nothing of it beyond pinning her first in Equipo.
- **Pieces to reuse:** the team chat and its engine turns; voice notes; the settings tools and their «Aprobar» cards (`actions.ts`, rule 6); an agent asking for a connector inside the chat ([connector-in-chat.md](../ongoing/connector-in-chat.md)); routines as structured timetables ([agent-routines.md](../ongoing/agent-routines.md), being built); instructions as `agents.task`, later `agentes/<slug>/AGENTS.md` in the record ([agent-memory.md](agent-memory.md)).

## Decisions (Jaime, 2026-11-24)

1. **A conversation, with the card filling in above it** (form A of three mocked up: conversation / fixed steps / whole draft then fix the gaps). The main agent asks one thing at a time; the card shows each part as it is settled.
2. **Its own screen**, «Nuevo agente», not a thread inside the main agent's chat list.
3. **Equipo is the inventory.** Every agent is there; tapping one, or its ghost on top of its chat, opens its card.
4. **The card shows everything** (`agente/[id].tsx`), with a new block «Cómo trabaja»: instructions (the full text, readable), when it works, what it does alone, what it asks, how often it asks for feedback. What is there today stays (conversations, who can see or talk to it, new conversations' default, remove from the team).
5. **Changing an agent later**, two ways, both landing in the same place:
   - «Ajustar con …» on the card reopens the conversation where it was made, with the main agent;
   - talking to the agent itself in its chat.
   Every change to the card arrives as a proposal an owner approves. What an agent learns day to day is memory ([agent-memory.md](agent-memory.md)) and needs no approval.
6. **One main agent, renamed.** Secretaría becomes the main agent under a new name (open, below): it leads the team, creates agents with you, knows the organisation and changes its settings. Filtering the mail becomes an example («Correo») you create like any other. *Rejected:* a separate main agent beside Secretaría (what [ordago-as-customer.md](../ongoing/ordago-as-customer.md) front 4 had), since two agents on day one blur who leads.
7. **Approach 1: a draft and a thread** (below).

## Approaches

1. **A draft of the agent, written by the main agent in a thread of its own.** *Picked.* The screen opens a thread with the main agent; a new tool lets it write a draft row; the card above reads the draft live. «Que empiece» turns the draft into the agent. «Ajustar» reopens the same thread, where changes to the live agent are proposals. Reuses the chat, voice notes, connector asks and approval cards; creating and adjusting go through one place.
2. **The model returns the whole card in every reply** from an endpoint of its own; the screen draws the last one. Less database, but a second conversation system beside the team chat, the card lives only inside messages, and «Ajustar» would need another path.
3. **The draft is a file of the record** (`agentes/<slug>/AGENTS.md` on a branch). The record is where the finished instructions go (below), but a draft changes on every answer and is not the organisation's history yet; a branch per draft adds commits nobody reads. With approach 1 the draft lives in the database and becomes a commit only at «Que empiece».

## Non-goals (this plan)

- Dressing the ghost by its connectors, or designing your own ghost. The ghost is picked from the ones that exist, by the main agent or on the card.
- Choosing the main agent's name (open below; a constant until then).
- Members creating agents. Owners only, as `create_agent` is today.
- Templates per kind of space ([agent-templates.md](../ideas/agent-templates.md)). The examples here are one list for both kinds; that plan can split it later.
- New behaviour for «what it does alone / what it asks / how often it asks for feedback». They are written into the instructions, in plain words; the approval cards and routines already do the enforcing.

## Anti-goals

- **An interrogation.** If the card shows nothing after the first answer, it failed. The main agent fills what it can from the description before asking anything, and asks only what changes the agent.
- **A form dressed as a chat.** No fixed order of questions; it follows what the person said.
- **Anything real before «Que empiece».** No agent row, no routine, no connector granted to an agent until then. The trial reads and never writes or proposes outside Ghostaff.

## Design

### The main agent is a role, not a ghost (slice 1)

- `agents.is_main boolean not null default false`, with a unique partial index `(org_id) where is_main`. `isMainAgent(a)` reads it.
- **Migration** (Jaime, 2026-11-24): in each organisation, its oldest agent with ghost `secretaria` and `runner = 'chat'` becomes the main agent. **An organisation with none** (one created before 2026-11-22, Órdago among them, or one that removed Secretaría) **gets a new chat main agent** hired by the migration. Órdago's «Correo» (ghost `secretaria`, a job) stays an ordinary agent, and the right to write `memoria/empresa/` moves from the ghost to the main agent, so Correo loses it.
- `hire_secretaria` becomes `hire_main_agent`: same place in `create_organization` and `create_personal_space`, inserts with `is_main = true` and the name from one constant, `MAIN_AGENT_NAME` (`packages/shared`), «Secretaría» until the name is chosen. Renaming later is one constant and one migration for existing rows (`where is_main and name = 'Secretaría'`).
- `delete_agent` refuses the main agent (`42501`); its card shows no «Quitar del equipo».
- Every other check on the ghost moves to the role: `firstHello.ts` (her hello), `create_agent`'s `member_default` (`talk` for the main agent), and `writesCompany` in `recordProvision.ts` (who writes `memoria/empresa/`, enforced by the record's pre-receive hook).
- `AGENT_JOBS.secretaria.job` becomes the main agent's job: it leads the team, creates agents with you and knows the organisation (*wording is a builder's call; Spanish, «tú»*). The ghost art stays.
- The chat agent with `is_main` gets the settings lines (as today) plus the builder lines below when the thread is a creation thread.
- `settings_create_agent` stays, so «créame un agente que…» in the main agent's normal chat is answered with «Te abro Nuevo agente» and a link to the screen (*my call*: one way to create, not two).

### The draft and its thread (slice 2)

- Table `agent_drafts`: `id`, `org_id`, `thread_id` (unique, the creation thread, whose `agent_id` is the main agent's), `created_by`, `agent_id` (null until started), `name`, `ghost`, `department`, `description` (its one line, ≤ 1000), `task` (instructions, ≤ 40000, as `agents.task`), `accounts text[]`, `routines jsonb` (a list of routine drafts in the fields of [agent-routines.md](../ongoing/agent-routines.md): `title`, `instruction`, `kind`, `weekdays`, `month_day`, `hour`, `minute`), `trial jsonb` (`text`, `ran_at`), `status` (`open` | `started` | `abandoned`), timestamps. Row-level security: owners of the organisation read it; written only through `security definer` functions; a pgTAP test that another organisation's member and a non-owner member see and change nothing (rule 2). Added to the `supabase_realtime` publication so the card updates live.
- **The creation thread is shared by the owners** (Jaime, 2026-11-24): one per agent, which every owner reads and continues, so whoever adjusts an agent later sees why it was made as it was. That is a new thread visibility, `owners` (beside `private`, `read`, `write`): `thread_level_for` gives `write` to the organisation's owners and nothing to anyone else, whatever their level on the main agent. pgTAP: a second owner reads and writes it, a member with `talk` on the main agent sees nothing. Creation threads are not listed among the main agent's conversations; they are reached from «Nuevo agente», the open-draft row and the agent's «Ajustar» (*my call*).
- Functions: `create_agent_draft(org, description)` (owner; creates the thread with the main agent, visibility `owners`, title «Nuevo agente», and the draft), `update_agent_draft(draft, patch jsonb)` (owner; only the fields above; validates the ghost, department and routine fields as the live functions do), `start_agent_draft(draft)` (owner; needs `name` and `task`; creates the agent as `create_agent` does plus a `slug` from its name, `task`, `description`, `accounts`, creates each routine as a `team` routine through `create_routine`, sets `agent_id` and `status = 'started'`, all in one transaction), `abandon_agent_draft(draft)`.
- **«Que empiece» goes through the engine**, `POST /agent-drafts/:id/start`: it calls `start_agent_draft` as the person, then, when the organisation has a record, commits `agentes/<slug>/AGENTS.md` with the instructions in the person's name (as the engine's other write-backs) and sets `task_in_record`. Without a record, `task` stays the row's own, and record provisioning writes the file when the record is created. A failed commit leaves the agent working from the row and retries with the write-back queue.
- **`systemPrompt` reads `task`.** When an agent has instructions they replace its ghost's one-line job in the prompt; the one-liner stays for agents without instructions (*my call*).
- **Classification (rule 6).** `update_agent_draft` changes nothing live, so the main agent writes it directly, without an approval card. That is a new class in `settings.ts` next to «the agent may propose it» and `never`: *the agent may write it, because it is a draft*. The other three are `never` for agents (a person presses the buttons). The reason goes in [agent-settings.md](../ongoing/agent-settings.md) in the same PR.
- **The engine.** A tool `agent_draft_update` for the main agent, only in a thread that has a draft, calling `update_agent_draft` as the person (`asPerson`, like the settings tools). The builder lines added to its system prompt: you are creating an agent with this person; after the first message, fill everything you can and say what you assumed; then ask one question at a time, only what changes the agent; write the instructions in Spanish, second person, including what it does alone, what it brings to a person and how often it asks for feedback; when it needs an account the organisation hasn't connected, ask for it with the connector card ([connector-in-chat.md](../ongoing/connector-in-chat.md)); turn timetables into routine fields, and say so when the person's words don't fit them (below).
- **Timetables that don't fit.** Routines allow days of the week or a day of the month, at most once a day. «Cada 5 días» doesn't fit; the main agent proposes the nearest («lunes y viernes») and says why.

### The screen «Nuevo agente» (slice 2)

```
 ✕  Nuevo agente
 ┌──────────────────────────────┐
 │ 👻  Facturas                 │   card: collapsed to one line with ✓/… per part,
 │ Qué hace ✓ · Conectores …    │   expands on tap to every field
 │ Cuándo ✓ · Te pregunta —     │
 └──────────────────────────────┘
   ¿Dónde llegan las facturas?        ← main agent
            A info@, y Drive  →       ← person
   [ Gmail · info@   Conectar ]       ← connector card
 ┌────────────────────────┐ 🎙
 │ Escribe…               │
 └────────────────────────┘
 [ Probar ]        [ Que empiece ]
```

- **First step**, before any thread: «¿Qué quieres que haga?», a large text box, the mic, and the examples as chips (Correo, Finanzas, Redes, Productor, Incorporación) that fill the box with a starting description. «Seguir» calls `create_agent_draft` and the person's text is the thread's first message.
- **Then** the card on top, the conversation below (the chat's own components), and two actions: «Probar» (slice 3) and «Que empiece» (enabled once the draft has a name and instructions). On a desktop, card and conversation side by side.
- **Leaving** keeps the draft `open`; Equipo shows it as a quiet row «Agente a medio crear» that reopens the screen (*my call*). The owner can discard it there (`abandon_agent_draft`).
- «Añadir agente» on Equipo opens this screen directly. `anadir-agente.tsx` and `contratar.tsx` go, and with them `vacancies()`. «Que empiece» ends on the new agent's chat, with its hello as today.

### The trial (slice 3)

- `POST /agent-drafts/:id/trial` (owner): builds a chat agent from the draft (name, department, `task`, `accounts`) and runs one turn: «haz una pasada de prueba: qué harías hoy y qué me traerías». Only read tools; tools that write are left out of the turn entirely, so nothing is even proposed. The answer is stored in `trial` and shown in the card; the main agent's thread gets a line pointing at it.
- Spends the organisation's AI account like any turn. At most one trial running per draft.

### The card and «Ajustar» (slice 4)

- `agente/[id].tsx` gets «Cómo trabaja»: the description, «Instrucciones» (a screen with the full text, read-only in this plan), the agent's routines (from [agent-routines.md](../ongoing/agent-routines.md), which already adds a «Rutinas» row), and «Ajustar con <main agent>». «Herramientas» is renamed «Conectores», the word the conversation uses.
- **«Ajustar con …»** opens the agent's creation thread. An agent made before this plan has none; the first tap creates one (a draft with `status = 'started'` pointing at the agent, its fields copied from the row).
- In a started draft's thread the main agent no longer writes the draft: it proposes changes to the live agent with a new settings tool, `settings_update_agent` (`name`, `ghost`, `department`, `description`, `task`), an «Aprobar» card that shows before and after. Routines and accounts go through their existing tools.
- **Talking to the agent itself:** every agent gets `settings_update_self`, the same fields for itself only, as a proposal. It never touches its accounts, who can see it or its routines' audience (the hard limits of [agent-settings.md](../ongoing/agent-settings.md)).
- **Approving a change to `task`** (from either tool) runs through the engine like «Que empiece»: a commit to `agentes/<slug>/AGENTS.md` when the organisation has a record, which the sync then projects into `task`; the row only when it has none. Writing the row of an agent with `task_in_record` would be overwritten on the next tick, so it never happens.

## Open

- **The main agent's name** (Jaime). Candidates on the table: Médium, Mayordomo, Anfitrión, Jefe de equipo, Ghostaff. Not «Secretaría».
- **The product plan** (`ordago-app/business`, `ghostaff-producto.md`): «Agentes a medida» and decision 13 (departments as the entry point) are answered here and need updating there.

## Slices

Each its own pull request, landed with `pnpm pr:land`, with its Maestro flow (`.maestro/flows/ci/`) updated in the same PR.

1. **The main agent as a role**: `is_main`, `hire_main_agent`, `isMainAgent`, `delete_agent` refusal, the job text, `MAIN_AGENT_NAME`. pgTAP: one main per organisation, the main can't be removed, a new space has one.
2. **Drafts and «Nuevo agente»**: table, functions, classification, the engine tool and builder lines, the screen, Equipo's «Añadir agente» and the open-draft row; `anadir-agente.tsx`, `contratar.tsx` removed. `create-company.yaml` adds an agent through the new screen (with the engine faked as the existing flows do).
3. **The trial.**
4. **The card and «Ajustar»**: «Cómo trabaja», the instructions screen, «Conectores», `settings_update_agent`, `settings_update_self`.

Slice 2 depends on routines' functions ([agent-routines.md](../ongoing/agent-routines.md)) for the draft's timetables; if they haven't landed, the draft's `routines` waits and is applied when they do.

## Changes other plans

- [ordago-as-customer.md](../ongoing/ordago-as-customer.md): front 4 (the organisation's assistant) is the main agent of decision 6, not a separate agent; front 5 is this plan.
- [agent-settings.md](../ongoing/agent-settings.md): the main agent is `is_main`, not the ghost; the new class «the agent may write it, because it is a draft».
- [welcome-and-spaces.md](../ongoing/welcome-and-spaces.md) decision 6: every new space starts with the main agent, under its role.
- [agent-routines.md](../ongoing/agent-routines.md): «Not at hiring» changes; the creation conversation sets an agent's first routines.
- [agent-templates.md](../ideas/agent-templates.md): the examples of «Nuevo agente» are where templates will live.
- [swipe-to-hire.md](swipe-to-hire.md): built on the vacancies this plan removes; it would deal examples instead.

## Build slice 1: the main agent as a role

> **For agentic workers:** use superpowers:subagent-driven-development or superpowers:executing-plans to work through these tasks. Steps are `- [ ]` checkboxes. Work in a worktree off `develop` (AGENTS.md, Branches) and land with `pnpm pr:land`.

**Goal:** «main agent» is a row's role (`agents.is_main`), not the `secretaria` ghost: one per organisation, never removed, hired with every new space, and hired by the migration where an organisation has no chat agent to take it.

**Architecture:** a migration adds the column, a backfill function that is also what pgTAP tests, and moves the hiring into `hire_main_agent`. Every reader of «the ghost is `secretaria`» (shared, engine, app) reads `isMain` instead.

**Tech stack:** Postgres migrations and pgTAP (`pnpm db:test`), `@ghostaff/shared` and `@ghostaff/engine` on vitest, `ghostaff-mobile` on jest.

### Global constraints

- `MAIN_AGENT_NAME = 'Secretaría'` until Jaime picks the name. The SQL repeats it in one place, `hire_main_agent`, with a comment pointing at the constant.
- The main agent's job (`AGENT_JOBS.secretaria.job`): «Lleva tu equipo: crea contigo los agentes que necesitas y conoce cómo trabaja la empresa.»
- Error for removing the main agent: `'the main agent stays'`, errcode `42501`.
- Code and comments in English; anything a person sees in Spanish (AGENTS.md rule 5).

### Review focus

1. **Órdago:** an organisation whose only `secretaria` agent runs as a job (`runner` `ordago_job` or `ghostaff`) gets a **new** chat main agent; the job agent stays non-main (Task 1 test).
2. **An organisation that removed Secretaría** gets a new main agent (Task 1 test).
3. **A custom agent drawn as the `secretaria` ghost** is not main: no settings tools, no hello, `member_default` `read` (Tasks 1, 3, 4 tests).
4. **Correo stops writing `memoria/empresa/`:** `hookAgents` gives the right only to `isMain`; runner.ts rewrites the hook on every run, so it applies at Correo's next run (Task 3 test).
5. **Removing the main agent** is refused by the database, and its card has no «Quitar del equipo» (Tasks 1, 4).

---

### Task 1: the role in the database

**Files:**
- Create: `supabase/migrations/20261126200000_main_agent.sql`
- Create: `supabase/tests/database/main_agent.test.sql`
- Modify: `supabase/tests/database/spaces.test.sql` (the «Secretaría hired» assertions check `is_main`)

**Produces:** `agents.is_main boolean not null default false`; unique index `agents_one_main on public.agents (org_id) where is_main`; internal `public.ensure_main_agent(target_org uuid) returns uuid` (the main agent's id); internal `public.hire_main_agent(target_org uuid) returns uuid`; `create_organization` and `create_personal_space` calling `hire_main_agent` instead of `hire_secretaria` (dropped); `delete_agent` refusing the main agent; `create_agent` always inserting `member_default = 'read'`.

- [ ] **Step 1: write `main_agent.test.sql`** (same setup as `spaces.test.sql`: users in `auth.users`, `set local role authenticated`, jwt claims). Assertions:
  - `create_organization('Taller')` → exactly one agent with `is_main`, named `Secretaría`, ghost `secretaria`, `member_default` `talk`; same for `create_personal_space()`.
  - inserting a second `is_main` agent in that org (as `postgres`) → `throws_ok(..., '23505')`.
  - `delete_agent(<main id>)` as the owner → `throws_ok(..., '42501', 'the main agent stays')`; `delete_agent` on another agent of the org → `lives_ok`.
  - `create_agent(org, 'Otra', 'secretaria', 'direccion')` → `is_main = false`, `member_default = 'read'`.
  - `ensure_main_agent` (as `postgres`), on three orgs inserted by hand: one with a chat `secretaria` agent → that agent becomes main, no new row; one with only a `ghostaff`-runner `secretaria` agent with a slug (Órdago's Correo) → a new chat agent named `Secretaría` is main, Correo is not; one with no agents → a new main agent. Called twice on the same org → same id, no extra row.
  - `ensure_main_agent` and `hire_main_agent` not executable by `authenticated` (`throws_ok(..., '42501')`).
- [ ] **Step 2:** `pnpm db:test` → the new file fails (no column, no functions).
- [ ] **Step 3: write the migration.** In order: the column and the index; `hire_main_agent` (insert as `hire_secretaria` did, plus `is_main = true`, `created_by` = the organisation's `created_by` so it also works with no `auth.uid()`); `ensure_main_agent` (if a main exists return it; else mark the oldest `secretaria` agent with `runner = 'chat'`; else `hire_main_agent`); `create or replace` of `create_organization` and `create_personal_space` with their bodies from `20261122300000_spaces.sql` and `hire_main_agent` in place of `hire_secretaria`; `drop function public.hire_secretaria(uuid)`; `delete_agent` and `create_agent` with the changes above; then the backfill: `select public.ensure_main_agent(id) from public.organizations`. Revoke execute on both internal functions from `public, anon, authenticated`.
- [ ] **Step 4:** update `spaces.test.sql`'s two «Secretaría hired» `results_eq` to also select `is_main` (`true`).
- [ ] **Step 5:** `pnpm db:reset && pnpm db:test` → all pass. Then, on the local database, `select count(*) from public.organizations o where not exists (select 1 from public.agents a where a.org_id = o.id and a.is_main)` → `0`.
- [ ] **Step 6:** commit `feat(db): the main agent is a role, one per organisation, never removed`.

### Task 2: the role in `@ghostaff/shared`

**Files:**
- Modify: `packages/shared/src/models/index.ts` (`Agent.isMain`, `MAIN_AGENT_NAME`, `AGENT_JOBS.secretaria.job`)
- Modify: `packages/shared/src/services/index.ts` (`AgentRow.is_main`, `agentFromRow`, `AGENT_COLUMNS`)
- Modify: `packages/shared/src/services/settings.ts:480-483`
- Create: `packages/shared/test/mainAgent.test.ts`

**Consumes:** `agents.is_main` (Task 1). **Produces:** `Agent.isMain: boolean`; `export const MAIN_AGENT_NAME = 'Secretaría'` (models); `isMainAgent(a: { isMain?: boolean | null }): boolean`, true only for `isMain === true`.

- [ ] **Step 1: test** `isMainAgent({ isMain: true })` is `true`; `isMainAgent({ isMain: false })` and `isMainAgent({})` are `false`; `agentFromRow({ ...row, ghost: 'secretaria', is_main: false }).isMain` is `false`, and `true` for `is_main: true`.
- [ ] **Step 2:** `pnpm --filter @ghostaff/shared test` → fails.
- [ ] **Step 3:** implement; `settings_read` and the settings tools keep calling `isMainAgent`, now by role. `pnpm check` will fail in engine and mobile until Tasks 3 and 4; that is expected inside this branch.
- [ ] **Step 4:** `pnpm --filter @ghostaff/shared test` → passes. Commit `feat(shared): isMainAgent reads the role`.

### Task 3: the role in the engine

**Files:**
- Modify: `apps/engine/src/chat.ts` (`ChatAgent.isMain?: boolean`), `apps/engine/src/chatStore.ts:37-42` (select `is_main`, map to `isMain`)
- Modify: `apps/engine/src/recordProvision.ts` (`RecordAgent.isMain` replaces `ghost`; `hookAgents`; `recordSeed` says the main agent keeps `memoria/empresa/`, using `MAIN_AGENT_NAME`), `apps/engine/src/recordStore.ts:85-95` (select `is_main`)
- Test: `apps/engine/test/chat.test.ts`, `apps/engine/test/recordStore.test.ts`, `apps/engine/test/settings.test.ts` (fixtures gain `isMain` / `is_main`)

**Consumes:** `isMainAgent`, `MAIN_AGENT_NAME` (Task 2).

- [ ] **Step 1: tests.** `recordStore.test.ts`: `hookAgents` gives `writesCompany: true` to `{ isMain: true }` and `false` to a `{ isMain: false }` agent with slug `correo`. `chat.test.ts`: the existing Secretaría fixture becomes `isMain: true` and keeps its settings tools; a new case, a ChatAgent with ghost `secretaria` and `isMain: false`, gets no `settings_*` tools.
- [ ] **Step 2:** `pnpm --filter @ghostaff/engine test` → the new cases fail.
- [ ] **Step 3:** implement. `apps/engine/test/settings.test.ts` must still pass with every database function classified.
- [ ] **Step 4:** `pnpm --filter @ghostaff/engine test` → passes. Commit `feat(engine): settings and the company's memory follow the main agent's role`.

### Task 4: the role in the app, and landing

**Files:**
- Modify: `apps/mobile/lib/firstHello.ts:20-45` (agents typed `{ id: string; orgId: string; isMain: boolean }`; finds the main agent by `isMain`)
- Modify: `apps/mobile/app/(app)/agente/[id].tsx` (no «Quitar del equipo» when `agent.isMain`)
- Test: `apps/mobile/__tests__/firstHello.test.ts`, `apps/mobile/__tests__/useFirstHello.test.tsx`, `apps/mobile/__tests__/chat.test.ts` (fixtures gain `isMain`)
- Modify: `docs/plans/ongoing/agent-settings.md` (decision 2: `is_main`, not the ghost), `docs/plans/ongoing/welcome-and-spaces.md` (decision 6: `hire_main_agent`)

**Consumes:** `Agent.isMain` (Task 2).

- [ ] **Step 1: tests.** `firstHello.test.ts`: the fixture is `{ id: 'a1', orgId: 's1', isMain: true }`; a new case where the only agent is ghost `secretaria` with `isMain: false` → `hello` is never called. `chat.test.ts`: team ordering puts the `isMain` agent first even when it is not drawn as `secretaria`.
- [ ] **Step 2:** `pnpm --filter ghostaff-mobile test` → the new cases fail.
- [ ] **Step 3:** implement; update the two plans.
- [ ] **Step 4:** `pnpm check` and `pnpm db:test` → pass. `pnpm e2e` → `create-company.yaml` and `create-personal.yaml` pass unchanged.
- [ ] **Step 5:** on the web against the local stack (`ghostaff-web-local`): a new company's Equipo shows Secretaría first; her card has no «Quitar del equipo»; another agent's card has it.
- [ ] **Step 6:** commit `feat(app): the main agent by its role, and it can't be removed`; `pnpm pr:land` until it exits `0`.
