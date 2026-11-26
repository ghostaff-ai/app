// Turning a voice note into text (docs/plans/ongoing/voice.md; the notes
// themselves are voiceNotes.ts). Gemini 3.5 Transcribe on Vertex AI in the `eu`
// multi-region does it, from Ghostaff's own Google Cloud project, whatever AI
// account the organisation connected. Neither the audio nor the text is ever
// logged; what is logged is a status, a type and a size.

import { Refusal } from './connections';

export interface Transcriber {
  /** The note's text, '' when nobody spoke. */
  transcribe(audio: Uint8Array, mimeType: string): Promise<string>;
}

/**
 * A 10-minute note is about 2.4 MB at the app's 32 kbit/s; 10 MB leaves room for
 * other formats and stays well under what Vertex takes inline (the audio goes
 * in base64, a third larger).
 */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

/**
 * Cost guard: each person gets `max` notes per rolling `windowMs`, counted in
 * memory (a restarted or second instance counts again from zero; it is a guard
 * against a runaway client, not an accounting). Clock and limits are injectable.
 */
export class NoteLimiter {
  private readonly sent = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(opts: { max?: number; windowMs?: number; now?: () => number } = {}) {
    this.max = opts.max ?? 30;
    this.windowMs = opts.windowMs ?? 3_600_000;
    this.now = opts.now ?? Date.now;
  }

  /** Counts one note for `userId`; false when they are over the limit. */
  take(userId: string): boolean {
    const t = this.now();
    const recent = (this.sent.get(userId) ?? []).filter((at) => at > t - this.windowMs);
    if (recent.length >= this.max) {
      this.sent.set(userId, recent);
      return false;
    }
    recent.push(t);
    this.sent.set(userId, recent);
    return true;
  }
}

/** Gemini 3.5 Transcribe as Vertex AI names it for prerecorded files (not `-live`, which streams). */
export const DEFAULT_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe';

/** An authenticated Google API call, as the engine's own service account; Google's status comes back, never thrown. */
export type GoogleRequest = (url: string, body: unknown, opts?: { timeoutMs?: number }) => Promise<{ status: number; data: unknown }>;

/**
 * How long Google gets to transcribe one note. A 10-minute note in a single sync
 * call takes a fair share of that;
 * past 2 minutes the person has long given up waiting on «Transcribiendo…», and
 * without it a hung call would hold the request open up to the engine's 15-minute
 * Cloud Run timeout (scripts/deploy-engine.sh).
 */
export const TRANSCRIBE_TIMEOUT_MS = 120_000;

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
      const body = {
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: Buffer.from(audio).toString('base64') } }] }],
        generationConfig: { audioTranscriptionConfig: { mode: 'SMART' } },
      };
      let res: { status: number; data: unknown };
      try {
        res = await opts.request(url, body, { timeoutMs: TRANSCRIBE_TIMEOUT_MS });
      } catch {
        console.warn('transcribe: vertex', 'timeout', mimeType, audio.byteLength); // numbers and type only, never content
        throw new Refusal(502, 'provider_unavailable', 'no answer from Vertex AI');
      }
      // Only the status, never Google's answer: it could quote what was said.
      if (res.status < 200 || res.status >= 300) {
        console.warn('transcribe: vertex', res.status, mimeType, audio.byteLength);
        throw new Refusal(502, 'provider_unavailable', `Vertex AI answered ${res.status}`);
      }
      const parts = (res.data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0]?.content?.parts ?? [];
      return parts.map((p) => p.text ?? '').join('').trim();
    },
  };
}

/**
 * The audio's bare type from a request's Content-Type, or a 415. Chrome sends
 * `audio/webm;codecs=opus` and Google's list names `audio/webm`; iOS names an
 * .m4a `audio/x-m4a`, which Vertex lists as `audio/mp4`.
 */
export function audioType(contentType: string | undefined): string {
  const bare = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  const mimeType = bare === 'audio/x-m4a' || bare === 'audio/m4a' ? 'audio/mp4' : bare;
  if (!/^audio\/[\w.+-]+$/.test(mimeType)) throw new Refusal(415, 'unsupported_media', 'send the audio with an audio/* Content-Type');
  return mimeType;
}

/** A request's audio, at most `max` bytes, a voice note's by default (413 beyond, 400 when empty). */
export async function readAudio(
  note: { contentLength: string | undefined; body: ReadableStream<Uint8Array> | null },
  max: number = MAX_AUDIO_BYTES,
): Promise<Uint8Array> {
  if (Number(note.contentLength) > max) throw tooLarge(max);
  const audio = await readAtMost(note.body, max);
  if (audio.byteLength === 0) throw new Refusal(400, 'bad_request', 'no audio');
  return audio;
}

const tooLarge = (max: number) => new Refusal(413, 'too_large', `audio over ${max} bytes`);

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
      throw tooLarge(max);
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
