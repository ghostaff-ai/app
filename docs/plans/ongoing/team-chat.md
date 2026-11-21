# Talking to the team: the chat

**Priority:** high — «hablar con un departamento» is one of the four things the first version promises
**Gate:** blocked:ghostaff-ai/app:build-first-version
**Next:** step 4, decision cards in the chat, once the engine gives agents the record and tools (build-first-version, «The engine»): an agent raises a decision and it shows inline as the Hoy card (decision 5)

Álvaro asked (2026-11-17) for a really good, curated chat: several people of one organisation talking to its agents, the owner deciding who can read or talk to each agent, and agents that are added by department and start working the moment they arrive, as a conversation rather than a form. I researched the libraries and guidelines and drew ten decisions; he took all my picks («go», 2026-11-17). The page he reviewed, with the options drawn and the sources: [Ghostaff chat choices](https://claude.ai/artifact/DCyY8cKXptDmf3xgBJp5an).

It builds on the calm-desk decisions in [app-design.md](../ongoing/app-design.md) (#1 three tabs and the mic, #2 talking goes to Secretaría, #13 «Preguntar», #17 first person, #18 agent text muted, #20 one card for every decision) and reopens none of them.

## What's out there (2026-11-17)

- **Stream Chat** (`stream-chat-expo` with its `ai-components`): the most complete multi-user chat with streaming AI messages, but the conversations live on Stream's servers, beside a second permission system. Breaks invariant 2 (storage we own).
- **assistant-ui** (`@assistant-ui/react-native`, native since March 2026, 0.1.x): good headless primitives and can read from our own store, but young on native and built around one person driving one thread. The fallback if our own screens cost too much.
- **Vercel AI SDK** (`useChat` with `expo/fetch`): no UI, and the chat state lives in one phone's request. We borrow its message shape (a message is a list of parts: text, tool call, file).
- **expo-ai-elements**, **Gifted Chat** and its fork `@kesha-antonov/react-native-chat`: single-user or messenger-shaped; read, don't adopt.

Guidelines that shaped the picks: Slack's agent design (show progress, threads with real titles), the multi-user shared sessions problem (act with the asker's rights, attribute every action to a person), durable sessions (the conversation lives on the server and every participant syncs from it), first-success onboarding.

## Decisions (Álvaro, 2026-11-17, all my picks)

1. **Our own chat on Supabase.** Messages in our database with `org_id` and row-level security, live to everyone in the thread through Realtime; the engine writes the agent's words as they come, the app only reads and writes through `security definer` functions. Libraries only for the hard parts: Legend List (a list pinned to the newest message), react-native-keyboard-controller, a throttled streaming markdown renderer. Message parts follow the AI SDK's shape so the UI can change later.
2. **Titled threads per agent, shared.** One topic per thread, titled by the agent; everyone with access to that agent sees them and can join. A «Solo yo» lock only if someone asks for it.
3. **People in bubbles, agents flat.** Your messages on the right in ink, colleagues on the left with their initials, agents full width in muted text with their small ghost.
4. **One live line while it works** («Leyendo 14 correos nuevos…»), folding into «3 pasos · 41 s» that opens the steps.
5. **An OK asked in a chat is the decision card**, the same row as in Hoy: answering in either place answers both, it counts towards earned autonomy, and someone who can't take it sends it to the department's responsible person.
6. **Access is set on each agent's page**, three levels per person: **Nada** (doesn't see it), **Ver** (reads its threads and what it did), **Hablar** (also starts threads and asks for work). The invite sheet shows the same control per agent. With «Ver» the composer reads «Solo lectura · pide acceso a <owner>».
7. **A new member sees everything and talks to Secretaría.** The rule under it: **an agent acts with the rights of the person who asked.** Secretaría doesn't pass a request to an agent the asker can't talk to; she says who to ask. The database enforces it, not the screens.
8. **Starting an agent: tap the vacancy and it arrives talking.** Equipo shows each department with its agents and vacancies («Vacante · Redes»); a tap opens a sheet with the ghost and its one-line job and «Que empiece»; you land in its first thread while it writes: it has read the record and proposes a first piece of work with reply chips. Name and ghost come from the department, changeable later on its page. Asking Secretaría in a chat («necesito a alguien para Instagram») calls the same hire step. Today's `nuevo-agente` form stays only for a custom agent with the plain ghost.
9. **@ to bring others in.** `@Redes` adds that agent to the thread; `@Ana` sends her a push. The list offers only agents the asker can talk to and people who can see the thread's agent.
10. **Threads live inside Equipo, per agent**, with an unread dot on the agent row and a «Conversaciones» filter at the top of Equipo. No fourth tab. On a computer: agents, threads and the open thread side by side.

## Progress

**Step 1, data and access** (branch `feat/agent-access`, 2026-11-18):

- [x] `supabase/migrations/20261118000000_team_chat.sql`: levels per agent and member (`agent_access`, `agents.member_default`, `agent_level()`), `threads` and `messages` (parts in the AI SDK's shape) readable by level, written only through `start_thread` and `post_message`, live through Realtime. Owners always talk; it sits beside `memberships.role`, it doesn't replace it.
- [x] Invitations carry per-agent levels (`invite_member(…, agent_levels)`), applied by `accept_invitation`.
- [x] pgTAP: `supabase/tests/database/team_chat.test.sql` (defaults, none/read/talk, owners only, nothing across organisations, invitations).
- [x] «Quién puede» on the agent's page (`app/(app)/acceso/[id].tsx`) and per-agent levels in the invite screen.

**Step 2, the chat screens** (branch `feat/chat-screens`, 2026-11-18):

- [x] Read marks and the thread list (`supabase/migrations/20261118100000_thread_reads.sql`, `my_threads`, `mark_thread_read`, pgTAP `thread_reads.test.sql`); messages ordered by the clock, not the transaction.
- [x] Services in `@ghostaff/shared/services` (threads, messages, members, Realtime) and the pure helpers in `packages/shared/src/chat.ts` (@mentions).
- [x] Equipo: «Equipo · Conversaciones», an orange dot on an agent with unread messages, vacancies for owners («Vacante · Redes» → `contratar`, which adds the agent and opens its page).
- [x] The agent's page lists its threads, «+ Nueva» with «Hablar»; a thread (`conversacion/[id]`) with people in bubbles, agents flat, live through Realtime; «Solo lectura» with «Ver»; @ suggests agents and people and bolds them.
- [x] The mic on Hoy, Equipo and Registro opens a new thread with Secretaría (or the first agent the person may talk to). Speaking is the keyboard's own dictation for now.
- [x] Legend List for the messages and react-native-keyboard-controller on the phone (a new native module: the next beta is a build, not an over-the-air update).
- Checked on the web against local Supabase (two people, Realtime, a mention, a vacancy filled); not yet on a phone.
- Left for later: an @person sends no push yet (notifications are their own plan), and @agent doesn't bring that agent into the thread until agents talk.

**Step 3, agents talking** (branch `feat/agents-talk`, 2026-11-18):

- [x] The engine answers in threads (`apps/engine/src/chat.ts`, `POST /threads/:id/reply`): the app asks after each message; the engine checks the asker may talk to the agent (`agent_level_for`, service role only), and the agent answers with Claude through the organisation's own AI account (Vertex in its EU project first, else its Anthropic key from the vault). No account: the agent says to connect one in Conexiones. Model `claude-opus-5-5` at low effort, `ENGINE_CHAT_MODEL` overrides it.
- [x] A reply is one message that grows (`supabase/migrations/20261118200000_agent_replies.sql`: `state` working → done / failed, `steps`), one per thread at a time (a unique index); a message written meanwhile gets the next answer. Realtime now carries updates too, and a thread reloads once its subscription is live.
- [x] The status line (decision 4): what the agent is doing while it writes, then «Hecho · 3 s», which unfolds into its steps.
- [x] A vacancy filled lands in the agent's first thread, «Primeros pasos», where it introduces itself and proposes a first task (`POST /agents/:id/hello` opens the thread; the empty thread's reply is the introduction).
- [x] @agent brings that agent in: the agents a message mentions answer instead of the thread's own, if the asker may talk to them; a message that mentions only people gets no answer.
- Checked on the web against local Supabase with the real engine and store and a stand-in model (streaming, Bea's message answered live on Ana's screen, Redes arriving talking). The first real model call is on beta.
- Agents only talk today: no record, mail or tools, and their prompt says so.

**Step 4, decision cards in the chat** (decision 5): needs agents that can raise decisions, which needs the engine to give them the record and tools ([build-first-version.md](build-first-version.md), «The engine»). A message part of type decision, drawn as the Hoy card.
