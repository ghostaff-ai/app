# Agent memory: see, correct and delete what an agent remembers

**Priority:** medium — people trust an agent they can check; today the chat agents forget everything outside the thread, so there is nothing to show yet
**Gate:** decision:Jaime — the six decisions below (where memory lives, whose it is, who sees and edits it, how it learns, the runner agents, limits)
**Next:** Jaime picks the decisions below; then write the File Structure and Tasks against that day's code and build it in one PR

**Goal:** Each agent keeps what it learns about the organisation and about the person it talks to, and the person sees it in the agent's screen, where they can correct or delete any of it.

## Context

As of `2b76f7c` (2026-11-23). Jaime's Trello card «revisar memoria behind the scenes», clarified: he wants to **see what the agent remembers**.

**There is no persistent memory for the chat agents today.** What each kind of agent knows:

- **Chat agents** (`agents.runner = 'chat'`: Secretaría and every agent hired in Equipo). `apps/engine/src/chat.ts` gives the model a fixed system prompt (`systemPrompt`: name, job, the accounts it may use, today's date) and the thread's last 40 messages (`recentMessages(thread.id, 40)`). Nothing is saved between threads: in a new conversation, or in another person's personal chat, the agent knows nothing. On the Claude subscription path, `claudeCode.ts` runs Claude Code in a throwaway `HOME` deleted after the run, so Claude Code's own memory is discarded too. Their prompt says they have no record.
- **Runner agents** (`runner = 'ordago_job' | 'ghostaff'`: Órdago's twelve, Legal first). Their memory is the record, a git repo: `composePrompt` in `apps/engine/src/runner.ts` tells them to read the record's `AGENTS.md` and `agentes/<slug>/`, and before ending «what should still be true tomorrow, write it, commit and push». That is free-form Markdown, with history, written per the record's own `AGENTS.md`. The app does not show it: Registro (Empresa) shows only what was decided.
- **Organisations without a record** (every new customer until Ghostaff's own record store exists, ordago-agents-in-ghostaff.md step 6) have nowhere an agent could write files.

So «see what the agent remembers» needs two things, in this order: chat agents that remember, and a screen that shows it.

**What it must respect:**
- Personal chats (`threads.personal_of`, `20261123200000_personal_chats.sql`): only that person and the agent see them. What the agent learns there about the person must not leak to others.
- Invariant 4: agents work on files with history; the app reads the database. Rule 2: `org_id`, row-level security and a pgTAP test on every table with an organisation's data; the app writes only through `security definer` functions. Rule 6: every new database function is classified in `packages/shared/src/services/settings.ts` (the main agent may propose it, or `never` with a reason).
- UI: one main action per screen, fold the rest, plain words, every state designed.

## Design (with my picks; the decisions are below)

**A memory is a short sentence an agent keeps**, with a scope:
- **Sobre la organización**: a fact about the organisation («Facturamos por trimestres», «El proveedor de café es Ana»).
- **Sobre ti**: a fact about one person, learned in their chat («Prefiere resúmenes de tres líneas»). Only that person sees it, and the agent uses it only when talking to that person.

Each memory keeps the agent that learnt it, when, and the conversation it came from (a link back to the message).

**Storage:** a table `agent_memories` (`org_id`, `agent_id`, `about_user` null for organisation memories, `body` up to 300 characters, `source_message_id`, `created_at`, `updated_at`), row-level security, pgTAP tests. Reads through `@ghostaff/shared/services`; the app's writes through `edit_memory` and `forget_memory` (`security definer`). The engine writes the agent's own memories with the service role.

**How an agent learns:** a tool `recordar` (and `olvidar`), given to every chat agent through `mergeTools` like the settings tools. No owner approval: it changes nothing outside Ghostaff. When the agent saves something, the reply shows a quiet status line, «Lo recordaré: …», with a tap that opens the memory screen. So nothing is learnt behind the person's back. Saying «recuerda que…» or «olvida que…» in the chat is how a person adds or removes one; no «Añadir» button.

**How an agent uses it:** `systemPrompt` gets a block «Lo que recuerdas» with the agent's organisation memories and, in a personal chat, that person's; capped (see decision 6). In a shared thread, no personal memories at all.

**Where the screen lives:** the agent's screen (`agente/[id]`) gets a row «Memoria» (`Lo que ${agent.name} recuerda`), beside «Quién puede» and «Herramientas», and visible to whoever may read the agent, not only owners. It opens `memoria/[id]`: two short lists, «Sobre ti» first, then «Sobre {organización}»; each row is the sentence and, quieter, «hace 3 días · en vuestra conversación». A tap opens it to correct the text or «Olvidar». Empty state: «{Agente} aún no recuerda nada. Cuando le cuentes algo que deba saber, lo verás aquí».

**Who sees and edits what:**

| Memory | Sees it | Corrects or deletes it |
|---|---|---|
| Sobre ti | only you | only you |
| Sobre la organización | everyone who may read the agent | owners, and the person whose conversation it came from |

Owners do not see another person's «Sobre ti»: a personal chat is private, and so is what came out of it.

## Open questions (decisions for Jaime)

1. **Where memory lives.**
   - **a) A database table now** (my pick): works today for every organisation and every chat agent, and the screen reads it like everything else. When Ghostaff's own record store exists, the record gets a `memoria/` folder in a format defined in `packages/shared/src/record/` and the table becomes its projection, as `por-decidir/` is today.
   - b) Files in the record from day one: one master and history for free, but only organisations with a GitHub record connector (today, Órdago) would have memory, and chat agents would need record access first.
2. **Whose memory.**
   - **a) Each agent its own** (my pick): what the card asks («what each agent has learnt»); Finanzas does not carry Marketing's notes, and deleting one is clear.
   - b) One organisation memory every agent reads: fewer duplicates, but nobody can say which agent believes what.
3. **Who corrects or deletes organisation memory.**
   - **a) Owners, plus the person it came from** (my pick).
   - b) Anyone who may talk to the agent: faster, but one member can erase what another taught it.
4. **How it learns.**
   - **a) An explicit tool, announced in the chat** («Lo recordaré: …») (my pick): visible, testable, and the person can correct it on the spot.
   - b) An automatic pass at the end of each conversation that extracts facts: remembers more, but behind the scenes, which is what the card wants to undo.
5. **Runner agents (Órdago's, Legal).**
   - **a) Out of this first version** (my pick): their memory is free-form Markdown in the record, written by the record's own rules; it comes into the same screen when the record store and `memoria/` exist (decision 1a).
   - b) Show their `agentes/<slug>/` files read-only in the same screen now: honest, but it is a file viewer, not a list one can correct.
6. **Limits.** My pick: up to 300 characters per memory and 50 per agent and scope; past that the agent must merge or forget before saving, and the prompt carries all of them (no search). Revisit with real use.

## Out of scope

- Memory shared across organisations, or about people outside the organisation (external-parties.md).
- A memory view across all agents («what Ghostaff knows about me»): a later row in Empresa if people ask for it.
- Secretaría editing other agents' memory: `edit_memory` and `forget_memory` are classified `never` in `settings.ts`, because a person's correction is theirs and each agent writes only its own.

## Testing strategy

pgTAP: a member of another organisation sees and changes nothing; a member never sees another member's «Sobre ti»; a member who may not read the agent sees none of its memories; only owners or the source person edit organisation memories. Vitest in the engine: `recordar`/`olvidar` write the right scope (personal chat → «Sobre ti» allowed; shared thread → organisation only), the cap, and `systemPrompt` never puts personal memories in a shared thread. Jest on the screen's four states. A Maestro flow on a seeded memory (CI runs no engine or model): open the agent, Memoria, correct one, forget it.
