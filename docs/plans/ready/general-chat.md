# General: the people's chat, by voice, that the agents learn from

**Priority:** high — Órdago's founders talk about the business in a Telegram group the agents never read; moving that talk into Ghostaff is how the agents learn what the people decide
**Gate:** blocked:ghostaff-ai/app#84 (one chat per agent) and ghostaff-ai/app#81 (agent context): both change `threads`, `chat.ts` and the voice notes this builds on
**Next:** PR 1 (Tasks, below) on `feat/general-chat`, branched from `develop` once #84 and #81 have landed: the migration and its pgTAP test first, then the engine, then the app; land it with `pnpm pr:land`

**Goal:** Every organisation has one chat called **General** where its people talk to each other, mostly by voice notes, as in a WhatsApp group. Agents stay out of it unless someone @mentions one. What is said there reaches every agent once a day as a summary, and any agent can search it.

## Context

Jaime (2026-11-26): Álvaro and he send each other everything about Órdago through a Telegram chat, mostly audios. The goal is that those audios come into Ghostaff instead, so the agents can use them. «Igual que tenemos un chat en Telegram, tener un chat en Ghostaff [...] se llame general». It has to be voice-first and look like WhatsApp, «porque estamos muy acostumbrados». Nobody answers there: «es simplemente mandarnos audios entre nosotros como una conversación». It is made by default with each organisation, it is for the people, and «los agentes solo entran en juego si se les etiqueta». Once a day, what was said reaches the agents.

What exists on `develop` (with #84 and #81, about to land, 2026-11-26):

- **One chat per agent** ([group-chat-per-agent.md](../ongoing/group-chat-per-agent.md)): every `threads` row belongs to an agent (`agent_id not null`, `threads_one_per_agent`). Who reads or writes is the member's level on that agent (`thread_level_for` → `agent_level_for`). Pushes go out only for agent messages (`messages_notify`, route `/chat/<agent>`).
- **Voice notes** ([voice.md](../ongoing/voice.md)): `POST /agents/:id/voice-notes` stores the audio in the private bucket `voice-notes` at `<org>/<thread>/<message>.<ext>` and writes a person message with a `voice` part. `POST /voice-notes/:id/transcribe` transcribes it (Gemini 3.5 Transcribe on Vertex, `eu`) and then calls `replyInThread`. The bubble (`components/chat/VoiceNote.tsx`) always shows the transcript. Who may hear a note is `can_hear_voice_note` → `thread_level` of the note's message.
- **Who answers** (`whoAnswers` in `apps/engine/src/chat.ts`): the agents a person message @mentions. With no mention, the thread's own agent. With only people mentioned, nobody. `answerWaiting` replies one at a time, as the author of each message (team-chat.md decision 7).
- **What a chat turn reads** ([agent-context.md](../ongoing/agent-context.md), #81): a summary per `(thread, agent)` in `conversation_summaries`, the latest messages up to ~30K tokens, and a `conversation_search` tool over `search_thread_messages`. The summary is written through the organisation's own AI account (`writerFor`).
- **The tick**: Cloud Scheduler calls `/cron` every five minutes; it syncs records and starts what is due (`apps/engine/src/routines.ts`, `runner.ts`).
- **Órdago's agents run on runners, not as chat agents** ([ordago-agents-in-ghostaff.md](../ongoing/ordago-agents-in-ghostaff.md)): `ordago_job` (the legacy jobs, started with what the person wrote) or `ghostaff` (our runner, whose prompt the engine composes in `runSpec`). A chat agent's system prompt doesn't reach them.
- **The business brain** ([business-brain.md](../ongoing/business-brain.md)) gives Secretaría the company memory in the record (`memoria/empresa/`). It is the long-term home for what is decided in General. It is out of this plan: see Later.
- Another session is letting a runner agent post an audio it made (La Mesa's episode) into a chat with the same player. It keeps `VoicePart`'s shape, the bucket and its paths; this plan does too.

## Decisions

Jaime, 2026-11-26 (all my picks):

1. **Voice notes are transcribed, quietly.** Each note is transcribed in the background as it is sent, as in an agent's chat, so an @agent can answer it at once and the agents can read it. In General the bubble shows only the audio, and the transcript is folded behind «Ver transcripción».
2. **What is said reaches the agents as a daily summary plus a search.** Once a day the day's General is summarised; the latest summaries go into every agent's context, and every chat agent can search General's messages.
3. **One General per organisation**, with every person who is a member. Not one per department.
4. **Audio and text**, as in WhatsApp: the mic is the main button and you can also type (a quick @agent, a link).

## Design

### The chat

- **A thread without an agent.** `threads.kind` is `agent` (as today) or `general`. A `general` thread has no `agent_id`. There is one per organisation, made with it (a trigger on `organizations`), and the migration makes one for each existing organisation. It is titled «General».
- **Who reads and writes: every member.** `thread_level_for` answers `talk` for any member of the organisation on its General and `none` for anyone else. Owners have no extra rights in it. Everything that already reads `thread_level` follows from that: the threads, messages and read-marks policies, `post_message`, `mark_thread_read` and `can_hear_voice_note`. Agents have no level: the engine reads General with the service role only when an agent was @mentioned or when it writes the daily summary.
- **In Equipo**, General is pinned first, above Secretaría, with a group icon and its last line («Álvaro: 🎤 1:24»). It shows only once the organisation has two or more people: alone, there is nobody to talk to. That works the same in a company and in a personal space, so no screen checks `kind` (welcome-and-spaces.md).
- **The screen**, `app/(app)/general.tsx`: the header says «General» and the members' names. Messages from others sit on the left in bubbles with their name; yours sit on the right. Agents (only when mentioned) are flat with their ghost, as in their chats. The composer is today's: the mic when the box is empty, send when there is text, and @ suggests the agents the person may talk to and the members.
- **Voice notes in General**: the same recorder, bucket, part and player. `VoiceNote` takes `transcript: 'shown' | 'folded'`. In General it is folded behind «Ver transcripción», and its states («Transcribiendo…», «No se ha podido transcribir · Reintentar») show only when unfolded or failed.
- **Pushes**: a person's message in General sends a push to every other member who has a phone. Title: the author's name. Body: the text, or «Nota de voz · 0:38». Tapping it opens `/general`. A new `push_outbox.kind = 'message'` carries it, so `reply` keeps meaning an agent answered. Pushes about the same thread collapse into one (`collapse_id` = the thread), as in WhatsApp.

### Agents in General

- **Nobody answers unless @mentioned.** `answerWaiting` takes a thread with no home agent. With no mention, `whoAnswers` returns nobody, so a General message or voice note never starts a reply. With a mention, the mentioned agents answer, in General, as the author. The author must be able to talk to each one, or it stays out, as today.
- **What an @mentioned agent reads**: General as a conversation, with the agent-context window (its own summary of General in `conversation_summaries`, keyed `(thread, agent)`, the latest messages, `conversation_search`). Voice notes read as their transcript (`messageText`).
- **Runner agents mentioned in General** (`ordago_job`, `ghostaff`) answer as they do in their own chat: `askJob` / `askRunner` with the thread, and their report lands in General through `reply_to`.

### The daily summary

- **When**: on the first tick after midnight Europe/Madrid, the engine summarises the day that ended for each organisation whose General had messages that day. It catches up on up to 7 missed days, oldest first, and never redoes a day.
- **How**: through the organisation's own AI account, with the same `writerFor` and the same failover as agent-context's summaries. One prompt of ours, in Spanish: what was decided, what is pending and who owns it, facts about the business (numbers, names, dates), who said each thing, and no small talk. Transcripts are the input. A day with nothing worth keeping is saved as «Sin nada relevante», so it isn't retried.
- **Where**: table `general_digests` (`org_id`, `day`, `summary`, `through_message`, `created_at`; key `(org_id, day)`). Row-level security is on with no policy, so only the engine reads it. It is a projection of what members can already read, but nothing in the app needs it yet.
- **What every agent gets**:
  - **Chat agents**: a block in the system prompt, «Lo que se ha hablado en General», with the last 7 summaries, newest first, each dated. It changes once a day, so the cached prefix holds all day. They also get a `general_search(words, since?, until?)` tool over General's messages (`search_thread_messages` on the General thread), returning who, when and the text (a voice note's transcript).
  - **Our runner** (`ghostaff`): the same block in the prompt `runSpec` composes. No search tool: our runner has no engine tools yet.
  - **Legacy jobs** (`ordago_job`): nothing. They start from Telegram and their own timetables, which the engine doesn't compose. They get the block when they move to our runner (ordago-agents-in-ghostaff.md).
- **General is internal.** The block tells the agent that General is the team's private talk: it can use it to work, but never quote or forward it to anyone outside the organisation (external-parties.md).

## File Structure

PR 1, the chat:

- `supabase/migrations/<ts>_general_chat.sql`: `threads.kind` with a check that ties it to `agent_id` (an `agent` thread has one, a `general` thread has none), `agent_id` nullable, `threads_one_general_per_org` unique on `org_id` where `kind = 'general'`, a General for every organisation and a trigger for new ones. `thread_level_for` with the General case. `my_threads` returns `kind` and lists General first, plus how many people the organisation has. `messages_notify` adds the `message` push for a person in General, and the `push_outbox.kind` check allows `message`.
- `supabase/tests/database/general_chat.test.sql`: a member reads and writes General; another organisation's member sees nothing (thread, messages, read marks, a voice note's audio); an organisation has exactly one General; a new organisation gets one; a person message queues a push for the other member, not the author.
- `apps/engine/src/chat.ts`: `ChatThreadHead.agentId: string | null` and `kind`; `whoAnswers` with no home agent returns only the mentioned; `answerWaiting` with no home agent; `requireTalkIn` reads `threadLevelFor`, which already covers General.
- `apps/engine/src/voiceNotes.ts`: `POST /threads/:id/voice-notes` beside `POST /agents/:id/voice-notes`, for a thread the person may talk in; both share the store and the limits. Transcribing still calls `replyInThread`, which in General answers only @mentions.
- `apps/engine/src/app.ts`: the new route.
- `packages/shared/src/services/`: `generalChat(orgId)` (from `my_threads`), `sendVoiceNoteToThread`; `ChatThread.kind`.
- `apps/mobile/app/(app)/general.tsx` (new), `components/team/TeamList.tsx` (General pinned, two or more people), `components/chat/VoiceNote.tsx` (`transcript` folded), `lib/hooks/useChat.ts` (a thread by id, not only by agent), `lib/push/PushProvider.tsx` (`/general`), the desktop shell's list (`lib/layout.ts`).
- `.maestro/flows/ci/general-chat.yaml`: a second member writes in General, the first sees it live and answers. Voice is covered by unit tests, as in voice.md: the emulator has no microphone.
- Tests: `apps/engine/test/chat.test.ts` (no mention, no answer; a mention, that agent answers as the author; an agent the author can't talk to stays out), `voiceNotes.test.ts` (a note to General: stored, transcribed, nobody answers), Jest for `TeamList` and the folded `VoiceNote`.

PR 2, the daily summary:

- `supabase/migrations/<ts>_general_digests.sql` and `supabase/tests/database/general_digests.test.sql`: members of the organisation and of another see and change nothing.
- `apps/engine/src/generalDigest.ts` (new): `dueDays(org, now)`, the prompt, `digestDay` through `writerFor`, `digestsForPrompt(orgId)`, and the `general_search` tool.
- `apps/engine/src/routines.ts` (the tick calls `digestDue`), `chat.ts` (`systemPrompt` block, the tool in `reachOf`), `runner.ts` (`runSpec` block).
- Tests: `apps/engine/test/generalDigest.test.ts` (the day boundary in Madrid, catch-up of 7 days at most, never twice, a failed summary retried on the next tick, the prompt block's order, the tool's input checks).

## Tasks

### PR 1: General

1. [ ] Migration and pgTAP test. `pnpm db:test`.
2. [ ] Engine, test first: a thread without an agent in `answerWaiting` and `whoAnswers`; `POST /threads/:id/voice-notes`.
3. [ ] Shared: services and types, with tests.
4. [ ] App: General in Equipo and on the desktop list, the screen, the folded transcript, the push route; Jest.
5. [ ] Maestro flow `general-chat.yaml`; `pnpm e2e`.
6. [ ] Check on the web against local Supabase with two people: a text and a voice note live on the other screen, nobody answering, an @Secretaría answered in General, the push queued. `pnpm check`, then `pnpm pr:land`.

### PR 2: the daily summary

1. [ ] Migration and pgTAP test.
2. [ ] `generalDigest.ts`, test first.
3. [ ] The tick, the chat agents' prompt and tool, the runner's prompt.
4. [ ] Check against local Supabase with a stand-in writer: a day of messages summarised after midnight, the block in a chat agent's turn and in a runner spec, a search answered. `pnpm pr:land`.
5. [ ] `docs/architecture.md` (General and what a turn reads) and agent-context.md («Today»).

## Later

- **Into the record**: once Secretaría files into the company memory ([business-brain.md](../ongoing/business-brain.md)), she reads each day's summary and files what was decided, with a link back to General. The daily summary then also reaches agents through the record.
- **Telegram's history**: importing the Órdago Telegram chat into General (an export's audios and texts, transcribed and dated). A task of its own, if Jaime wants it.
- Agents answering in audio; a General per department; reactions and replies to one message, as in WhatsApp.

## Testing strategy

pgTAP: General's rule (members talk, nobody else sees anything, the audio included), one per organisation, the push. Vitest in the engine: nobody answers without a mention, the mentioned agent answers as the author, voice notes to General, the digest's days and its prompt block. Jest on the Equipo row and the folded transcript. Maestro: two people writing in General. On the web against local Supabase with a stand-in transcriber and writer, since CI runs no model.
