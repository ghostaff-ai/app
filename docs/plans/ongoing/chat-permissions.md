# Who reads and writes a conversation

**Priority:** high — privacy: who sees what a person says to an agent
**Gate:** none
**Next:** check it on the beta app with two people: a private conversation the other can't see, a shared one they read, and the «Solo lectura» reason

Jaime's Trello card (2026-11-23), «permisos de escritura en chats por otros miembros del equipo»: «esto tiene que ser por agente y por conversación, o sea yo puedo ser owner de un agente y hacer una conversación que quiero que lean o que no, o no ser dueño de un agente y abrir una conversación que no quiero que vean, esto es un tema».

**Goal:** whoever opens a conversation with an agent decides whether it is private or whether the team may read it, or also write in it, whatever their role; the agent's access levels («Quién puede») stay the ceiling.

## Where we are (develop, 2026-11-23)

- **Per agent**, three levels per member (`agent_access`, `agent_level()`, team-chat.md decision 6): `none` doesn't see the agent, `read` reads, `talk` also writes. Org owners (`memberships.role = 'owner'`) always `talk` and are the only ones who set levels. There is no owner *of an agent*; `agents.created_by` is only who added it.
- **Per conversation**, two kinds, nothing chosen by the person:
  - the **personal chat** (`threads.personal_of`, three-tabs.md decision 3): one per person and agent, invisible to everyone else, owners included;
  - the **old shared threads** (`personal_of is null`, team-chat.md decision 2, replaced 2026-11-23): read and written by level, still readable on the agent's page.
  - the agent's **«Avisos»** (`threads.notices`), shared; being removed (three-tabs.md decision 12): what an agent does alone goes to the private chat of each person who can see it.
- **The agent** reads only the conversation it answers in (`recentMessages(thread, 40)` in `apps/engine/src/chatStore.ts`). It has no memory across conversations yet; [agent-memory.md](../ideas/agent-memory.md) proposes one, scoped by «personal chat» versus «shared thread».
- **A gap found while reading:** the engine's `replyInThread` (`apps/engine/src/chat.ts`) checks only that the asker may `talk` to the *agent*, not that they may see the *thread*. Someone who knew the id of a colleague's personal chat could make the agent answer in it (they would not see the answer; the id is not guessable and RLS hides it). Closed by this work: the engine asks a `thread_level_for(thread, member)` instead.

## The model (Jaime, «OK a todo», 2026-11-23)

### A conversation has a visibility, set by whoever opened it

| Visibility | In the app | Who reads | Who writes |
|---|---|---|---|
| `private` | «Solo yo» | the opener (and the agent) | the opener |
| `read` | «El equipo puede leer» | the opener and every member with `read` or `talk` on the agent | the opener |
| `write` | «El equipo puede escribir» | the opener and every member with `read` or `talk` on the agent | the opener and every member with `talk` on the agent |

**«El equipo» means the people the agent's access already lets in.** A person's level on a conversation is the lower of their level on the agent and what the conversation allows them:

```
level(person, conversation) =
  opener                 → level(person, agent)        -- their own, capped only by the agent
  private                → none
  read                   → min(level(person, agent), read)
  write                  → level(person, agent)
```

Examples, in a bakery with Ana (owner) and Bea (member, `read` on Finanzas):
- Ana opens «Sueldos 2027» with Finanzas, «Solo yo»: Bea doesn't see it exists. Nor would another owner.
- Ana opens «Cierre de noviembre», «El equipo puede escribir»: Bea reads it but can't write, because her level on Finanzas is `read`. If Ana raises Bea to `talk` on Finanzas, Bea can write.
- Bea, not an owner, opens «Mi baja» with Secretaría (`talk` for everyone), «Solo yo»: Ana, the owner, doesn't see it.

### What each side can force

- **The opener** decides the visibility and changes it later. Nobody else does, owners included: an owner can't open a private conversation, nor make it shared. This is Jaime's second case taken literally.
- **The agent's owner** (today: the organisation's owners, decision 1) keeps what they have, the levels on the agent, which cap every conversation with it. They gain one thing: the **default visibility** of new conversations with that agent (`agents.chat_default`, «Solo yo» unless they change it), which the opener can change at the moment of opening.
- **Lowering someone's level on the agent** takes effect at once in every shared conversation with it. Lowering the opener's own level caps their own conversations too: someone moved to `none` on Finanzas no longer sees their conversations with Finanzas (they come back if the level does).

### Changing a conversation's visibility later

- **Private → shared:** allowed, with a warning on the sheet: «Verán toda la conversación, también lo anterior».
- **Shared → private, or write → read:** allowed while nobody else has written in it. Once someone else has, it can go from `write` to `read` (closed to new messages) but not to `private`: it would hide from them what they wrote themselves.

### Where conversations show

- **Your chat with each agent** stays as Álvaro set it (three-tabs.md decision 3): the agent's row in Equipo, always private. It doesn't get a visibility switch: it is the private one, and a shared conversation is a separate one.
- **«Nueva conversación»**, from the agent's page, opens a titled conversation with a visibility chosen right there, preselected to the agent's default. That brings back several conversations per agent, which three-tabs.md decision 3 had narrowed to one; only titled ones, beside the chat (decision 2).
- **Equipo** keeps one row per agent, plus a row for each titled conversation you **follow**: you opened it, wrote in it, read it, or were @mentioned. Those look like WhatsApp groups: the agent's ghost, the conversation's title, «Compartida» or «Solo tú». The rest wait on the agent's page under «Conversaciones», so an owner with ten agents doesn't get a flooded Equipo (decision 3). The shared threads of before are conversations like any other (`write`): the page's «Conversaciones anteriores» becomes that list.
- **Inside a titled conversation** a line under the header says who sees it («Solo tú y Finanzas», «La lee el equipo de Finanzas · 4 personas», «La escribe el equipo de Finanzas · 4 personas»); for the opener it opens the visibility sheet. The composer of someone who can only read says why («Solo lectura · la abrió Ana»).

### What the agent sees and does

- **In a conversation, the agent reads only that conversation**, as today. In a shared one it answers with the rights of whoever wrote the message it answers (team-chat.md decision 7), and its answer is read by everyone who reads the conversation.
- **Its memory across conversations** ([agent-memory.md](../ideas/agent-memory.md)) follows visibility, not the kind of thread: where that plan says «personal chat» read «private conversation» (memories «Sobre ti» allowed, used only with that person), and where it says «shared thread» read «shared conversation» (organisation memories only, never anyone's «Sobre ti»). An organisation memory saved from a private conversation is visible to the team, so it is only saved announced in the chat («Lo recordaré para todo el equipo: …»), as that plan's explicit tool already does (decision 5).
- **What the agent does is not private**: a decision it raises, a change to the record, a mail it sends belong to the organisation and show where they always do, whatever the conversation. Private is the conversation, not the work. The decision card's «Preguntar» opens the conversation it came from only for someone who can see it; others get the agent's chat with the decision quoted.
- **@agent in a shared conversation**: the agent brought in answers there, and everyone who reads the conversation reads that answer, even someone with `none` on that agent. Accepted: the conversation belongs to its own agent, and the asker must be allowed to talk to the agent they bring in. The @ list warns when the conversation is shared («Lo leerá el equipo de Finanzas»).
- **@person** offers only people who can see the conversation, as now (team-chat.md decision 9). In a private conversation it offers nobody.

### Data and row-level security

- `threads.visibility text not null check (visibility in ('private', 'read', 'write'))`, set from what exists: personal chats `private`; old shared threads `write` (they behaved like that: each by their level). «Avisos» is gone by then (three-tabs.md decision 12); if not, `read`.
- `agents.chat_default`, the same values, default `private`. A setting: defined in `packages/shared/src/services/settings.ts` and changeable by Secretaría with an owner's approval (AGENTS.md rule 6).
- `thread_level(thread)` rewritten as the rule above; it is already the one function every policy and write goes through (threads, messages, read marks, `my_threads`, `post_message`). The threads policy reads `thread_level(id) <> 'none'` instead of repeating the rule.
- `start_thread(agent, body, title, visibility)` gains the visibility (null: the agent's default); `set_conversation_visibility(thread, visibility)`, opener only, with the rules above; `conversation_readers(thread)`, how many people read it, for whoever sees it. Classified in `settings.ts`: `set_conversation_visibility` is `never` («a conversation's privacy is its opener's alone»); `set_agent_chat_default` is the setting, with its tool `settings_agent_chat_default`.
- `thread_level_for(thread, member)` is the one rule, service role only, for the engine (the gap above); `thread_level(thread)` is it for `auth.uid()`. `replyInThread` checks it.
- `my_threads` returns `visibility`, `opened_by_me` and `following`. Following comes from authorship, mentions and read marks, without a new table.
- **Realtime** applies the policies per event, so a conversation made private stops reaching others at once (no event tells them; their screen says they have lost access the next time it loads the conversation).
- pgTAP `supabase/tests/database/chat_permissions.test.sql`: the three visibilities for opener, owner, `talk`, `read` and `none` members; the cap by agent level, the opener's included; nobody but the opener changes visibility; the downgrade rule; nothing across organisations; `thread_level_for` matches `thread_level`.

## Edge cases

- **The opener leaves the organisation:** their private conversations are deleted with their membership; shared ones stay, with their name on their messages, and nobody can change their visibility any more (decision 4).
- **The opener becomes an owner, or stops being one:** nothing changes on their conversations; owners don't see private conversations either way.
- **A member is removed from an agent (`none`)** while they had a shared conversation open: the next Realtime event no longer reaches them, the screen says they have lost access.
- **Two people write at once in a `write` conversation:** the agent answers one message at a time, as today (one `working` reply per thread).
- **A personal space** (`organizations.kind = 'personal'`) has only its owner: the visibility sheet isn't shown there.
- **An action proposed in someone's private chat** (an approval card, `agent_actions`) needs an owner, who can't see a member's private conversation. This was already so for personal chats (2026-11-23); it waits for the decision model (three-tabs.md, step 3), where a decision raised from a private conversation goes to the deck without its conversation.
- **The agent is removed:** its conversations go with it, as today (`delete_agent` is `never` for Secretaría for that reason).
- **Full export** (invariant 2): a private conversation is the organisation's data stored for one person. The export an owner runs leaves out other people's private conversations; each person can export their own (decision 4).

## Decisions (Jaime, «OK a todo», 2026-11-23: all my picks, the first option of each)

1. **Who is «owner de un agente».** (a) The organisation's owners, as today: they set «Quién puede» on every agent; no new role. (b) A new per-agent owner (a fourth level, `own`, or `agents.owner_id`), who manages that agent's access without being an org owner: useful when a department head runs Finanzas. My pick: (a) now; (b) as its own card when a team asks for heads of department, since the visibility model works the same either way.
2. **Several conversations per agent.** (a) Your private chat stays, plus titled conversations with a visibility, opened from the agent's page. (b) Only the one chat per agent, with a visibility switch: simpler, but you can't have a private chat and a shared one with the same agent, which is Jaime's first case. My pick: (a).
3. **Where shared conversations show.** (a) Equipo shows those you follow, the rest on the agent's page. (b) Equipo shows all shared conversations you can see. (c) Only on the agent's page. My pick: (a).
4. **Private conversations when someone leaves.** (a) Deleted with the membership; the export leaves them out except for their author. (b) Kept, still invisible, for the organisation. My pick: (a); a private conversation that nobody may read is only risk.
5. **The agent's memory follows visibility** (private → «Sobre ti» and announced organisation memories; shared → organisation only). My pick: yes, as a requirement for the agent-memory work.
6. **Per-person sharing** («Solo Ana y yo»): out of this card; it needs a list of people per conversation. Revisit if anyone asks.

## Coordination

- The removal of «Avisos» (branch `claude/remove-avisos-7bec6b`) changes `useAgentChat` (`apps/mobile/lib/hooks/useChat.ts`) and the `notices` column; whichever lands second rebases. Nothing here depends on «Avisos».
- Voice notes and the connector card touch the chat screen (`chat/[agent].tsx`, `components/chat/`); the visibility sheet and the «who sees it» line live in their own components to keep the overlap small.
- team-chat.md decision 6 (levels per agent) and three-tabs.md decision 3 (one private chat per person) stand; this adds the per-conversation layer on top.

## File structure

- `supabase/migrations/20261124200000_conversation_visibility.sql`: `threads.visibility`, `agents.chat_default`, `thread_level_for`, `thread_level`, the threads policy, `start_thread`, `set_conversation_visibility`, `conversation_readers`, `set_agent_chat_default`, `my_threads` (+ `visibility`, `mine`, `following`).
- `supabase/tests/database/chat_permissions.test.sql`; `team_chat`, `personal_chats` tests adjusted where `start_thread` changed.
- `packages/shared/src/chat.ts` (`ConversationVisibility`, `ChatThread` fields), `models` (`Agent.chatDefault`), `services/index.ts` (`startThread`, `setConversationVisibility`, `conversationReaders`, `setAgentChatDefault`, `getThread` with visibility and opener), `services/settings.ts` (classification, `settings_agent_chat_default`).
- `apps/engine/src/chat.ts`, `chatStore.ts`: `threadLevelFor`; tests in `apps/engine/test/chat.test.ts`, `settings.test.ts`.
- `apps/mobile`: `lib/chat.ts` (`teamRows` with followed conversations, visibility words), `components/chat/VisibilityPicker.tsx`, `components/chat/Audience.tsx`, `app/(app)/nueva-conversacion/[agent].tsx`, `conversacion/[id].tsx` (audience line, sheet, read-only reason), `agente/[id].tsx` («Nueva conversación», «Conversaciones», the default for owners), `(tabs)/index.tsx` (followed rows); Jest tests; a Maestro flow `.maestro/flows/ci/shared-conversation.yaml`.

## Tasks (branch `claude/chat-permissions-6baf5b`, one PR, stacked on #54)

- [x] 1. Migration and pgTAP (`20261124200000_conversation_visibility.sql`, `chat_permissions.test.sql`; the tests that opened shared threads now say `visibility => 'write'`).
- [x] 2. Engine: `thread_level_for` in `replyInThread`, with tests.
- [x] 3. Shared services, types and the settings classification and tool.
- [x] 4. Screens: new conversation with the picker, the audience line and the «Quién la ve» screen, the agent's page («Nueva conversación», «Conversaciones», «Conversaciones nuevas» for owners), Equipo's followed rows, the read-only reason.
- [x] 5. Check (landed as #58, 2026-11-23, its CI green with the new e2e flow): `pnpm check` green; pgTAP 331/331 on a fresh database with every migration (health and voice notes included); checked on the web against a local Supabase of its own (Bea opens a private conversation, shares it, Dani reads it with «Solo lectura · Pide acceso a Ana», Ana writes, Bea can no longer make it private and is told why; light and dark). Not run: `pnpm e2e` locally (CI runs the new flow `conversation-visibility`); not checked on a phone.

## Handoff

- This migration builds on #54's `my_threads` (no «Avisos»), which landed first.
- The local Supabase shared by the sessions (`supabase_db_ghostaff`) was not touched: pgTAP ran inside rolled-back transactions there, and the web check used a separate stack (`project_id = ghostaff-perm`, ports 553xx) started from a copy of `supabase/`.
