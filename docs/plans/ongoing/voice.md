# Voice: speak, and it's transcribed into the message

**Priority:** medium — people on the go, and many small-business owners, would rather speak than type
**Gate:** none
**Next:** run `scripts/setup-env.sh` on beta (Jaime's go-ahead), then a live note in Spanish and English from the beta app (iPhone, Android, web)

Jaime's idea (2026-11-18). On 2026-11-22 he skipped the trial («monta el audio directamente con Gemini, sin la prueba») and approved the design below; it is being built.

**Price and plan (Jaime, 2026-11-22).** Gemini 3.5 Transcribe on Vertex AI costs about **0.005 USD a minute** (list price of 2026-11-19, research below): a 2-minute note is about 1 cent, 1,000 minutes a month about 5 USD. **Dictation will be part of the premium plan.** No plans or prices exist in the product yet (they belong to the product plan, `ghostaff-producto.md`); until they do, everyone signed in can dictate and Ghostaff pays. When premium exists, the engine's `/transcribe` is where to gate it, by the organisation it receives.

## Goal

The person speaks instead of typing. The audio is transcribed straight into the message box, they read it, fix it if needed, and send it as text. It works as in Claude's own app: no audio is sent to the agent, only the text.

## Context

- The mic on Hoy, Equipo and Registro already opens a thread with Secretaría, but speaking is the keyboard's own dictation for now ([team-chat.md](../ongoing/team-chat.md), step 2). That depends on the phone's keyboard, isn't obvious, and transcribes long, messy speech poorly.
- What Jaime means is what he does with Claude: record a long note, it's transcribed automatically, and he sends the text. **It isn't about sending voice notes** to the agents, nor about agents answering in audio.
- The weekly summary in audio ([app-design.md](../ongoing/app-design.md), decision 15) is a separate thing and doesn't change.

**Confirmed (Jaime, 2026-11-22):** «hablar con los agentes por audio» means exactly this, speech turned into text in the message box, **in Spanish and in English**, the language detected on its own (a note may mix both). Not voice notes kept as audio, not agents answering by voice.

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

**Approaches.** (a) Record the whole note, send it once, transcribe in one call: my pick, the simplest that meets 10 minutes (a sync call takes 15). (b) Stream while speaking for live text: nicer, much more to build, and a 10-minute streaming cap; later. (c) The phone's own recogniser: ruled out on 2026-11-21 (the web sends audio to Google with no EU guarantee; iOS stops around a minute).

## Tasks (branch `feat/voice-dictation`, one PR, landed with `pnpm pr:land`)

1. **Engine, `POST /transcribe`** (`apps/engine/src/transcribe.ts`, wired in `app.ts`/`server.ts`): signed-in caller, `?org=<id>` must be an organisation they belong to (403 otherwise); body is the raw audio with an `audio/*` Content-Type, at most 20 MB (413 beyond); calls Gemini on Vertex AI (`generateContent`, location `eu`, the engine's own credentials and `GCP_PROJECT`, model from `TRANSCRIBE_MODEL`, default the Gemini 3.5 Transcribe id as Vertex names it) with the audio inline and an instruction: transcribe exactly what is said in the language spoken (Spanish, English or both), add punctuation, drop filler words, apply the speaker's own corrections, never add, summarise or translate; return only the text. Answers `{ text }`; empty speech gives `{ text: '' }`. The audio is never written anywhere or logged. The model call sits behind an injected `transcriber` (a fake in tests; off with a warning when not configured, answering 503). Vitest: auth, membership, size, content type, the fake's text passed through.
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
