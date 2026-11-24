# What an agent reads on each turn: its memory and a few recent messages, not the last 40

**Priority:** medium — it decides how good and how dear every agent turn is, but it builds on the memory in the record, which isn't there yet for chat agents
**Gate:** decision:Jaime — what a turn carries besides the memory (open questions 1–3)
**Next:** Jaime answers the open questions; then fold the answer into [agent-memory.md](../ready/agent-memory.md) or a plan of its own

Jaime (2026-11-24), on the line «the engine reads the last 40 messages» in [group-chat-per-agent.md](group-chat-per-agent.md): sending the last 40 messages «no tiene sentido». The agent keeps a memory, and that memory is the organisation's record (the repo per organisation, [record-store.md](../ongoing/record-store.md)). So a turn should carry **the memory, and maybe some of the previous messages**; how many, or which, he doesn't know yet. Written down as something to consider; nothing here is decided.

## Today (`develop`, 2026-11-24)

- **Chat agents** (`runner = 'chat'`, Secretaría and every agent hired in Equipo): each message is one model call from the engine with a fixed system prompt and the thread's last 40 messages (`deps.chat.recentMessages(thread.id, 40)` in `apps/engine/src/chat.ts`). Nothing survives outside the conversation.
- **Runner agents** (`runner = 'ordago_job' | 'ghostaff'`): each turn clones the record, reads `AGENTS.md` and `agentes/<slug>/` and writes back what should still be true tomorrow (`composePrompt` in `apps/engine/src/runner.ts`). Their memory is already files in the record.
- **[agent-memory.md](../ready/agent-memory.md)** (ready, blocked on the record store) puts memory stores in the record (`memoria/empresa/`, `memoria/agentes/<slug>/`) plus a private «Sobre ti» per person, and each agent's instructions in `agentes/<slug>/AGENTS.md`. It says where memory lives and who may write it; it does not change what a chat turn sends: the 40 messages stay.
- Álvaro (WhatsApp, quoted in agent-memory.md): one conversation per agent, «compacted as it grows». three-tabs.md decision 3 mentions «a running summary in the background» for when chats get long.

## The idea

A turn carries:

1. the agent's instructions (`agentes/<slug>/AGENTS.md`) and the organisation's `AGENTS.md`;
2. its memory, from the record: what it has written down about the organisation, its job and the people it works with;
3. **a few** of the latest messages, enough to follow the thread of what is being said now.

Everything older than that is what the memory is for: if something said weeks ago still matters, the agent should have written it down. The conversation stays whole in Postgres for people to read; the model doesn't need all of it.

## Why it matters

- **A long chat stops costing more every turn.** With one chat per agent, and more so with a group chat ([group-chat-per-agent.md](group-chat-per-agent.md)), 40 messages are a few hours of talk from several people, mixed topics, paid for on every reply.
- **What matters survives the window.** With 40 messages, whatever was said in message 41 is gone unless it happened to be written down; with memory as the source, writing it down is the agent's job.
- **One model for both kinds of agent.** Runner agents already work this way (the record plus the request); chat agents would too.

## Open questions

1. **How many recent messages, and measured how.** A fixed small number, the messages since the agent last wrote to memory, the last hours, or a token budget.
2. **When the agent writes to memory.** At the end of each turn, as runner agents do today; in a background pass over the conversation; or both.
3. **Older messages on demand.** Whether the agent gets a tool to search the conversation's history in Postgres when its memory isn't enough (agentic search, no embeddings, as agreed in agent-memory.md), or only its memory.
4. **What memory a chat agent reads while its organisation has no record.** Until record-store.md gives every organisation one, a chat agent has no memory to read: does it keep the 40 messages until then?
5. **Summary or memory.** Whether the «running summary» of three-tabs.md decision 3 is still needed once the memory carries what matters, or is one more file in the memory.
