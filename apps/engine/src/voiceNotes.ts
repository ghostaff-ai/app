// Voice notes in the chat (docs/plans/ongoing/voice.md), as in WhatsApp: a
// person records an audio in their own chat with an agent and sends it; it is
// kept so it can be played back, and its transcript is what the agent reads.
// The agent answers in text.
//
// Two calls, so the person sees the note at once and Cloud Run keeps the CPU
// while the slow part runs (it does only while a request is open):
//   1. POST /agents/:id/voice-notes stores the audio in the private bucket
//      (supabase/migrations/20261124500000_voice_notes.sql), writes the message
//      with its transcription «pending» and answers with it.
//   2. POST /voice-notes/:id/transcribe turns it into text (transcribe.ts),
//      puts the text in the message and lets the agent answer. The app calls it
//      right after the first, and again as «Reintentar» when it failed.
// Neither the audio nor the transcript is ever logged.

import { randomUUID } from 'node:crypto';
import { type ChatMessage, isVoicePart, type VoicePart } from '@ghostaff/shared';
import { messageFromRow } from '@ghostaff/shared/services';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type ChatDeps, replyInThread } from './chat';
import { Refusal } from './connections';
import { audioType, type NoteLimiter, readAudio, type Transcriber } from './transcribe';

export const BUCKET = 'voice-notes';

/** The bucket and the person's messages, with the service role. */
export interface VoiceNoteStore {
  putAudio(path: string, audio: Uint8Array, mimeType: string): Promise<void>;
  getAudio(path: string): Promise<Uint8Array>;
  removeAudio(path: string): Promise<void>;
  /** Writes the person's message holding the note, signed with their name in the organisation. */
  addVoiceNote(note: { id: string; threadId: string; orgId: string; userId: string; part: VoicePart }): Promise<ChatMessage>;
  message(id: string): Promise<ChatMessage | null>;
  setParts(id: string, parts: ChatMessage['parts']): Promise<void>;
}

export interface VoiceNoteDeps {
  chat: ChatDeps;
  /** Without it, or without a transcriber, there are no voice notes. */
  voice?: VoiceNoteStore;
  /** Off when the engine has no Google Cloud project to bill (local work). */
  transcriber?: Transcriber;
  /** 30 notes an hour per person by default (transcribe.ts). */
  limiter: NoteLimiter;
}

const off = () => new Refusal(503, 'transcription_off', 'voice notes are not configured on this engine');

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

/** Ten minutes is the app's limit; a little more for the recorder's rounding. */
const MAX_DURATION_MS = 11 * 60_000;

/** The app's measure of the note, if it is a sensible one. */
function durationOf(raw: unknown): number | null {
  const ms = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return ms > 0 && ms <= MAX_DURATION_MS ? ms : null;
}

const EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

/**
 * Stores a voice note to `agentId` in the person's own chat with it, opening
 * the chat if it isn't yet, and returns the message, still to be transcribed.
 */
export async function sendVoiceNote(
  deps: VoiceNoteDeps,
  userId: string,
  agentId: unknown,
  note: { contentType: string | undefined; contentLength: string | undefined; body: ReadableStream<Uint8Array> | null; durationMs: unknown },
): Promise<ChatMessage> {
  if (!isUuid(agentId)) throw new Refusal(400, 'bad_request', 'agent must be a uuid');
  const agent = await deps.chat.chat.agent(agentId);
  if (!agent) throw new Refusal(404, 'not_found', 'agent not found');
  if ((await deps.chat.chat.levelFor(agent.id, userId)) !== 'talk') throw new Refusal(403, 'not_allowed', 'you may not talk to this agent');
  const { voice, transcriber } = deps;
  if (!voice || !transcriber) throw off();
  const mimeType = audioType(note.contentType);
  // After access and the type, before the body is read: a runaway client costs nothing.
  if (!deps.limiter.take(userId)) throw new Refusal(429, 'too_many', 'too many voice notes in the last hour');
  const audio = await readAudio(note);

  const threadId = await deps.chat.chat.personalChat(agent.orgId, agent.id, agent.name, userId);
  const id = randomUUID();
  const path = `${agent.orgId}/${threadId}/${id}.${EXTENSIONS[mimeType] ?? 'audio'}`;
  await voice.putAudio(path, audio, mimeType);
  let message: ChatMessage;
  try {
    message = await voice.addVoiceNote({
      id,
      threadId,
      orgId: agent.orgId,
      userId,
      part: { type: 'voice', path, mediaType: mimeType, durationMs: durationOf(note.durationMs), transcription: 'pending' },
    });
  } catch (e) {
    // No message points to it: don't keep the audio.
    await voice.removeAudio(path).catch(() => {});
    throw e;
  }
  await deps.chat.chat.touchThread(threadId);
  return message;
}

/**
 * Transcribes the person's own voice note and, when someone spoke, lets the
 * agent answer it. A note already transcribed is left as it is.
 */
export async function transcribeVoiceNote(
  deps: VoiceNoteDeps,
  userId: string,
  messageId: unknown,
  accessToken?: string,
): Promise<{ transcription: VoicePart['transcription']; replied: boolean }> {
  if (!isUuid(messageId)) throw new Refusal(400, 'bad_request', 'message must be a uuid');
  const { voice, transcriber } = deps;
  if (!voice || !transcriber) throw off();
  const message = await voice.message(messageId);
  // Someone else's message is as unknown as a missing one.
  if (!message || message.authorKind !== 'person' || message.authorUserId !== userId) throw new Refusal(404, 'not_found', 'voice note not found');
  const part = message.parts.find(isVoicePart);
  if (!part) throw new Refusal(400, 'bad_request', 'not a voice note');
  if (part.transcription === 'done' || part.transcription === 'empty') return { transcription: part.transcription, replied: false };

  const set = (transcription: VoicePart['transcription'], text?: string) =>
    voice.setParts(message.id, [{ ...part, transcription }, ...(text ? [{ type: 'text', text }] : [])]);
  // A retry shows «Transcribiendo…» again while it runs.
  if (part.transcription === 'failed') await set('pending');
  let text: string;
  try {
    text = await transcriber.transcribe(await voice.getAudio(part.path), part.mediaType);
  } catch (e) {
    await set('failed');
    throw e instanceof Refusal ? e : new Refusal(502, 'provider_unavailable', 'the note could not be transcribed');
  }
  if (!text) {
    await set('empty');
    return { transcription: 'empty', replied: false };
  }
  await set('done', text);
  const { replied } = await replyInThread(deps.chat, userId, message.threadId, accessToken);
  return { transcription: 'done', replied };
}

const MESSAGE_COLUMNS = 'id, thread_id, author_kind, author_user, author_agent, author_name, parts, state, steps, created_at';

export function supabaseVoiceNoteStore(admin: SupabaseClient): VoiceNoteStore {
  const bucket = () => admin.storage.from(BUCKET);
  return {
    async putAudio(path, audio, mimeType) {
      const { error } = await bucket().upload(path, audio, { contentType: mimeType, upsert: false });
      if (error) throw error;
    },
    async getAudio(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) throw error ?? new Error('voice note audio missing');
      return new Uint8Array(await data.arrayBuffer());
    },
    async removeAudio(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw error;
    },
    async addVoiceNote(note) {
      const { data: member, error: memberError } = await admin
        .from('memberships')
        .select('display_name')
        .eq('org_id', note.orgId)
        .eq('user_id', note.userId)
        .maybeSingle();
      if (memberError) throw memberError;
      const { data, error } = await admin
        .from('messages')
        .insert({
          id: note.id,
          thread_id: note.threadId,
          org_id: note.orgId,
          author_kind: 'person',
          author_user: note.userId,
          author_name: (member?.display_name as string | undefined) ?? '',
          parts: [note.part],
        })
        .select(MESSAGE_COLUMNS)
        .single();
      if (error) throw error;
      return messageFromRow(data);
    },
    async message(id) {
      const { data, error } = await admin.from('messages').select(MESSAGE_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? messageFromRow(data) : null;
    },
    async setParts(id, parts) {
      const { error } = await admin.from('messages').update({ parts }).eq('id', id);
      if (error) throw error;
    },
  };
}
