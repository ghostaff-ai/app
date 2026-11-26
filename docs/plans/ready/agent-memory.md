# Agent memory: folders in the record every agent reads and writes, and a screen to see and fix them

**Priority:** medium — people trust an agent they can check and correct; today the chat agents forget everything outside the conversation, so there is nothing to show yet
**Gate:** blocked:business-brain — the Empresa store, its projection and its tools in the chat are built as PR 1 of [business-brain.md](../ongoing/business-brain.md) (Jaime, 2026-11-26); the record store is up on beta ([record-store.md](../ongoing/record-store.md)) (recheck 2026-12-03)
**Next:** each chat agent's own store, read-only in the app, is PR 2 of [agent-context.md](../ongoing/agent-context.md) (2026-11-26); once it lands, write the File Structure and Tasks for the correcting screens and runner agents' stores against that day's code, then «Sobre ti» (decision 7)

**Goal:** Every agent, whether people talk to it or it runs on a timetable, reads and writes memory stores that outlive a conversation; the organisation's and each agent's stores are folders of its record (git), a person's own store is private to them; people see each store in the app and correct or delete what is in it, and feedback given in a chat reaches the agent's next scheduled run. Each agent's instructions are a file of the same record, beside its memory.

## Context

As of `3b86ffa` (2026-11-24). Jaime's Trello card «revisar memoria behind the scenes»: he wants to **see what the agent remembers**. Reviewing the drafts, he asked (2026-11-23) to model it on Claude Managed Agents (memory per session plus memory stores, read-only or read-write, with limits) and that an agent on a timetable can still be talked to. The previous draft put the stores in Postgres; Jaime pointed out (2026-11-24) that it leaves the **one repo per organisation** model ([build-first-version.md](../ongoing/build-first-version.md)), and this rewrite keeps it.

**What agents remember today.** `agents.runner` decides how an agent runs, and memory depends on it:

- **Chat agents** (`runner = 'chat'`: Secretaría and every agent hired in Equipo). Each message is one model call from the engine (`apps/engine/src/chat.ts`) with a fixed system prompt, a summary of the conversation and its latest messages, and a tool to search the rest ([agent-context.md](../ongoing/agent-context.md), since 2026-11-26). Since business-brain's PR 1 they read the Empresa store and Secretaría writes it; since agent-context's PR 2 each one reads its own store at the start of a turn and writes it in the turn, and whoever may see the agent reads it in the app (read-only). Left for this plan: correcting, forgetting and history in the app, runner agents' use of the same folder, and «Sobre ti». On the Claude subscription path, `claudeCode.ts` runs Claude Code in a throwaway `HOME`, so its own memory is deleted too. **Nothing survives the conversation.**
- **Runner agents** (`runner = 'ordago_job' | 'ghostaff'`: Órdago's twelve). Each message or timetable tick starts a container that clones the record, runs Claude Code and pushes. `composePrompt` (`apps/engine/src/runner.ts`) tells them to read `AGENTS.md` and `agentes/<slug>/` and to write «what should still be true tomorrow». **Their memory is free-form Markdown in the record**, the app does not show it, and only organisations with a GitHub record connector (`organizations.record_repo`, today Órdago) can have one. Ghostaff's own record store is step 6 of [ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md), not built; of Órdago's agents only Finanzas has been moved.

**What Jaime and Álvaro said** (WhatsApp, 2026-11-23 and 24, transcribed):
- Agreed: **conversations go to Postgres**, as they do; **the agent's context** (memory, skills, `AGENTS.md`) is something else and lives apart; **no embeddings**, the agent searches by itself (agentic search); Telegram and the notices go, everything is a conversation in Ghostaff; copy Managed Agents' sessions and stores.
- Álvaro: memory as **files in a repo**, readable by a person, exportable, searched with `ls` and `grep`, the way Claude Code works.
- Jaime, first: a key-value in Postgres, because a folder with one file per person is an anti-pattern and private data should not sit in a shared repo. Then (2026-11-24): the repo is cloned once and worked on locally, and a technical member could talk to the agents from their own Claude Code.
- Álvaro: **one conversation per agent**, like a WhatsApp chat, compacted as it grows. [chat-permissions.md](../ongoing/chat-permissions.md) decided a private chat per person plus titled conversations; memory works either way, because the stores are what carry what one person told an agent to the next person who talks to it.
- Jaime (2026-11-24): a person who isn't technical doesn't know what a job is; a clock on every agent to say when it runs on its own. That is decision 3.

## How Claude Managed Agents does it (read 2026-11-23)

From [Using agent memory](https://platform.claude.com/docs/en/managed-agents/memory) and the scheduled deployments docs:

- **An agent** is one stored config. **A session** is one run of it, a conversation or a scheduled firing. **A deployment** adds a cron schedule to an agent. The agent is the same whether you talk to it or it runs on a timetable.
- **A memory store** is a collection of small text documents, **each addressed by a path**. Up to 8 stores per session, 10,000 memories per store, 100 kB per memory; many small files and focused stores (one per user, one shared, one per project).
- **The agent sees each attached store as a folder** (`/mnt/memory/<store>/`) and uses its ordinary file tools on it (read, write, edit, grep); there are no memory tools. A note in the system prompt says what is mounted, with each store's access and instructions, not its contents. The docs do not say what the stores are kept in behind the API; what the agent gets is files.
- **Stores attach per session**, `read_write` or `read_only`. **Every change is a version** with its actor, which can be restored or redacted.
- **Their warning:** an agent that reads untrusted input (mail, web pages, a tool's output) can be prompt-injected into writing to a `read_write` store, and later sessions read that as trusted. Use `read_only` wherever the agent need not write.
- Stores live on Anthropic's servers, outside zero data retention.

So Álvaro's files and Managed Agents' stores are the same thing to the agent: folders of small Markdown files, searched by the agent. What we choose is where those folders are kept.

## Design

### Where each store lives (decision 1)

| Store | In the app | What goes in | Kept in | Attached to |
|---|---|---|---|---|
| **Empresa** | «Memoria de la empresa» | What the organisation is and how it works: customers, suppliers, prices, how it invoices, rules agreed («los pedidos de más de 500 € los aprueba Ana») | the record: `memoria/empresa/` | every session of every agent |
| **{Agente}** (one per agent) | «Memoria de Finanzas» | How this agent does its job and the feedback it got («el informe, los viernes y en tres líneas») | the record: `memoria/agentes/<slug>/` | every session of that agent, scheduled runs included |
| **Sobre ti** (one per person) | «Lo que sabe de ti» | That person's preferences and context («prefiere audio», «lleva las cuentas de Madrid») | Postgres, row-level security to that person | only that person's private conversations; never a shared one, never a scheduled run (chat-permissions.md decision 5) |

- **The record is the master** of Empresa and of each agent's store, as it is of `por-decidir/`. The database keeps a **projection** (`memories`: `org_id`, `store`, `path`, `content`, `sha`, `updated_at`) so the app lists and opens them and a chat turn reads them without cloning. The rules are `por-decidir/`'s, in `packages/shared/src/record/`: the record wins; an edit made in the app is written back in one commit on top of the head it read.
- **History is git's.** «Historial» under a recuerdo is the file's commits (who: an agent's run, a person through the app); «Volver a esta versión» is a new commit with that content. No versions table for these stores.
- **What Órdago's agents learnt** moves when each agent moves to Ghostaff (ordago-agents-in-ghostaff.md): the «Indicaciones» and «Aprendizajes» of `agentes/<a>/README.md` become recuerdos in `memoria/agentes/<slug>/`. What the README says about how the agent works goes into its instructions (below).

### The agent's instructions live beside its memory (Jaime, 2026-11-24)

**An agent's prompt is a file of its organisation's record, `agentes/<slug>/AGENTS.md`**, next to its memory, the organisation's `AGENTS.md` and its skills: everything that makes an agent is in the one repo per organisation, with git's history of who changed its instructions and when, and leaves with the export. It replaces the agent row as the prompt's home (decision 2 of ordago-agents-in-ghostaff.md said the row, 2026-11-24; Jaime moved it to the record the same day).

- **`agents.task` becomes its projection**, read from the record by the same sync as `por-decidir/` and the memory, so a chat turn reads it without cloning. Editing it in the app, or by Secretaría after an owner's OK (rule 6, a setting in `settings.ts`), is a write-back commit, the record winning on conflict. The projection is built (#68: `projectInstructions` in the sync, `agents.task_in_record`); the write-back adds `agents.task_sha`, the blob it read, as the commit's base, as `por-decidir/` does.
- **A new agent gets its `agentes/<slug>/AGENTS.md`** when it is created in an organisation with a record, written by the engine as the record's admin (not done yet by #68).
- **A runner turn reads the file from its clone**; `composePrompt` (`apps/engine/src/runner.ts`) points at it instead of carrying `agents.task`.
- **The rest of an agent's settings stay on the row**: its timetable, tools, model and who may see or talk to it. Access is what row-level security enforces, and it must not be a file anyone with a clone could change.
- **Where there is no record yet**, nothing changes: chat agents keep the prompt the engine builds in code (`systemPrompt` in `chat.ts`, `AGENT_JOBS`), and get an `AGENTS.md` of their own when their organisation gets a record (decision 2). An organisation with a GitHub record, Órdago today, can have it now.
- **Writing it is owners' only, as Empresa is**: an agent may propose a change to its own instructions, never make it alone, since a prompt-injected agent rewriting its own prompt is the worst case of Managed Agents' warning.
- **Sobre ti is the one store outside the record**, on purpose: the record is shared by the whole organisation and cloned by every run of every agent, so nothing in it can be private to one person. It is data about a person, like `profiles`, and it is the store Jaime was worried about. A personal space (`organizations.kind = 'personal'`, [welcome-and-spaces.md](../ongoing/welcome-and-spaces.md)) has its own record, so what you keep for yourself there is in its Empresa store.

### Ghostaff's own record store first (decision 2)

Every organisation needs a record for its memory, and today only those that connect a GitHub repo have one. So **Ghostaff's own record store** (Forgejo on our Google Cloud project, in the EU, step 6 of ordago-agents-in-ghostaff.md) is built first, and every organisation, personal spaces included, gets a repo when it is created. Organisations with a GitHub record keep it; the engine reads and writes either through one interface (`recordSync.ts` today speaks only GitHub's API).

It also answers Jaime's worry about private data «en un servidor random»: the record sits on our project, under the same trust as Supabase, and its access is ours to set.

### One agent, talkable and optionally on a timetable (decision 3)

As in Managed Agents, an agent is one thing: you can always write to it, and a timetable is an option, shown as a clock on the agent («Cada viernes a las 9»), which `agents.schedule` already holds. Nobody picks «chat or job» when creating an agent; whether a turn runs as a quick model call or in a container is the engine's choice, by what the turn needs. That plan is [agent-routines.md](../ongoing/agent-routines.md); memory does not wait for it, but both kinds of turn read and write the same stores.

### How agents use it

- **Runner turns** already have the record cloned: Empresa and their own store are folders in it. The engine writes the person's Sobre ti (when the run answers a private conversation) to `~/memoria/sobre-ti/` outside the clone and reads back what changed when the run reports, with a precondition on each file's hash.
- **Chat turns** don't clone. The engine serves the stores as files with tools named and shaped like Anthropic's memory tool (`view`, `create`, `str_replace`, `delete` on `/memoria/<store>/…`): reads from the projection, writes to the projection and, for record stores, a write-back commit, as `answer_decision` does. They go through `mergeTools` beside the settings tools, so they work on Vertex, an API key and the subscription's `claude -p`. No owner approval: they change nothing outside Ghostaff.
- **The system prompt** lists the attached stores with their access and the paths in each, not their contents, as Managed Agents does. The agent opens what it needs.
- **The chat shows it**: when a turn wrote to memory, the reply's status line says so («Guardado en la memoria de Finanzas: informe en tres líneas»), with a tap to it. A write to Empresa from a private conversation is announced in the chat («Lo recordaré para todo el equipo: …»), since the team will see it (chat-permissions.md).

### Write access (decision 4)

Each agent writes its own store, and Sobre ti in that person's private conversation. **Empresa is read-only for every agent except Secretaría**, which keeps it; another agent that learns something about the organisation says so in its reply and asks Secretaría by mention. That follows Managed Agents' warning: the agents that read mail, reviews and web pages are the ones that should not write what every other agent trusts.

The wall is the record store: it refuses a push that touches `memoria/empresa/` from a run whose agent may not write it, and the engine refuses the same write from a chat turn. The runner's guard (`apps/runner/src/guard.ts`) and the record's pre-commit hook tell the agent why, but they are a net, not the wall.

### The screens

- **Equipo → agent → «Memoria»**, a row beside «Quién puede»: the stores that agent reads, each with its access («Lee y escribe» / «Solo lee») and how many recuerdos it holds. A store opens a list of its recuerdos (the first line, and «hace 3 días · Finanzas»); one opens to read it, correct it or «Olvidar». «Historial» is folded under it, with «Volver a esta versión».
- **Empresa → «Memoria de la empresa»**, beside Registro (three-tabs.md decision 1): the Empresa store, the same screens.
- **Empresa (Perfil in a personal space) → «Lo que saben de ti»**: your Sobre ti in this organisation, the same screens without history, shown only to you.
- Empty state: «Finanzas aún no recuerda nada. Lo que le cuentes y deba seguir sabiendo aparecerá aquí».

### Who sees and edits (decision 5)

| Store | Sees it | Corrects, forgets, restores |
|---|---|---|
| Empresa | every member | owners |
| {Agente} | whoever may read the agent | owners |
| Sobre ti | only that person | only that person |

Owners do not see someone else's Sobre ti. Today only agents' runs clone the record; a person with a clone would see every agent's store, so giving one is its own card (Out of scope).

### Limits (decision 6)

8 stores per session (as Managed Agents; we use at most 3), 1,000 recuerdos per store and 10 kB per recuerdo: smaller than Managed Agents' 10,000 and 100 kB, because these are read and corrected on a phone and a chat turn pays for what it reads. At the limit, a write fails with a message telling the agent to merge or forget first. Record stores keep their history as long as the record does; Sobre ti keeps none in the first version.

**Forgetting is not erasing.** «Olvidar» removes a recuerdo from the head, so no agent reads it again, but git keeps it in the history. Purging it (a secret pasted by mistake, a person who asks to be erased) means rewriting the record's history: our operation through the record store, not a button in the app. That is the cost of git, and one more reason Sobre ti is not in it.

## Decisions (Jaime, «OK a todo», 2026-11-24: every pick, the first option of each)

1. **Where memory lives.** (a) Empresa and each agent's store in the record as folders, the database as their projection; Sobre ti in Postgres (my pick). (b) Everything in Postgres, as the previous draft: no record needed, but a second master beside the record, outside the one repo per organisation. (c) Everything in the record, Sobre ti in a repo per person: one place, but a repo per member and per organisation, and the agent's run needs a second clone for each person.
2. **Ghostaff's own record store first, for every organisation** (my pick: Forgejo on our project in the EU, a repo created with each organisation and personal space). Or, for now, a GitHub repo per organisation created by Ghostaff under our GitHub account, which reuses today's code but keeps the data on GitHub, outside the EU (invariant 2), and means moving every repo again later.
3. **One kind of agent, always talkable, timetable optional** (my pick), shown as a clock on the agent, in its own plan; or keep «chat» and «runner» as kinds people pick.
4. **Empresa read-only for every agent but Secretaría** (my pick); or read-write for all, every change in git and revertible (more learning, more exposure to injection).
5. **Owners edit Empresa and agent stores; each person edits only their own Sobre ti** (my pick); or anyone who may talk to the agent edits its store.
6. **Limits:** 8 stores per session, 1,000 recuerdos per store, 10 kB each, Sobre ti without history at first (my pick); or Managed Agents' 10,000 and 100 kB.
7. **Order of work:** the record store, then the projection and the screens on Empresa and agent stores, then Sobre ti (my pick); or Sobre ti first, since it needs no record store and is the store people worry about most.

## Out of scope

- Giving a technical member a clone of the record to talk to the agents from their own Claude Code (Jaime, 2026-11-24). The record allows it; who gets access and how is its own card, since it also lets people work outside the product.
- Stores people create and attach by hand (a «Catálogo», a project store), and memory shared across organisations.
- Secretaría changing who can read a store or attaching stores: classified `never` in `settings.ts` until stores are something people configure.
- Compacting a store that grows too big (Managed Agents' «dreams», in beta); the limit's message asks the agent to merge for now.

## Testing strategy

pgTAP on the projection and Sobre ti: another organisation sees and changes nothing; a member never sees someone else's Sobre ti; a member who may not read an agent sees none of its store; only owners edit Empresa and agent stores. Vitest in shared and the engine: projection and write-back follow `por-decidir/`'s rules (the record wins; an app edit lands as one commit on the head it read); the tools respect read-only; a shared conversation never gets a Sobre ti; a scheduled run gets Empresa and its own store only; the limits fail with their message; a run's Sobre ti changes applied with the hash precondition. Runner: a push touching `memoria/empresa/` from an agent that may not write it is refused. Jest on the screens' four states. A Maestro flow on a seeded store (CI runs no engine or model): open the agent, Memoria, a recuerdo, correct it, forget it.
