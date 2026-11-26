# What a chat agent reads on each turn: a summary, the latest messages and a search, never the whole conversation

**Priority:** high — with one group chat per agent the conversation grows without end, and what a turn carries decides how good and how dear every reply is
**Gate:** none
**Next:** PR 2 on `feat/agent-memory-chat`: each chat agent's own store in the record, read at the start of a turn and written by the agent in it, shown read-only under the agent in Equipo (Tasks, below)

Jaime (2026-11-24), on the line «the engine reads the last 40 messages» in [group-chat-per-agent.md](group-chat-per-agent.md): sending the last 40 messages «no tiene sentido». He decided how it works instead on 2026-11-26 (Decisions, below).

## Today (`develop`, 2026-11-26)

- **Chat agents** (`runner = 'chat'`, Secretaría and every agent hired in Equipo): each message is one model call from the engine with a system prompt and the thread's last 40 messages, `deps.chat.recentMessages(thread.id, 40)` in `apps/engine/src/chat.ts` (`replyInThread`, `goOn`, `answerRoutine`), turned into model turns by `toTurns`. Nothing survives outside those 40.
- **The system prompt carries the time to the minute** (`Ahora es …`, `madridNow` in `systemPrompt`), so no two turns share a prefix and nothing is cached; `streamWith` in `apps/engine/src/chatStore.ts` sends no `cache_control`. `ai_usage` already records `cache_read_tokens` and `cache_write_tokens`.
- **Three providers, one `Writer`**: an API key and Vertex AI go through `streamWith` (the Messages API); the Claude subscription goes through `subscriptionWriter` (`apps/engine/src/claudeWriter.ts`), a fresh `claude -p` per reply, without a session, with the conversation as one text prompt (`transcript`). Neither path compacts.
- **Runner agents** (`runner = 'ordago_job' | 'ghostaff'`) get the last 40 messages as their indication (`runSpec` in `apps/engine/src/runner.ts`, `askJob` in `jobs.ts`) and keep their memory in the record, as Órdago's agents do (`ghostaff-ai/agents`: a fresh `claude -p` per message, only that message, memory in the business repo). This plan does not change them.
- **[agent-memory.md](../ready/agent-memory.md)** (ready, blocked on the record store) puts memory stores in the record; chat agents don't read or write the record yet.

## Decisions

Jaime, 2026-11-26. The first answers came in the morning; in the afternoon he replaced the first one, on seeing that one chat per agent ([group-chat-per-agent.md](group-chat-per-agent.md)) makes a conversation grow without end.

1. **A turn never carries the whole conversation.** «Esto va a crecer hasta el infinito y no podemos estar mandando toda la conversación.» People get one chat per agent on purpose, so they never open a new conversation or think about context: managing it is ours, and it is part of the product. It replaces the morning's answer (the whole conversation, with the API's compaction at 150K tokens), which still let every turn grow to 150K tokens and did nothing on the subscription.
2. **A turn carries a summary, the latest messages word for word, and a search.** The agent's instructions; a summary of everything older, kept in Postgres; the messages after it, up to **about 30K tokens**; and a tool to search the conversation's older messages in Postgres (agentic search, no embeddings, as agreed in [agent-memory.md](../ready/agent-memory.md)). This is the «running summary» of three-tabs.md decision 3; there is no other.
3. **The summary is rewritten in the background** once the latest messages pass the 30K tokens, after the reply is written, so nobody waits for it. It works the same on the three providers.
4. **The agent writes to its memory in the record at the end of each turn**, as runner agents do. It needs chat agents to reach the record ([agent-memory.md](../ready/agent-memory.md)), so it is PR 2, not this one.
5. **Without a record the agent still has its summary, latest messages and search**, only no memory. The record is made with the organisation ([record-store.md](record-store.md), decision 4).

Jaime, 2026-11-26 (evening), on PR 2, once business-brain's PR 1 (ghostaff-ai/app#91) gave chat agents the record:

6. **The agent writes its memory itself, in its own turn**, as runner agents do: it has tools on its own store and its instructions tell it to keep what should still be true tomorrow before it answers. No second call after each reply. Rejected: a pass after every reply deciding what to keep, more reliable but one more call per message, which on the subscription spends its limit twice as fast.
7. **People see what each agent remembers now, read-only**: a «Memoria» row under the agent in Equipo, for whoever may see the agent, on business-brain's screens. Correcting and forgetting stay [agent-memory.md](../ready/agent-memory.md)'s.

How decision 3 is built (the engine's choice, not Jaime's): the summary is written by the organisation's own AI account, through the same `Writer` and account order as a reply, with one prompt of ours. The API's on-demand compaction returns a signed block only the Messages API reads, and the subscription can't run it; Anthropic's docs list «your own summarizer» as a supported shape. One path, one prompt, three providers.

## Numbers

All in `apps/engine/src/context.ts`, estimated as characters ÷ 3 (Spanish runs near that; no token-counting call, which the subscription doesn't have):

- `RECENT_BUDGET = 30_000`: past this, after a reply, the summary is rewritten.
- `KEEP_VERBATIM = 10_000`: the newest messages a new summary leaves out, so a turn right after it still reads the last exchanges word for word.
- `TURN_CEILING = 60_000`: what a turn carries at most while the summary is behind (a summary that failed); older messages wait for the next summary and stay searchable.
- `SUMMARY_PASS = 150_000`: the most one summary pass reads; a longer backlog (a conversation from before this plan) is summarised over several replies, oldest first.

## Caching

The prefix a turn sends is `tools` → `system` → summary → messages, and stays byte-identical while the summary doesn't change: the clock leaves the system prompt and goes into the conversation, each person's message signed with its own date and time (`Ana (mié 26 nov, 10:30): …`), which also tells the agent when each thing was said. `streamWith` asks for automatic caching (top-level `cache_control: { type: 'ephemeral' }`, on the Claude API and Vertex AI alike) and logs, per reply, the input, cache-read and cache-write tokens. The subscription keeps sending one text prompt, which Claude Code caches poorly; that stays as it is (later).

## File Structure

- `supabase/migrations/<ts>_conversation_summaries.sql`: table `conversation_summaries` (`thread_id`, `agent_id`, `org_id`, `summary`, `through_at`, `through_message`, `updated_at`; key `(thread_id, agent_id)`, one per agent and conversation, since each agent reads the conversation as itself); row-level security on with no policy and every grant revoked from `anon` and `authenticated`: only the engine (service role) reads and writes it, because a summary can carry what the agent read with its tools. Function `search_thread_messages(target_thread, words, since, until, max)`, `security definer`, executable by `service_role` only.
- `supabase/tests/database/conversation_summaries.test.sql`: a member of the organisation and one of another see and change nothing; members can't call the search.
- `apps/engine/src/context.ts` (new): the numbers above, `estimateTokens`, `windowOf` (the messages a turn carries), `summaryTurn`, the summary prompt, `summarizeIfLong` (which messages to fold, the call through `writerFor`, saving only when it moves forward), and the `conversation_search` tool.
- `apps/engine/src/chat.ts`: `ChatStore` gains `conversation(threadId, agentId)` (the summary and every message after it), `saveSummary`, `searchMessages`; the three places chat agents read `recentMessages(…, 40)` read the conversation instead; `toTurns` signs people with the time and opens with the summary; `systemPrompt` loses the clock; `reachOf` adds the search tool; after a reply, `summarizeIfLong`.
- `apps/engine/src/chatStore.ts`: the store's new functions; `streamWith` with `cache_control` and the usage log.
- `apps/engine/src/claudeWriter.ts`: nothing (the summary reaches it as the first turn of the transcript).
- Tests: `apps/engine/test/context.test.ts` (new), `apps/engine/test/chat.test.ts`.

## Tasks

### PR 1: summary, latest messages, search, caching — landed

Merged 2026-11-26 as ghostaff-ai/app#81. Still to check on beta: the «chat usage» log shows cache reads on a second reply within five minutes, and a long chat gets a row in `conversation_summaries`.


1. Migration and pgTAP test (File Structure). `pnpm db:test`.
2. `context.ts`, test first: the window under the budget, the ceiling, the summary turn; `summarizeIfLong` folds the oldest messages up to the first unfinished one and leaves `KEEP_VERBATIM`, never saves a summary older than the one stored, fails quietly; the search tool's input checks and output.
3. `ChatStore` and its Supabase implementation.
4. `chat.ts`: chat agents read the conversation (`replyInThread`, `goOn`, `answerRoutine`); job and runner agents keep their 40 messages; `toTurns` with time and summary; `systemPrompt` without the clock (a routine's turn says the time in its own line); the search tool; `summarizeIfLong` after each reply, before the request ends (Cloud Run keeps the CPU only while it is open).
5. `streamWith`: automatic caching and the usage log; a test that two turns of the same conversation send the same prefix.
6. `docs/architecture.md` and [agent-memory.md](../ready/agent-memory.md)'s «Today» say what a turn reads now.

### PR 2: each agent's own memory (decisions 4, 6 and 7)

Against `develop` at `9baa85b` (2026-11-26), after #91. What #91 built: the `memories` projection (Empresa only: `store = 'empresa'`, key `(org_id, store, path)`), `projectMemory` on the tick, `memory.ts`'s four tools (`memory_view`, `memory_search` for every chat agent; `memory_create`, `memory_str_replace` for Secretaría), the recuerdo screen `/memoria/[...path]` and «Memoria de la empresa». Agents hired in Equipo have no `slug`, which the store's folder needs.

**How it works.** Each chat agent has its own store, `memoria/agentes/<slug>/` in the record ([agent-memory.md](../ready/agent-memory.md) decision 1), only where the organisation's record is in our record store, as Empresa. The agent reads and writes it; nobody else's agent writes it. At the start of a turn the engine puts the store in the system prompt, whole while it fits `OWN_MEMORY_BUDGET` (24,000 characters, ~8K tokens), otherwise its index (paths and first lines) for the agent to open; the prompt changes only when the store does, so caching holds. The same four tools take a `store` argument, `"empresa"` (the default, so #91's prompts and links still work) or `"propia"`; writing `"empresa"` stays Secretaría's. The instructions say: before answering, keep in your own store what should still be true tomorrow (how they want the work done, a correction, a fact of your area), one topic per file; what the whole organisation should know, Secretaría keeps; nothing only one person's («Sobre ti» isn't built). Limits as Empresa's: 1,000 files, 10 kB each, per store.

File Structure:

- `supabase/migrations/<ts>_agent_memories.sql`: `agents.slug` for every agent: a trigger fills it from the name when an insert leaves it empty (`Atención al cliente` → `atencion-al-cliente`, a suffix when taken in the organisation), and the existing rows are filled the same way. `memories` gains `agent_id` (references `agents`, cascade), `store in ('empresa', 'agente')` with `agent_id` set exactly for `agente`, and its key becomes `unique nulls not distinct (org_id, store, agent_id, path)`. A second read policy: an `agente` row for whoever's `agent_level` on that agent isn't `none`. `search_agent_memories(target_agent, words, max)`, `security definer`, `service_role` only (`search_memories` stays as it is).
- `supabase/tests/database/agent_memories.test.sql`: the slug from the name, unique per organisation, filled on insert and for existing rows; a member who may see the agent reads its store; one with level `none`, another organisation's member and anon don't; nobody but the service role writes; members can't call the search.
- `apps/engine/src/memory.ts`: a store is `{ agentId: null }` (Empresa) or `{ agentId, slug }`; `MemoryStore`'s functions take it; `projectMemory` reads Empresa and each agent's folder; the tools' `store` argument, the refusals, the links; `ownMemoryLines` (the store or its index for the system prompt).
- `apps/engine/src/recordStore.ts`: `supabaseMemoryStore` by store; `recordSync.ts` passes the agents to `projectMemory`.
- `apps/engine/src/chat.ts`: `reachOf` reads the agent's own store and gives it to `systemPrompt`, with the lines on what to keep (`OWN_MEMORY_LINES`). Told to group-chat-per-agent first, which changes `reachOf` too.
- `packages/shared/src/memory.ts`: `AGENT_MEMORY_DIR`, `agentMemoryDir(slug)`, `agentMemoryLink(agentId, path)`. `packages/shared/src/services/index.ts`: `listAgentMemories`, `readAgentMemory`; `settings.ts` classifies `search_agent_memories`.
- `apps/mobile/app/(app)/agente/[id]/memoria.tsx` and `apps/mobile/app/(app)/agente/[id]/memoria/[...path].tsx` (new, the list and the recuerdo, sharing their pieces with Empresa's); a «Memoria» row on the agent's screen; `components/chat/Markdown.tsx` opens `/agente/<id>/memoria/…` in the app.
- Tests: `apps/engine/test/memory.test.ts`, `recordSync.test.ts`, `chat.test.ts`; Jest for the two screens and the link.

Tasks:

1. [x] Migration and pgTAP test (`20261128600000_agent_memories.sql`, 18 checks); the 42 pgTAP files pass.
2. [x] `memory.ts` by store, test first: projection of Empresa and agent folders (an unknown slug's folder ignored); the `store` argument; writing `"empresa"` refused to everyone but Secretaría, `"propia"` allowed to every agent, one commit signed «Finanzas (por Ana)»; the store in the prompt, or its index past the budget.
3. [x] `recordStore.ts`, `recordSync.ts`; `supabaseMemoryStore` run against a local Supabase (Empresa's upsert keeps one row, the same path in two stores, search and forget by store).
4. [x] `chat.ts`: the own store and its lines in the system prompt; a test that two turns with the same store send the same system prompt.
5. [x] Shared services, the screens (on `components/memory/`, which Empresa's now use too), the row, the link; Jest.
6. [x] Checked on the web (2026-11-26) against a local Supabase: a member who may see the agent opens Equipo → agent → «Memoria», its list and a file, desktop and phone width; with level `none` the list is empty. The tool's commit into `memoria/agentes/<slug>/` and the next turn's prompt are covered by the unit tests only (no local Forgejo or model run); the record's hook lets the engine, its admin, write there.
7. [ ] `docs/architecture.md`; [agent-memory.md](../ready/agent-memory.md) says what is left (correcting, forgetting, history, «Sobre ti», runner agents' stores). `pnpm pr:land`.

### Later

- The subscription caches poorly (one text prompt per reply); Claude Code sessions (`--resume`) would fix it, and would store the conversation somewhere else too.
- Tune the numbers with what `ai_usage` shows.

## With group-chat-per-agent

[group-chat-per-agent.md](group-chat-per-agent.md) folds every thread of an agent into one. Whichever lands second handles the other: if this lands first, the fold deletes every `conversation_summaries` row (a summary of one of the folded threads doesn't describe the group, and the next reply rewrites it); if the fold lands first, the table starts empty. Its queue (`replyInThread`) and this plan touch the same function: this plan only changes what each reply reads.
