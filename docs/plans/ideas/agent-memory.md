# Agent memory: stores every agent reads and writes, and a screen to see and fix them

**Priority:** medium — people trust an agent they can check and correct; today the chat agents forget everything outside the thread, so there is nothing to show yet
**Gate:** decision:Jaime — the six decisions below (copy Claude Managed Agents' model or use the service, one kind of agent, the default stores, write access, who edits, the limits)
**Next:** Jaime picks the decisions below; then write the File Structure and Tasks against that day's code and build it

**Goal:** Every agent, whether people talk to it or it runs on a timetable, reads and writes memory stores that outlive a conversation; people see each store in the app and correct or delete what is in it, and feedback given in a chat reaches the agent's next scheduled run.

## Context

As of `7129d4d` (2026-11-23). Jaime's Trello card «revisar memoria behind the scenes»: he wants to **see what the agent remembers**. Reviewing a first draft (decisions per agent and per person, a `recordar` tool, short sentences), he asked (2026-11-23) to model it on Claude Managed Agents: memory per session plus memory stores, read-only or read-write, with limits, and that an agent on a timetable can still be talked to, to change its behaviour or give it feedback.

**What agents remember today.** `agents.runner` decides how an agent runs, and memory depends on it:

- **Chat agents** (`runner = 'chat'`: Secretaría and every agent hired in Equipo). Each message is one model call from the engine (`apps/engine/src/chat.ts`) with a fixed system prompt and the thread's last 40 messages. No files, no timetable. On the Claude subscription path, `claudeCode.ts` runs Claude Code in a throwaway `HOME`, so its own memory is deleted too. **Nothing survives the thread.**
- **Runner agents** (`runner = 'ordago_job' | 'ghostaff'`: Órdago's twelve, Legal first). Each message or timetable tick starts a container that clones the record (git), runs Claude Code for minutes and pushes. `composePrompt` (`apps/engine/src/runner.ts`) tells them to read `AGENTS.md` and `agentes/<slug>/` and, before ending, to write «what should still be true tomorrow». **Their memory is free-form Markdown in the record**, and the app does not show it. Only organisations with a GitHub record connector (today, Órdago) can have them.

So the two halves of an agent are split by kind: chat agents can be talked to quickly but forget; runner agents remember and keep a timetable but only where a record exists.

## How Claude Managed Agents does it (read 2026-11-23)

From [Using agent memory](https://platform.claude.com/docs/en/managed-agents/memory) and the scheduled deployments docs:

- **An agent** is one stored config (model, prompt, tools). **A session** is one run of it, a conversation or a scheduled firing; by default a session sees nothing from earlier sessions. **A deployment** adds a cron schedule to an agent: each firing creates a session. The agent is the same whether you talk to it or it runs on a schedule.
- **A memory store** is a collection of small text documents, each addressed by a path, that outlives sessions. Up to **8 stores per session**; up to **10,000 memories per store**; **100 kB per memory**. The docs advise many small files and focused stores: one per user, one for shared knowledge, one per project.
- **Stores attach per session**, each `read_write` (the default) or `read_only`, with `instructions` for that session. The agent sees each store as a folder (`/mnt/memory/<store>/`) and uses its ordinary file tools; a note in the system prompt tells it what is mounted.
- **Every change is a version** (created, modified, deleted), with who made it (a session, the API or a person). A version can be read, rolled back or redacted (for a leaked secret or personal data). Versions are kept 30 days, the recent ones of a live memory always.
- **Their warning:** an agent that reads untrusted input (mail, web pages, a tool's output) can be prompt-injected into writing to a `read_write` store, and later sessions read that as trusted memory. Use `read_only` wherever the agent need not write.
- Memory stores are not eligible for zero data retention: they live on Anthropic's servers.

## Design (with my picks; the decisions are below)

**Copy the model, on our own storage** (decision 1). The words in the app: «Memoria» for a store, «recuerdo» for one document in it.

**One agent, talkable and optionally on a timetable** (decision 2). As in Managed Agents, an agent is one thing: you can always write to it, and a timetable is an option you add (`agents.schedule`, which exists). Nobody picks «chat or job» when creating an agent; whether a turn runs as a quick model call or in a container is the engine's choice, by what the turn needs. A conversation and a scheduled run are both **sessions**. A session's own memory is its conversation, which exists. This needs its own plan; memory does not wait for it, but it is built so both kinds read and write the same stores.

**The stores every organisation gets** (decision 3), created with the organisation, the agent and the person:

| Store | What goes in | Attached to |
|---|---|---|
| **Empresa** | What the organisation is and how it works: customers, suppliers, prices, how it invoices, rules agreed («los pedidos de más de 500 € los aprueba Ana») | every session of every agent |
| **{Agente}** (one per agent) | How this agent does its job and the feedback it got («el informe, los viernes y en tres líneas», «no cuentes las devoluciones como ventas») | every session of that agent, scheduled runs included |
| **{Persona}** (one per person) | That person's preferences and context («prefiere audio», «lleva las cuentas de Madrid») | only sessions where that person talks: their personal chat. Never a scheduled run, never a shared thread |

This is how feedback reaches a scheduled agent: you write to Finanzas «el informe, mejor en tres líneas»; it saves that in its own store; its Friday run reads the store and writes three lines.

**Write access** (decision 4): each agent writes its own store and the person's store in that person's chat; **Empresa is `read_only` for every agent except Secretaría**, which keeps it. Another agent that learns something about the organisation says so in its reply and asks Secretaría (by mention) to keep it. This follows Managed Agents' warning: the agents that read mail, reviews and web pages are exactly the ones that should not write what every other agent trusts.

**Storage:** two tables, `memories` (`org_id`, `store_id`, `path`, `content`, `updated_at`) and `memory_versions` (every create, change and delete, with the actor: an agent's session or a person), plus `memory_stores` (`org_id`, `kind`: `company` | `agent` | `person`, `agent_id` or `user_id`). Row-level security and pgTAP on all three. The app writes only through `security definer` functions (`edit_memory`, `forget_memory`, `restore_memory_version`); the engine writes an agent's memory with the service role. These are files with history, which is what invariant 4 asks of what agents work on; when Ghostaff's own record store exists, a store can become a `memoria/<store>/` folder of the record, with the tables as its projection, as `por-decidir/` is today.

**How agents use it:**
- **Chat turns:** tools named and shaped like Anthropic's memory tool (`view`, `create`, `str_replace`, `delete` on `/memoria/<store>/…`), served by the engine on our tables, given through `mergeTools` beside the settings tools, so they work on all three paths (Vertex, API key, the subscription's `claude -p`). No owner approval: they change nothing outside Ghostaff. The system prompt lists the attached stores with their access and the paths in each (not the contents), as Managed Agents does.
- **Runner turns:** the engine adds the attached stores to the run's spec; the runner writes them to `~/memoria/<store>/` before Claude Code starts, makes the `read_only` ones read-only, and sends back what changed when it reports. The engine applies the changes with a precondition on each memory's hash (a concurrent edit wins and the run's change is reported, not lost silently).
- **The chat shows it:** when a turn wrote to memory, the reply's status line says so («Guardado en tu memoria: informe en tres líneas»), with a tap to the memory. Nothing is learnt behind anyone's back.

**The screens:**
- Equipo → agent → **Memoria** (a row beside «Quién puede» and «Herramientas»): the stores that agent reads, each with its access («Lee y escribe» / «Solo lee») and how many recuerdos it holds. A store opens a list of its recuerdos (the first line and «hace 3 días · Finanzas, en tu chat»); one opens to read it, correct it or «Olvidar». «Historial» is folded under it, with «Volver a esta versión».
- Empresa → **Memoria de la empresa**: the Empresa store, the same screens.
- Empty state: «{Agente} aún no recuerda nada. Lo que le cuentes y deba seguir sabiendo, aparecerá aquí».

**Who sees and edits** (decision 5):

| Store | Sees it | Corrects, deletes, restores |
|---|---|---|
| Empresa | every member | owners |
| {Agente} | whoever may read the agent | owners |
| {Persona} | only that person | only that person |

Owners do not see someone else's personal store: it comes from a personal chat, which is private.

**Limits** (decision 6): 8 stores per session (as Managed Agents; we use at most 3 today), 1,000 recuerdos per store and 10 kB per recuerdo (smaller than Managed Agents' 10,000 and 100 kB: these are read and corrected on a phone, and a chat turn pays for what it reads). At the limit, a write fails with a message telling the agent to merge or forget first. Versions kept 30 days, as there.

## Open questions (decisions for Jaime)

1. **Copy the model or use the service.**
   - **a) Copy Managed Agents' model on our own tables** (my pick). Memory is organisation data: invariant 2 wants it in the EU on storage we own, with an export; it must work the same whether the organisation answers with its Claude subscription, its key or Vertex; and the app needs row-level security per person, which a store on Anthropic's side does not know.
   - b) Use Managed Agents' memory stores themselves: less to build and its versioning for free, but the data sits on Anthropic's servers (not EU-only, not eligible for zero retention), it needs an Anthropic API key per organisation, and our chat agents don't run as Managed Agents sessions.
2. **One kind of agent, always talkable, timetable optional** (my pick), in its own plan, with memory built for both kinds now; or keep «chat» and «runner» as kinds people pick.
3. **Three default stores** (my pick: Empresa, one per agent, one per person); or only Empresa and one per agent, with nothing per person.
4. **Empresa read-only for every agent but Secretaría** (my pick); or read-write for all, every change versioned and revertible (more learning, more exposure to injection).
5. **Owners edit Empresa and agent stores; each person edits only their own** (my pick); or anyone who may talk to the agent edits its store.
6. **Limits:** 8 stores per session, 1,000 recuerdos per store, 10 kB each, versions 30 days (my pick); or Managed Agents' own 10,000 and 100 kB.

## Out of scope

- Stores people create and attach by hand (a «Catálogo» store, a project store). The model allows it; the screens come once someone needs one.
- Memory shared across organisations.
- Secretaría changing who can read a store or attaching stores: classified `never` in `settings.ts` until stores are something people configure.

## Testing strategy

pgTAP: another organisation sees and changes nothing; a member never sees someone else's personal store; a member who may not read an agent sees none of its store; only owners edit Empresa and agent stores; every change writes a version. Vitest in the engine: the tools on each store respect `read_only`; a shared thread never gets a personal store; a scheduled run gets Empresa and its own store only; the limit errors; a run's changes applied with the hash precondition. Runner: the stores written to `~/memoria/`, read-only ones not writable, changes reported. Jest on the screens' four states. A Maestro flow on a seeded store (CI runs no engine or model): open the agent, Memoria, a recuerdo, correct it, forget it.
