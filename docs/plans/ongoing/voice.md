# Voice: voice notes in the chat, and dictation

**Priority:** medium — people on the go, and many small-business owners, would rather speak than type
**Gate:** none
**Next:** on beta, run `scripts/setup-env.sh` (Vertex AI for the engine; Jaime's go-ahead), then send a voice note in Spanish and one in English from the beta app on iPhone, Android and the web, and play each on another device

Two pieces, in order:

1. **Dictation** (Jaime's idea, 2026-11-18; built in PR 46 on 2026-11-22): speak, the transcript lands in the message box, you review it and send text. **Replaced by voice notes on 2026-11-23** (decision 1 below): the mic now sends the note, and the engine's `/transcribe` is gone. Sections «Goal» to «Open questions» below are its record, and the research on who transcribes still holds.
2. **Voice notes** (Trello card «hablar por audios», Jaime, 2026-11-23): as in WhatsApp, you record an audio and send it; it shows in the chat as an audio you can play, with its transcript under it, and the agent answers in text. Not a live voice conversation. Designed in the next section; Jaime took all five picks on 2026-11-23; built on branch `claude/voice-notes-5d8642`.

## Voice notes (Jaime, 2026-11-23)

**What changes from dictation.** The audio is the message: it is sent at once (no review of the text first), kept so it can be played back, and drawn as an audio bubble. The transcript is what the agent reads and what the person sees under the audio. The agent always answers in text.

**What is reused.** The engine's transcriber (`apps/engine/src/transcribe.ts`: Gemini 3.5 Transcribe on Vertex AI in `eu`, SMART mode, 10 MB cap, 30 notes an hour per person), the app's recorder (now `apps/mobile/lib/hooks/useVoiceNote.ts`, `expo-audio`, 32 kbit/s, 10-minute auto-stop), the recording bar (now `components/chat/RecordingBar.tsx`) and the agent's reply (`chat.ts`, `replyInThread`). `expo-audio` is already in the app, so this needs no new native module: an over-the-air update, not a build.

### How it works

1. **Recording.** In the chat with an agent, tap the mic: the box turns into the recording bar (red dot, m:ss, «Cancelar») and the send button sends the note. Up to 10 minutes; at 10:00 it stops and is sent. Under a second, it was a tap by mistake: nothing is sent («La nota es demasiado corta»). When something else stops it (a call takes the microphone, the app goes to the background), the note is kept unsent, with «Enviar» and «Descartar»; so is a note that couldn't be sent. iOS and Android ask for the microphone the first time, as today.
2. **Sending.** Two calls (`apps/engine/src/voiceNotes.ts`), because Cloud Run keeps the CPU only while a request is open. `POST /agents/:id/voice-notes?durationMs=` (raw body, `audio/*`): the engine checks the person may talk to the agent, applies the type, 10 MB and 30-an-hour limits, opens the person's own chat with the agent if needed (so a note can be the first message), stores the audio, writes the message and answers `201` with it. The app then calls `POST /voice-notes/:messageId/transcribe`, which transcribes it, puts the text into the message and lets the agent answer, answering once both are done (the author only; also the retry). The bubble shows at once with «Transcribiendo…»; the transcript and then the agent's answer arrive live through Realtime, as replies do today.
3. **Where the audio is kept.** A private Supabase Storage bucket `voice-notes`, in the same project as the messages (Frankfurt: data stays in the EU, on storage we own, invariant 2), at `<org_id>/<thread_id>/<message_id>.<ext>`. Only the engine writes there (service role, rule 3); the app writes nothing to storage or tables (rule 2). Reading: a `storage.objects` select policy lets a person read a note only when `thread_level` of the path's thread isn't `none` for them; the app gets a short-lived signed URL through `@ghostaff/shared/services` (rule 1). pgTAP proves another organisation's member, and another person of the same organisation (personal chats), can't read it.
4. **The message.** One `person` message whose parts are `{ type: 'voice', path, mediaType, durationMs, transcription: 'pending' | 'done' | 'empty' | 'failed' }` (`VoicePart` in `packages/shared/src/chat.ts`; not the AI SDK's `file`, which needs a URL a private bucket doesn't have) and, once transcribed, `{ type: 'text', text }`. `messageText` already reads only text parts, so the agent, the thread list's preview and search read the transcript and need no change. Not `messages.state`: a unique index allows one `working` message per thread, and that one is the agent's reply.
5. **Who transcribes, and the cost.** As for dictation: Gemini 3.5 Transcribe on Vertex AI in the `eu` multi-region (processing only in EU member states), from Ghostaff's own Google Cloud project, about 0.005 USD a minute; Ghostaff pays, part of the premium plan when it exists. Storage at 32 kbit/s is about 14 MB per hour of audio: Supabase's Free plan (1 GB) holds about 70 hours, Pro (100 GB included) about 7,000. Before production, the same checklist as dictation (Vertex quota cap, budget alert, zero data retention).
6. **The bubble** (on the right, in the accent colour, like the person's text bubbles; `components/chat/VoiceNote.tsx`): a play/pause button, a progress bar (tap it to jump; a screen reader moves it 5 s at a time) and the duration (1:24); under it, the transcript in the bubble's text size. The audio is fetched on the first play, through a signed link valid for an hour; one note plays at a time. While transcribing, «Transcribiendo…»; nobody spoke, «No se ha oído nada»; if it fails, or a note was left «pending» over 3 minutes (the app closed before asking), «No se ha podido transcribir · Reintentar», and the agent doesn't answer until there is text. The audio plays even when the transcript failed.
7. **The agent** reads the transcript as the message's text. It doesn't hear the audio; it answers in text.
8. **Web and iPhone.** iPhone's player can't play WebM, so the web asks the browser for AAC in MP4 (`audio/mp4;codecs=mp4a.40.2`), as the phones record. Chrome (checked on 2026-11-23, Chromium 156) and Safari can; Firefox can't and records WebM, which then plays on the web and Android but shows «No se puede reproducir aquí» on an iPhone (the transcript still reads). No conversion in the engine: ffmpeg in its image would weigh more than that gap is worth; revisit if notes recorded in Firefox matter.

### Decisions (Jaime, 2026-11-23: «todas las a»)

All five picks taken: one mic that sends voice notes (dictation goes), tap to start, audio kept as long as the message, transcript always shown, only in the chat with an agent.


1. **Dictation and voice notes.** (a) The mic sends voice notes and dictation goes away (one mic, one behaviour, as in WhatsApp): my pick. (b) Both: tap the mic for a voice note, and a second way («Dictar») to get the text into the box. (c) Dictation stays as it is, voice notes are a second button.
2. **How you record.** (a) Tap to start, then send or cancel: my pick (works the same on the web and with a screen reader, and long notes don't need a finger held down). (b) Hold to record and release to send, slide to cancel, as in WhatsApp.
3. **How long the audio is kept.** (a) As long as the message: my pick (it is part of the conversation). (b) 30 days, then only the transcript stays.
4. **The transcript in the bubble.** (a) Always shown under the audio: my pick (it is what you scan when you come back to a chat). (b) Folded behind «Ver transcripción», as in WhatsApp.
5. **Where.** (a) Only in the chat with an agent (`chat/[agent]`): my pick. (b) Also in the older shared threads (`conversacion/[id]`), where other people would hear it.

Not in this version: agents answering in audio, a live voice conversation, text appearing while you speak, editing a note's transcript, and the mic on Hoy, Equipo and Registro (still opens the chat with Secretaría).

### Progress (branch `claude/voice-notes-5d8642`, one PR)

- [x] Database: `supabase/migrations/20261124500000_voice_notes.sql` (bucket, `can_hear_voice_note`, the read policy), pgTAP `voice_notes.test.sql` (11 checks).
- [x] Engine: `voiceNotes.ts` and its routes; `/transcribe` and dictation's flow removed, `transcribe.ts` keeps the transcriber and the audio checks. Vitest `voiceNotes.test.ts`.
- [x] Shared: `VoicePart`, `isVoicePart`, `sendVoiceNote`, `transcribeVoiceNote`, `voiceNoteUrl`, with tests.
- [x] App: `useVoiceNote`, `RecordingBar`, the composer's mic, `VoiceNote` in `MessageView`, wired in `chat/[agent]`; the mic is gone from `conversacion/[id]`. Jest for the composer and the bubble; `expo-audio` stood in for in `test/setup.ts`.
- [x] Checked on the web against local Supabase, with the real routes and stores and a stand-in transcriber and writer (this machine has no Vertex access): a note sent as `audio/mp4`, stored, its bubble, playing it from the bucket through the signed link, a failed transcript live, «Reintentar», the text, the agent's answer; light, dark, phone width. The microphone itself is blocked in that browser: recording is covered by the unit tests only.
- [ ] On beta and on phones (Next above): real recording, Gemini's transcript, playback across devices.

Tasks as planned:

1. **Database.** A migration: the private bucket `voice-notes`, the read policy by `thread_level` on the path's thread; the engine writes the message with the service role. pgTAP in `supabase/tests/database/voice_notes.test.sql`: the person reads their note; another member doesn't (personal chat); another organisation doesn't; nobody but the service role writes.
2. **Engine.** `apps/engine/src/voiceNotes.ts`: `POST /threads/:id/voice-notes` (talk level as the caller, type, 10 MB, limiter shared with `/transcribe`, store, write the message, answer, then transcribe in the background, update the parts, ask the agent) and `POST /voice-notes/:messageId/transcribe` (retry, the author only). Storage and transcriber injected, fakes in Vitest: refusals (no talk, someone else's chat, wrong type, too large, too many), the message's parts before and after, a failed transcription marked `failed` and the agent not asked, a retry.
3. **Shared.** `sendVoiceNote(engine, threadId, audio, mimeType, durationMs)`, `retryTranscript(engine, messageId)`, `voiceNoteUrl(supabase, path)` in `@ghostaff/shared/services`; `isAudioPart` beside `isActionPart` in `chat.ts`, with tests.
4. **App.** The recorder hook sends instead of transcribing (or both, per decision 1); `VoiceNote` in `components/chat/` (play/pause, progress, duration, transcript, its states) drawn by `MessageView` for an audio part; the web records mp4 where it can. Jest with the recorder, the player and the services mocked. The Maestro flow of the chat updated if it changes.
5. **Check.** `pnpm check`, `pnpm db:test`; the web against local Supabase and the engine with a fake transcriber (record, bubble, «Transcribiendo…», the text, the agent's answer, playback, a failed transcription and its retry); then `pnpm pr:land`.

**Price and plan (Jaime, 2026-11-22).** Gemini 3.5 Transcribe on Vertex AI costs about **0.005 USD a minute** (list price of 2026-11-19, research below): a 2-minute note is about 1 cent, 1,000 minutes a month about 5 USD. **Dictation will be part of the premium plan** (voice notes, which replaced it, too). No plans or prices exist in the product yet (they belong to the product plan, `ghostaff-producto.md`); until they do, everyone signed in can dictate and Ghostaff pays. When premium exists, `POST /agents/:id/voice-notes` is where to gate it, by the agent's organisation.

## Goal

The person speaks instead of typing. The audio is transcribed straight into the message box, they read it, fix it if needed, and send it as text. It works as in Claude's own app: no audio is sent to the agent, only the text.

## Context

- The mic on Hoy, Equipo and Registro already opens a thread with Secretaría, but speaking is the keyboard's own dictation for now ([team-chat.md](../ongoing/team-chat.md), step 2). That depends on the phone's keyboard, isn't obvious, and transcribes long, messy speech poorly.
- What Jaime means is what he does with Claude: record a long note, it's transcribed automatically, and he sends the text. **It isn't about sending voice notes** to the agents, nor about agents answering in audio.
- The weekly summary in audio ([app-design.md](../ongoing/app-design.md), decision 15) is a separate thing and doesn't change.

**Confirmed (Jaime, 2026-11-22):** «hablar con los agentes por audio» means exactly this, speech turned into text in the message box, **in Spanish and in English**, the language detected on its own (a note may mix both). Not voice notes kept as audio, not agents answering by voice. **Widened on 2026-11-23**: Jaime now wants voice notes kept as audio too («Voice notes» above); agents still answer in text.

## The idea

1. **A mic button of our own in the chat's message box**, next to send. Press it and talk for as long as you need: a long, loose explanation, as you would in a voice note.
2. **When you stop, the transcript goes into the message box** as editable text. Nothing is sent on its own.
3. **The person reviews and sends.** The message is ordinary text, so the agent, the thread and the record treat it like any other.
4. **The audio isn't kept.** Once transcribed, it's discarded.

## Who could transcribe: research of 2026-11-19

What matters: Spanish from Spain and English (Jaime, 2026-11-22), notes of 2–5 minutes, noise (a bar, a car), audio processed in the EU and discarded, and the web too (the app is iPhone, Android and web). List prices of that day; sources in the conversation of that night.

| Option | EU processing | Long notes | Price per minute | Notes |
|---|---|---|---|---|
| The phone's own recogniser (`expo-speech-recognition`) | On-device only if the phone supports Spanish offline; **on the web the browser sends the audio to Google's servers**, no EU guarantee | iOS's server mode stops around a minute; Android needs 13+ for continuous | Free | Quality depends on each phone; breaks invariant 2 on the web |
| **Gemini 3.5 Transcribe on Vertex AI, `eu`** | Yes: EU multi-region, processing only in EU member states, same Google Cloud project as Claude on Vertex | 15 min per call, 10 min streaming | about 0.005 (sync) | Its «smart» mode drops filler words, applies spoken corrections («el martes, no, el miércoles») and punctuates |
| Chirp 3 (Speech-to-Text v2), `eu` | Yes, EU multi-region (not europe-west1) | Streaming up to 5 min a session; batch from a bucket | 0.016 (batch 0.003) | Has a background-noise filter |
| ElevenLabs Scribe | EU endpoint only on Enterprise, and processing may still leave the EU | `[unknown]` | about 0.0035 | |
| Mistral Voxtral | EU endpoint processes in the EU and EFTA | `[unknown]` | 0.0035–0.008 | |
| OpenAI gpt-4o-transcribe | EU endpoint through sales only | `[unknown]` | 0.003–0.006 | |

**Proposal:** record in the app with `expo-audio` (works on the web too), send the file to the engine in europe-west1, which transcribes it with **Gemini 3.5 Transcribe in `eu`** (smart mode answers open question 4 too) and deletes the audio; the text goes back into the message box. **Fallback:** Chirp 3 in `eu`. No independent benchmark of Spanish in noise was found: only the providers' own claims, hence the trial with real notes first.

## Design (Jaime, 2026-11-22)

- **A mic in the chat's message box**, next to send. Press and speak, **up to 10 minutes** (it stops on its own then); while recording, the time and buttons to stop or cancel. On stop, «Transcribiendo…», then the text lands in the box. **Nothing is sent on its own**: the person reads, fixes and sends.
- **Spanish and English**, detected on their own, a note may mix both.
- **Light tidying**: punctuation, filler words dropped («eh», «o sea»), spoken corrections applied («el martes, no, el miércoles» → «el miércoles»). Never rewritten, summarised or translated.
- **How:** the app records with `expo-audio` (web too) and sends the file to the engine; the engine checks the person is a member of the organisation, calls Gemini on Vertex AI in `eu`, returns the text and drops the audio. Nothing is stored or logged.
- **Ghostaff pays**, from its own Google Cloud project (`ghostaff-beta`, `ghostaff-prod`), so it works whatever AI account the organisation connected.
- **Not in this version:** text appearing while you speak (needs streaming; a second version), and the mic on Hoy, Equipo and Registro, which keeps opening the thread with Secretaría.
- `expo-audio` is a new native module: the next beta is a build, not an over-the-air update. iOS and Android ask for the microphone the first time.

**Before production:**
- A Vertex quota cap for the model and a budget alert on `ghostaff-beta` and `ghostaff-prod`.
- Vertex zero data retention on both projects (Vertex caches inputs for up to 24 h unless it is disabled).
- The per-person limit, 30 notes per rolling hour, is already in the engine (`too_many`); the app says so in Spanish.

**Approaches.** (a) Record the whole note, send it once, transcribe in one call: my pick, the simplest that meets 10 minutes. (b) Stream while speaking for live text: nicer, much more to build, and a 10-minute streaming cap; later. (c) The phone's own recogniser: ruled out on 2026-11-21 (the web sends audio to Google with no EU guarantee; iOS stops around a minute).

## Tasks (branch `feat/voice-dictation`, one PR, landed with `pnpm pr:land`)

1. **Engine, `POST /transcribe`** (`apps/engine/src/transcribe.ts`, wired in `app.ts`/`server.ts`): signed-in caller, `?org=<id>` must be an organisation they belong to (403 otherwise); body is the raw audio with an `audio/*` Content-Type, at most 10 MB (413 beyond; 10 minutes at 32 kbit/s is about 2.4 MB); calls Gemini on Vertex AI (`generateContent`, location `eu`, the engine's own credentials and `GCP_PROJECT`, model from `TRANSCRIBE_MODEL`, default the Gemini 3.5 Transcribe id as Vertex names it) with the audio inline and an instruction: transcribe exactly what is said in the language spoken (Spanish, English or both), add punctuation, drop filler words, apply the speaker's own corrections, never add, summarise or translate; return only the text. Answers `{ text }`; empty speech gives `{ text: '' }`. The audio is never written anywhere or logged. The model call sits behind an injected `transcriber` (a fake in tests; off with a warning when not configured, answering 503). Vitest: auth, membership, size, content type, the fake's text passed through.
2. **Service** `transcribe(engine, orgId, audio: Blob, mimeType)` in `@ghostaff/shared/services`, like `decideAction`.
3. **App**: `expo-audio` with its config plugin and the microphone permission in Spanish; a `DictateButton` in `components/chat/Composer.tsx` beside send (shown only while the box is empty or always, implementer's call matching the design: mic, recording with mm:ss, stop, cancel, «Transcribiendo…»), auto-stop at 10:00, the text appended to what is already in the box; errors in Spanish in the composer's error line («No he podido transcribirlo. Inténtalo otra vez.»), permission denied explained. Tests with the recorder and the service mocked.
4. **Cloud**: `scripts/setup-env.sh` enables `aiplatform.googleapis.com` and grants the engine `roles/aiplatform.user` in its own project; `TRANSCRIBE_MODEL` passed by `scripts/deploy-engine.sh` if not defaulted. Running setup on beta or prod is Jaime's go-ahead.
5. **Check**: the engine locally against Vertex with a generated Spanish and English note (`say -o`), then the web against local Supabase (mic button, states, text landing), then `pnpm pr:land`.

## Open questions

Questions 1, 3 and 4 below were settled by the design above (2026-11-22); 2 too: up to 10 minutes, the text all at once at the end.


1. **Decided (Álvaro, 2026-11-21): Gemini 3.5 Transcribe on Vertex AI in the EU, after the trial.** He asked first in the deck (2026-11-21) whether, with the phone's own recogniser, leaving the EU would be the user's responsibility rather than ours. Answer given in the session: when our button starts the recogniser, choosing it is ours, so it counts as our processing (the web sends audio to Google with no EU guarantee); only the keyboard's own dictation, which a person turns on themselves, is their tool. **Who transcribes:** on the phone (the system's speech recognition), the organisation's own AI provider ([llm-connectors.md](../ongoing/llm-connectors.md)), or a dedicated speech service. What matters: good Spanish, long notes, background noise, and cost. Proposal above: Gemini 3.5 Transcribe on Vertex AI in the EU, run by the engine; whether it is billed to Ghostaff or to the organisation's own AI account follows llm-connectors.md.
2. **Long notes:** the maximum length, and whether the text appears as you speak or all at once at the end.
3. **The mic on Hoy, Equipo and Registro:** whether it switches to this too, opening the thread with the transcript already in the box.
4. **Tidying the text:** whether the transcript is sent as spoken, or lightly cleaned up first (punctuation, filler words) without changing what was said.
