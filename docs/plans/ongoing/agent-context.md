# What a chat agent reads on each turn: a summary, the latest messages and a search, never the whole conversation

**Priority:** high — with one group chat per agent the conversation grows without end, and what a turn carries decides how good and how dear every reply is
**Gate:** none
**Next:** PR 1 (Tasks, below) on `feat/agent-context`: the migration and its pgTAP test first, then `context.ts` with its tests, then the engine; land it with `pnpm pr:land`

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

### PR 1: summary, latest messages, search, caching

1. Migration and pgTAP test (File Structure). `pnpm db:test`.
2. `context.ts`, test first: the window under the budget, the ceiling, the summary turn; `summarizeIfLong` folds the oldest messages up to the first unfinished one and leaves `KEEP_VERBATIM`, never saves a summary older than the one stored, fails quietly; the search tool's input checks and output.
3. `ChatStore` and its Supabase implementation.
4. `chat.ts`: chat agents read the conversation (`replyInThread`, `goOn`, `answerRoutine`); job and runner agents keep their 40 messages; `toTurns` with time and summary; `systemPrompt` without the clock (a routine's turn says the time in its own line); the search tool; `summarizeIfLong` after each reply, before the request ends (Cloud Run keeps the CPU only while it is open).
5. `streamWith`: automatic caching and the usage log; a test that two turns of the same conversation send the same prefix.
6. `docs/architecture.md` and [agent-memory.md](../ready/agent-memory.md)'s «Today» say what a turn reads now.

### PR 2: memory at the end of each turn (decision 4)

Once chat agents reach the record ([agent-memory.md](../ready/agent-memory.md)): at the end of each turn the agent writes what should still be true tomorrow to its store, and reads it at the start. Planned there, against that day's code.

### Later

- The subscription caches poorly (one text prompt per reply); Claude Code sessions (`--resume`) would fix it, and would store the conversation somewhere else too.
- Tune the numbers with what `ai_usage` shows.

## With group-chat-per-agent

[group-chat-per-agent.md](group-chat-per-agent.md) folds every thread of an agent into one. Whichever lands second handles the other: if this lands first, the fold deletes every `conversation_summaries` row (a summary of one of the folded threads doesn't describe the group, and the next reply rewrites it); if the fold lands first, the table starts empty. Its queue (`replyInThread`) and this plan touch the same function: this plan only changes what each reply reads.
