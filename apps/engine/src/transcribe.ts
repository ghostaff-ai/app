// Dictation (docs/plans/ongoing/voice.md): a person records a voice note in the
// chat's message box, the app sends the audio here, and the text goes back into
// the box for them to review and send. Gemini 3.5 Transcribe on Vertex AI in
// the `eu` multi-region does the transcribing, from Ghostaff's own Google Cloud
// project, whatever AI account the organisation connected. The audio lives only
// in memory for the call: never written anywhere, never logged, nor is the text.

import { Refusal, requireMember, type Store } from './connections';

export interface Transcriber {
  /** The note's text, '' when nobody spoke. */
  transcribe(audio: Uint8Array, mimeType: string): Promise<string>;
}

/** A 10-minute note is a few MB in any of the browsers' or phones' formats; 20 MB leaves room. */
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

/** Gemini 3.5 Transcribe as Vertex AI names it for prerecorded files (not `-live`, which streams). */
export const DEFAULT_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';

/** An authenticated Google API call, as the engine's own service account. */
export type GoogleRequest = (url: string, body: unknown) => Promise<{ status: number; data: unknown }>;

/**
 * Gemini on Vertex AI's EU multi-region endpoint: the processing stays in EU
 * member states (invariant 2). SMART mode punctuates, drops filler words and
 * keeps only a speaker's correction; with no language given, the model detects
 * it on its own, Spanish and English mixed in one note included. The model
 * takes audio only: no prompt, no system instruction.
 */
export function vertexTranscriber(opts: { project: string; model: string; request: GoogleRequest }): Transcriber {
  const url =
    `https://aiplatform.eu.rep.googleapis.com/v1/projects/${opts.project}/locations/eu` +
    `/publishers/google/models/${opts.model}:generateContent`;
  return {
    async transcribe(audio, mimeType) {
      const res = await opts.request(url, {
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: Buffer.from(audio).toString('base64') } }] }],
        generationConfig: { audioTranscriptionConfig: { mode: 'SMART' } },
      });
      // Only the status: Google's answer could quote what was said.
      if (res.status < 200 || res.status >= 300) throw new Error(`vertex answered ${res.status}`);
      const parts = (res.data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p.text ?? '').join('').trim();
    },
  };
}

export interface TranscribeDeps {
  store: Pick<Store, 'membership'>;
  /** Off when the engine has no Google Cloud project to bill (local work). */
  transcriber?: Transcriber;
}

/** One voice note from a member of `orgId`, turned into text. */
export async function transcribeNote(
  deps: TranscribeDeps,
  userId: string,
  orgId: unknown,
  note: { contentType: string | undefined; contentLength: string | undefined; body: ReadableStream<Uint8Array> | null },
): Promise<{ text: string }> {
  await requireMember(deps.store, orgId, userId);
  if (!deps.transcriber) throw new Refusal(503, 'transcription_off', 'dictation is not configured on this engine');
  const mimeType = note.contentType?.trim() ?? '';
  if (!/^audio\/[\w.+-]+/i.test(mimeType)) throw new Refusal(415, 'unsupported_media', 'send the audio with an audio/* Content-Type');
  if (Number(note.contentLength) > MAX_AUDIO_BYTES) throw tooLarge();
  const audio = await readAtMost(note.body, MAX_AUDIO_BYTES);
  if (audio.byteLength === 0) throw new Refusal(400, 'bad_request', 'no audio');
  return { text: await deps.transcriber.transcribe(audio, mimeType) };
}

const tooLarge = () => new Refusal(413, 'too_large', `audio over ${MAX_AUDIO_BYTES} bytes`);

/** The body's bytes, refused as soon as they pass `max`: a missing or false Content-Length doesn't get past it. */
async function readAtMost(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const audio = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    audio.set(c, at);
    at += c.byteLength;
  }
  return audio;
}
