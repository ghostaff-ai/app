# One chat per agent, shared like a WhatsApp group

**Priority:** high — it changes how every conversation with an agent works, and the longer the private chats live, the more there is to fold in
**Gate:** decision:Jaime — whether a person can also open other conversations with an agent besides the group (open question 1)
**Next:** Jaime answers the open questions; then a written plan for the change (database, engine, the chat screen)

Jaime's idea (2026-11-24): each agent has **one chat**, and **everyone with access to the agent talks in that same chat**, as in a WhatsApp group. «Yo creo que solo tiene que haber un chat con los agentes y que todas las personas con acceso hablen al mismo chat con ese agente». Opening several conversations with one agent does not convince him yet: «hay que darle una vuelta». Written down as he said it; the group is his idea, everything under «Open questions» is still to decide.

## Today (`develop`, 2026-11-24)

- **One private chat per person and agent** ([three-tabs.md](../ongoing/three-tabs.md), decision 3, Álvaro 2026-11-23): `threads.personal_of` in `supabase/migrations/20261123200000_personal_chats.sql`, at most one per agent and person, invisible to everyone else, owners included.
- **Shared conversations, opt-in** ([chat-permissions.md](../ongoing/chat-permissions.md), Jaime 2026-11-23): whoever opens a conversation sets `threads.visibility` to `private`, `read` or `write`; `agents.chat_default` is the default for new ones (`supabase/migrations/20261124200000_conversation_visibility.sql`).
- **What an agent does on its own** (a report, a failed run) is copied into the private chat of every person who can see the agent (three-tabs.md, decision 12; «Avisos» removed in `20261123300000_no_notices.sql`).
- **Access per agent** stays as team-chat.md decision 6 set it: `none`, `read`, `talk` per member (`agent_access`, `agent_level()`); org owners always `talk`.
- **The agent reads only the conversation it answers in**, its last 40 messages (`recentMessages` in `apps/engine/src/chatStore.ts`), and writes one reply at a time per thread (`messages_one_working_per_thread`).
- Unread marks are per person and thread (`thread_reads`).

## The idea

- An agent has exactly one chat. Tapping the agent in Equipo opens it.
- Everyone whose level on the agent is `read` sees it; everyone with `talk` also writes in it. «Quién puede» on the agent's page is the list of the group's members.
- People see each other's messages with their name, as in a group; the agent answers in the same chat, to whoever asked.
- What the agent does on its own lands **once**, in the group, instead of a copy per person.
- Each person keeps their own unread mark on the group.

## What it reverses

- three-tabs.md decision 3 (one private chat per person and agent) and decision 12 (a copy per person of what the agent does alone).
- chat-permissions.md, in part: with one chat per agent, a conversation's own visibility has nothing left to choose, unless open question 1 brings back separate conversations.
- Either founder decides alone (AGENTS.md), so this is Jaime's call; Álvaro took decision 3, so he should hear it from Jaime directly.

## Consequences to weigh

- **Privacy.** Everything a person tells the agent is read by everyone with access to it. Today a member can ask Finanzas something without the owner reading it; in the group they can't. The access level per agent becomes the only privacy control.
- **The agent's context.** With several people writing, the last 40 messages fill faster and mix topics; a running summary (three-tabs.md decision 3 already mentions it) or [agent-memory.md](../ready/agent-memory.md) matters sooner.
- **Two people at once.** Only one reply is written per thread at a time; with a group, a second person's message while the agent is working needs a rule (queue it and answer after, or fold it into the same reply).
- **Acting with the asker's rights** (team-chat.md decision 7) still works message by message: the agent acts as the person whose message it is answering.
- **Simpler.** One thread per agent, no copies of the agent's own reports, no visibility to choose.

## Open questions

1. **Other conversations besides the group.** Jaime's doubt. Possibilities to draw before deciding: none, only the group; a private side chat with the agent for what shouldn't go to everyone; separate titled topics inside the agent (like threads in Slack).
2. **The private chats that exist today.** Merge them into the group by date (everyone would read what was private: probably not), keep them readable on the agent's page as «Conversaciones anteriores» (as was done with the old shared threads), or something else.
3. **The shared conversations of chat-permissions.md.** Keep them readable as old conversations, or fold the `write` ones into the group.
4. **Members with `read`.** They see the group and can't write: is that the right meaning of «Ver», or should «Ver» mean something narrower now that the chat holds everything?
