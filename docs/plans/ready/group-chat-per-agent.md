# One chat per agent, shared like a WhatsApp group

**Priority:** high — it changes how every conversation with an agent works, and the longer the private chats live, the more there is to fold in
**Gate:** none
**Next:** write the File Structure and Tasks against that day's code (database, engine, the chat screen), then move this to ongoing/

Jaime's idea (2026-11-24): each agent has **one chat**, and **everyone with access to the agent talks in that same chat**, as in a WhatsApp group. «Yo creo que solo tiene que haber un chat con los agentes y que todas las personas con acceso hablen al mismo chat con ese agente». He answered the open questions on 2026-11-26 (Decisions, below): only the group, and everything that exists today folds into it.

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

## Decisions

Jaime, 2026-11-26.

1. **Only the group.** An agent has one chat and nothing else: no private side chat with the agent, no titled topics inside it.
2. **Today's private chats fold into the group**, by date. Ghostaff is at a very experimental stage: the only conversations so far are Álvaro's and Jaime's, so there is nothing private to protect.
3. **Today's shared conversations fold into the group too**, `read` and `write` alike. Every message shows who wrote it (Álvaro, Jaime…): it is everyone's chat with the agent.
4. **`read` («Ver») sees the group and doesn't write; `talk` writes.** The levels keep the meaning they have today.
5. **Two people at once: queue.** A message that arrives while the agent is answering someone else waits, and the agent answers it after, one message at a time, in order. Folding both into one reply was the alternative; it would blur whose rights the agent acts with (team-chat.md decision 7), since each reply acts as the person it answers.

Consequence of 2 and 3, to handle in the fold: what the agent did on its own was copied into each person's private chat (three-tabs.md, decision 12), so the merged group would hold the same report once per person. The fold keeps one of each.

## What it reverses

- three-tabs.md decision 3 (one private chat per person and agent) and decision 12 (a copy per person of what the agent does alone).
- chat-permissions.md: a conversation's own visibility (`threads.visibility`, `agents.chat_default`) goes away entirely. The access level per agent is the only thing that decides who reads and who writes.
- Either founder decides alone (AGENTS.md), so this is Jaime's call; Álvaro took decision 3, so he should hear it from Jaime directly.

## Consequences to weigh

- **Privacy.** Everything a person tells the agent is read by everyone with access to it. Today a member can ask Finanzas something without the owner reading it; in the group they can't. The access level per agent becomes the only privacy control.
- **The agent's context.** With several people writing, the last 40 messages fill faster and mix topics. Jaime doesn't think a turn should carry the last 40 messages at all, but its memory and a few recent ones: [agent-context.md](../ideas/agent-context.md).
- **Acting with the asker's rights** (team-chat.md decision 7) still works message by message: the agent acts as the person whose message it is answering.
- **Simpler.** One thread per agent, no copies of the agent's own reports, no visibility to choose.

## Still open

Not decided on 2026-11-26; it doesn't hold up the build.

1. **What a turn reads.** Which messages and how much memory an agent's turn carries is [agent-context.md](../ideas/agent-context.md), still waiting on Jaime. This plan works with today's last 40 messages; that plan changes them.
