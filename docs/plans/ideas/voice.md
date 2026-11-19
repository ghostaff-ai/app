# Voice: speak, and it's transcribed into the message

**Priority:** medium — people on the go, and many small-business owners, would rather speak than type
**Gate:** decision:who transcribes (see Open questions; the research of 2026-11-19 proposes an answer)
**Next:** try the proposal below with 5–10 real notes recorded in a bar and in a car before deciding

Jaime's idea (2026-11-18), written down loosely. Don't treat any detail here as decided.

## Goal

The person speaks instead of typing. The audio is transcribed straight into the message box, they read it, fix it if needed, and send it as text. It works as in Claude's own app: no audio is sent to the agent, only the text.

## Context

- The mic on Hoy, Equipo and Registro already opens a thread with Secretaría, but speaking is the keyboard's own dictation for now ([team-chat.md](../ongoing/team-chat.md), step 2). That depends on the phone's keyboard, isn't obvious, and transcribes long, messy speech poorly.
- What Jaime means is what he does with Claude: record a long note, it's transcribed automatically, and he sends the text. **It isn't about sending voice notes** to the agents, nor about agents answering in audio.
- The weekly summary in audio ([app-design.md](../ongoing/app-design.md), decision 15) is a separate thing and doesn't change.

## The idea

1. **A mic button of our own in the chat's message box**, next to send. Press it and talk for as long as you need: a long, loose explanation, as you would in a voice note.
2. **When you stop, the transcript goes into the message box** as editable text. Nothing is sent on its own.
3. **The person reviews and sends.** The message is ordinary text, so the agent, the thread and the record treat it like any other.
4. **The audio isn't kept.** Once transcribed, it's discarded.

## Who could transcribe: research of 2026-11-19

What matters: Spanish from Spain, notes of 2–5 minutes, noise (a bar, a car), audio processed in the EU and discarded, and the web too (the app is iPhone, Android and web). List prices of that day; sources in the conversation of that night.

| Option | EU processing | Long notes | Price per minute | Notes |
|---|---|---|---|---|
| The phone's own recogniser (`expo-speech-recognition`) | On-device only if the phone supports Spanish offline; **on the web the browser sends the audio to Google's servers**, no EU guarantee | iOS's server mode stops around a minute; Android needs 13+ for continuous | Free | Quality depends on each phone; breaks invariant 2 on the web |
| **Gemini 3.5 Transcribe on Vertex AI, `eu`** | Yes: EU multi-region, processing only in EU member states, same Google Cloud project as Claude on Vertex | 15 min per call, 10 min streaming | about 0.005 (sync) | Its «smart» mode drops filler words, applies spoken corrections («el martes, no, el miércoles») and punctuates |
| Chirp 3 (Speech-to-Text v2), `eu` | Yes, EU multi-region (not europe-west1) | Streaming up to 5 min a session; batch from a bucket | 0.016 (batch 0.003) | Has a background-noise filter |
| ElevenLabs Scribe | EU endpoint only on Enterprise, and processing may still leave the EU | `[unknown]` | about 0.0035 | |
| Mistral Voxtral | EU endpoint processes in the EU and EFTA | `[unknown]` | 0.0035–0.008 | |
| OpenAI gpt-4o-transcribe | EU endpoint through sales only | `[unknown]` | 0.003–0.006 | |

**Proposal:** record in the app with `expo-audio` (works on the web too), send the file to the engine in europe-west1, which transcribes it with **Gemini 3.5 Transcribe in `eu`** (smart mode answers open question 4 too) and deletes the audio; the text goes back into the message box. **Fallback:** Chirp 3 in `eu`. No independent benchmark of Spanish in noise was found: only the providers' own claims, hence the trial with real notes first.

## Open questions

1. **Who transcribes:** on the phone (the system's speech recognition), the organisation's own AI provider ([llm-connectors.md](../ongoing/llm-connectors.md)), or a dedicated speech service. What matters: good Spanish, long notes, background noise, and cost. Proposal above: Gemini 3.5 Transcribe on Vertex AI in the EU, run by the engine; whether it is billed to Ghostaff or to the organisation's own AI account follows llm-connectors.md.
2. **Long notes:** the maximum length, and whether the text appears as you speak or all at once at the end.
3. **The mic on Hoy, Equipo and Registro:** whether it switches to this too, opening the thread with the transcript already in the box.
4. **Tidying the text:** whether the transcript is sent as spoken, or lightly cleaned up first (punctuation, filler words) without changing what was said.
