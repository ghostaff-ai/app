# Audio from an agent: an mp3 a run made, played in the agent's chat

**Priority:** high — La Mesa and Productor can't move off Telegram without it ([ordago-agents-in-ghostaff.md](ordago-agents-in-ghostaff.md), What Ghostaff builds for it, item 5)
**Gate:** none
**Next:** build on `feat/agent-audio`, stacked on `feat/group-chat-per-agent` (PR 84), and land it after that one

Jaime took this design as proposed on 2026-11-26 («Sí, ambas»). An agent on our runner makes an audio in its run (La Mesa's weekly episode, a Productor draft) and the people who work with it hear it in Ghostaff, with the player the voice notes already have ([voice.md](voice.md)). It replaces what Telegram does for those two today.

## Today, in `ghostaff-ai/agents` (2026-11-26)

- **La Mesa** renders two mp3s each Monday (English, then Spanish) with `podcast/render.py` in `ordago-app/business`, and `podcast/publish.py --send` uploads each to the bucket `ordago-podcast` (deleted after 7 days), signs a 2-hour link as `podcast-publisher@ordago-prod` and publishes it to Pub/Sub `ordago-prod/notify`; homelab's notify-gateway sends it to the La Mesa topic. Telegram's limit for a link is 20 MB. When both went out, its last message is `SIN NOVEDAD`.
- **Productor** uploads each draft to `ordago-agents-podcast/episodios/`, signs a 7-day link and puts it in its last message; `arranque/arrancar.py` finds `storage.googleapis.com/….mp3?…` links and sends them with `sendAudio` instead of as text.
- Both are for the two founders only.

## Design

1. **The run hands the file over through a folder.** The agent leaves each audio in `~/outbox/`; the file's name, without its extension, is its title. When Claude Code ends, the runner (root) reads the folder and uploads each file with `POST /runs/:id/audio`, with its ID token and the run's nonce, then reports as always. The agent never holds the nonce or any credential and calls nothing: the nonce stays root's, as it is for the spec and the tokens. Rejected: an engine endpoint the agent calls itself (it would need the nonce, which also fetches tokens and reports), and the engine fetching a signed link from the agent's text (it would depend on each customer's bucket and make the engine fetch any URL it is given).
2. **What the runner takes.** Regular files only (a symlink in the outbox is skipped: it could point at root's token files), `.mp3` or `.m4a`, at most **25 MB** each and **4** per run, in name order. A file it skips or can't upload is said in the run's report, which then reaches the chat.
3. **Where it lands: the agent's chat** ([group-chat-per-agent.md](group-chat-per-agent.md)), one message from the agent per audio, after the report's text. Everyone whose level on the agent isn't `none` hears it, so for La Mesa both founders. An audio is news: a run with one is noteworthy even when its text is `SIN NOVEDAD`, and then the text isn't posted, only the audio.
4. **Between the upload and the report**, the run keeps its audio in `agent_runs.audio` (never readable from the app, like `nonce_hash`). The report posts them; a run that dies without reporting has its audio removed by the tick when it is closed.
5. **Storage.** The voice notes' bucket `voice-notes`, at the same `<org_id>/<thread_id>/<message_id>.<ext>`, so the read policy (`can_hear_voice_note`, by the message's thread) covers it unchanged. The bucket's limit goes from 10 MB to 25 MB; voice notes keep their 10 MB in the engine. Kept as long as the message, like a voice note: La Mesa adds about 30 MB a week.
6. **The message part** is a new `{ type: 'audio', path, mediaType, durationMs, title }` (`AudioPart` in `packages/shared/src/chat.ts`), not a `VoicePart`: it has a title and no transcript. `durationMs` is null (the runner doesn't decode audio); the player shows the length once it has loaded. The agent's own context reads the message as «(Audio: <title>)».
7. **The app.** The player (play/pause, the bar to jump, the length, the signed link fetched on first play, one audio at a time) moves out of `VoiceNote.tsx` into `components/chat/AudioClip.tsx`; `VoiceNote` keeps its API and wraps it with the transcript, and the agent's bubble wraps it with the title. mp3 and m4a play on iPhone, Android and the web.
8. **The prompt.** Every run on our runner is told: to post an audio (mp3 or m4a, up to 25 MB, at most 4), leave it in `~/outbox/`; its name is its title.

## What La Mesa's and Productor's `AGENTS.md` must say when they move

Not done here: each moves with `org add-agents --runner ghostaff --only <agent>` in its own sitting (ordago-agents-in-ghostaff.md, Order).

- **La Mesa:** render both episodes as today; copy them to `~/outbox/` named for their title, English first (`La Mesa 2026-11-30 (EN).mp3`, `La Mesa 2026-11-30 (ES).mp3`, names in order); no `podcast/publish.py`, no bucket, no signed link, no Pub/Sub. If both are in the outbox, the last message is exactly `SIN NOVEDAD`; if something failed, what, in two lines. Its YAML's `gcp` loses `bucket:ordago-podcast`, `podcast-publisher@ordago-prod` and `ordago-prod/notify`; it keeps BigQuery and Vertex in `ordago-media`.
- **Productor:** each draft it wants the founders to hear goes to `~/outbox/` named for what it is (`Episodio 1 · borrador 3.mp3`); the last message, in Spanish and short, with its numbered questions and no link. It can keep `ordago-agents-podcast` for the archive of notes (`archivo/`), but no longer needs to sign links (`ordago-productor@ordago-agents` token creator) nor upload drafts there.

## Tasks

1. **Database** (`supabase/migrations/<ts>_agent_audio.sql`): `agent_runs.audio jsonb not null default '[]'` (no grant to `authenticated`); `voice-notes`' `file_size_limit` to 25 MB. pgTAP `agent_audio.test.sql`: an agent's audio message in its chat is heard by a member with `read` and not by another organisation's member; `agent_runs.audio` is unreadable from the app.
2. **Shared:** `AudioPart`, `isAudioPart`, `messageText` reading an audio as «(Audio: title)». Tests.
3. **Engine:** `POST /runs/:id/audio` (`runAudio` in `runner.ts`: our runner's identity, the nonce in `X-Run-Nonce`, a run running with its spec, mp3/m4a, 25 MB, 4 per run; stored in the agent's chat folder, appended to the run); `reportRun` posts them after the text and makes the run noteworthy; `expireRuns` removes the audio of a run it closes; `composePrompt` tells the agent about `~/outbox/`. Vitest.
4. **Runner:** make `~/outbox/` as the agent; after Claude Code, `outboxFiles` (pure, in `lib.ts`: what to take, what to skip and why) and the uploads in `main.ts`, skipped and failed files added to the report's text. Vitest.
5. **App:** `AudioClip`, `VoiceNote` on it, the agent's audio bubble in `Message.tsx`. Jest.
6. **Docs:** [architecture.md](../../architecture.md) (the runner's step list and the bucket), item 5 of ordago-agents-in-ghostaff.md.
7. **Check:** `pnpm check`, `pnpm db:test`, `pnpm pr:land`; then on the beta, a run of an on-demand agent that leaves an mp3 in `~/outbox/`, played in the app.

## Progress

- [ ] Tasks 1–7
