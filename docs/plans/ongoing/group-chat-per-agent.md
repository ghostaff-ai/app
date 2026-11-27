# One chat per agent, shared like a WhatsApp group

**Priority:** high — it changes how every conversation with an agent works, and the longer the private chats live, the more there is to fold in
**Gate:** none
**Next:** on the beta, two people write to one agent within seconds of each other: one chat, both signed, each answered in turn; then retire this plan to docs/decisions/

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

6. **Routines lose «Solo para mí».** Every routine is the team's: its answer lands in the group. Anyone who talks to the agent makes one; its creator or an owner changes, pauses or deletes it. (Jaime, 2026-11-26, when the tasks were written.)
7. **Pushes in the group go to whoever follows it**: today's rule for shared conversations (`follows_thread`: wrote, read or was @mentioned in it). The person the agent answers always follows, having written. (Jaime, 2026-11-26.)

Consequence of 2 and 3, to handle in the fold: what the agent did on its own was copied into each person's private chat (three-tabs.md, decision 12), so the merged group would hold the same report once per person. The fold keeps one of each.

## What it reverses

- three-tabs.md decision 3 (one private chat per person and agent) and decision 12 (a copy per person of what the agent does alone).
- chat-permissions.md: a conversation's own visibility (`threads.visibility`, `agents.chat_default`) goes away entirely. The access level per agent is the only thing that decides who reads and who writes.
- Either founder decides alone (AGENTS.md), so this is Jaime's call; Álvaro took decision 3, so he should hear it from Jaime directly.

## Consequences to weigh

- **Privacy.** Everything a person tells the agent is read by everyone with access to it. Today a member can ask Finanzas something without the owner reading it; in the group they can't. The access level per agent becomes the only privacy control.
- **The agent's context.** With several people writing, the last 40 messages fill faster and mix topics. Jaime doesn't think a turn should carry the last 40 messages at all, but its memory and a few recent ones: [agent-context.md](agent-context.md).
- **Acting with the asker's rights** (team-chat.md decision 7) still works message by message: the agent acts as the person whose message it is answering.
- **Simpler.** One thread per agent, no copies of the agent's own reports, no visibility to choose.

## Tasks

Two pull requests. The first makes the group; until the second lands, a «Solo para mí» routine answers in the group too.

### PR 1: one chat per agent

**Database** — one migration, `supabase/migrations/<ts>_group_chat_per_agent.sql`:
1. Fold: per agent, keep its oldest thread (or open one) titled with the agent's name; move every other thread's rows onto it (`messages`, `thread_reads` keeping each person's latest mark, `agent_actions`, `account_asks`, `guides`, `agent_runs`, `push_outbox`); delete the empty threads. Before moving, a stale «working» message beyond the newest per agent is marked failed, so `messages_one_working_per_thread` holds.
2. Dedupe: the agent's own copies (same agent, routine and parts, within a few seconds of each other, no action, ask or guide pointing at them) keep the first.
3. Shape: drop `threads.personal_of`, `threads.visibility`, `agents.chat_default`; `threads_one_per_agent` unique on `agent_id`. `thread_level_for` becomes the member's level on the agent.
4. Functions: `chat_with`, `ask_about_decision` write in the agent's chat; `post_to_personal_chats` becomes `post_to_agent_chat` (once); `post_routine_copies` goes (the answer is already in the group); `notify_owners` writes once in Secretaría's chat; `my_threads` drops `personal`, `visibility`, `mine`; `follows_thread` and `messages_notify` lose the personal case (route `/chat/<agent>`); `start_thread`, `set_conversation_visibility`, `conversation_readers`, `set_agent_chat_default` are dropped; `can_hear_voice_note` checks the note's message, not the folder's thread (old notes keep their folder).
5. pgTAP: rewrite `personal_chats`, `chat_permissions`, `no_notices` as one `group_chat` test (a member reads and writes by level, `read` can't write, another organisation sees nothing, the fold and the dedupe); adjust the tests that call the dropped functions.

**Engine** (`apps/engine`):
6. `personalChat` → `agentChat(agentId)`; routines, hello, guides and asks use it.
7. The queue: `replyInThread` answers, one at a time and in order, every person message written after the agent's last reply, each as its author (team-chat.md decision 7); a request that finds the thread busy leaves its message to the one answering. A queued message from someone other than the caller is answered without their session, so without the settings tools that turn (they need it); the agent says so if asked for a setting. Bounded rounds per request, as today.
8. Drop `postRoutineCopies`; tests follow.

**Shared and app**:
9. Services: drop `startThread`, `setConversationVisibility`, `conversationReaders`, `setAgentChatDefault`, the `chat_default` setting and its tool, the visibility models; classify the new and dropped functions in `settings.ts`.
10. Screens: Equipo one row per agent; the chat says it is everyone's with access; `conversacion/[id]` redirects to its agent's chat (old pushes); remove `nueva-conversacion`, `conversaciones`, `visibilidad`, `Audience`, `VisibilityPicker`; the agent's page loses its conversations and its default.
11. Maestro: replace `conversation-visibility.yaml` with a group flow (two people, one chat), run `pnpm e2e`.

### PR 2: routines without «Solo para mí»

12. Migration: every routine `team`, drop `audience`; `create_routine` for anyone who talks to the agent; `may_change_routine` its creator or an owner; runs' policy by agent level only.
13. Shared, engine, settings tool and the routine screens lose the choice; tests follow.

## Landed

- PR 1, [#84](https://github.com/ghostaff-ai/app/pull/84) (2026-11-27): the fold (`20261128700000_group_chat_per_agent.sql`, which also empties `conversation_summaries`), `messages.reply_to` and the queue (`waitingRuns`, `answerWaiting`; a turn reads the conversation cut at the message it answers, `cutAt`), Equipo with one row per agent, old `/conversacion/<id>` links opening the agent's chat, Maestro `group-chat.yaml`.
- PR 2, [#106](https://github.com/ghostaff-ai/app/pull/106) (2026-11-27): routines without «Solo para mí» (`20261128710000_routines_for_everyone.sql`).
- Known limit: a queued message from someone other than the caller is answered without their session, so without the settings tools that turn.

## Still open

Not decided on 2026-11-26; it doesn't hold up the build.

1. **What a turn reads.** Decided by Jaime on 2026-11-26 in [agent-context.md](agent-context.md): a summary, the latest messages up to about 30K tokens, and a search over the rest. This plan works with today's last 40 messages; that plan changes them, and says what the fold does with its summaries.
