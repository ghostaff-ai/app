// Files in the chat, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md,
// phase 3): a photo, the camera or a document, in General or a chat with an
// agent. The engine stores it in the private bucket `documents`
// (supabase/migrations/20261128140000_chat_files.sql) at
// <org>/<thread>/<message>/<name>, writes the person's message with a
// `document` part (and its caption), and lets the agent answer as it would a
// text: in an agent's chat its agent; in General only those @mentioned. The
// agent sees a photo it is asked about (JPEG, the app sends photos as JPEG) and
// reads any other file as a line naming it. The bytes are never logged.

import { randomUUID } from 'node:crypto';
import type { ChatMessage, DocumentPart, MessagePart } from '@ghostaff/shared';
import { messageFromRow } from '@ghostaff/shared/services';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type ChatDeps, replyInThread } from './chat';
import { Refusal } from './connections';
import { NoteLimiter, readAtMost } from './transcribe';

export const FILES_BUCKET = 'documents';

/** Up to 25 MB, the bucket's own limit. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** What people send in a chat: photos, documents, sheets, slides, text, a zip, a short video. */
const ACCEPTED = /^(image\/(jpeg|png|webp|heic|gif)|application\/(pdf|zip|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.oasis\.opendocument\.[a-z.]+)|text\/(plain|csv)|video\/(mp4|quicktime))$/;


export interface FileStore {
  put(path: string, bytes: Uint8Array, mediaType: string): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  remove(path: string): Promise<void>;
  /** Writes the person's message, signed with their name in the organisation. */
  addMessage(m: { id: string; threadId: string; orgId: string; userId: string; parts: MessagePart[] }): Promise<ChatMessage>;
  quotePart(messageId: string, threadId: string): Promise<MessagePart | null>;
}

export interface FileDeps {
  chat: ChatDeps;
  files?: FileStore;
  /** 60 files an hour per person. */
  limiter: NoteLimiter;
}

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

/** A file name safe as the last part of a path: no slashes or control characters, at most 120 characters, its extension kept. */
export function safeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.normalize('NFC').replace(/[\/\\\u0000-\u001f\u007f]/g, '_').trim() : '';
  if (!name || name === '.' || name === '..') return 'archivo';
  if (name.length <= 120) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
  return name.slice(0, 120 - ext.length) + ext;
}

/**
 * The name as a storage key: Supabase Storage takes only plain characters in a
 * path, so accents go and anything else becomes «-» («Presupuesto
 * cartelería.pdf» → «Presupuesto-carteleria.pdf»). The part keeps the real name.
 */
export function keyName(name: string): string {
  const plain = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return plain && plain !== '.' && plain !== '..' ? plain : 'archivo';
}

const sizeOf = (raw: unknown) => {
  const n = typeof raw === 'string' && /^\d{1,5}$/.test(raw) ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Stores a file sent to a chat the person may write in, writes their message
 * and lets the agent answer (it answers once both are written; Cloud Run keeps
 * the CPU only while the request is open). Returns the message.
 */
export async function sendFile(
  deps: FileDeps,
  userId: string,
  threadId: unknown,
  file: {
    contentType: string | undefined;
    contentLength: string | undefined;
    body: ReadableStream<Uint8Array> | null;
    name: unknown;
    caption?: unknown;
    quote?: unknown;
    width?: unknown;
    height?: unknown;
  },
  accessToken?: string,
): Promise<{ message: ChatMessage; replied: boolean }> {
  if (!isUuid(threadId)) throw new Refusal(400, 'bad_request', 'thread must be a uuid');
  const thread = await deps.chat.chat.thread(threadId);
  const level = thread ? await deps.chat.chat.threadLevelFor(thread.id, userId) : 'none';
  if (!thread || level === 'none') throw new Refusal(404, 'not_found', 'thread not found');
  if (level !== 'talk') throw new Refusal(403, 'not_allowed', 'you may not write in this conversation');
  const store = deps.files;
  if (!store) throw new Refusal(503, 'files_off', 'files are not configured on this engine');
  const mediaType = (file.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (!ACCEPTED.test(mediaType)) throw new Refusal(415, 'unsupported', 'this kind of file is not accepted');
  if (Number(file.contentLength) > MAX_FILE_BYTES) throw new Refusal(413, 'too_large', 'file over 25 MB');
  if (!deps.limiter.take(userId)) throw new Refusal(429, 'too_many', 'too many files in the last hour');
  const bytes = await readAtMost(file.body, MAX_FILE_BYTES, () => new Refusal(413, 'too_large', 'file over 25 MB'));
  if (bytes.byteLength === 0) throw new Refusal(400, 'bad_request', 'no file');

  const id = randomUUID();
  const name = safeName(file.name);
  const path = `${thread.orgId}/${thread.id}/${id}/${keyName(name)}`;
  const caption = typeof file.caption === 'string' ? file.caption.trim().slice(0, 8000) : '';
  const quote = isUuid(file.quote) ? await store.quotePart(file.quote, thread.id) : null;
  const width = sizeOf(file.width);
  const height = sizeOf(file.height);
  const part: DocumentPart = { type: 'document', path, mediaType, name, size: bytes.byteLength, ...(width && height ? { width, height } : {}) };
  await store.put(path, bytes, mediaType);
  let message: ChatMessage;
  try {
    message = await store.addMessage({
      id,
      threadId: thread.id,
      orgId: thread.orgId,
      userId,
      parts: [...(quote ? [quote] : []), part, ...(caption ? [{ type: 'text', text: caption }] : [])],
    });
  } catch (e) {
    await store.remove(path).catch(() => {});
    throw e;
  }
  await deps.chat.chat.touchThread(thread.id);
  const { replied } = await replyInThread(deps.chat, userId, thread.id, accessToken);
  return { message, replied };
}

const MESSAGE_COLUMNS = 'id, thread_id, author_kind, author_user, author_agent, author_name, parts, state, steps, created_at';

export function supabaseFileStore(admin: SupabaseClient): FileStore {
  const bucket = () => admin.storage.from(FILES_BUCKET);
  return {
    async put(path, bytes, mediaType) {
      const { error } = await bucket().upload(path, bytes, { contentType: mediaType, upsert: false });
      if (error) throw error;
    },
    async get(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) throw error ?? new Error('file missing');
      return new Uint8Array(await data.arrayBuffer());
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) throw error;
    },
    async addMessage(m) {
      const { data: member, error: memberError } = await admin.from('memberships').select('display_name').eq('org_id', m.orgId).eq('user_id', m.userId).maybeSingle();
      if (memberError) throw memberError;
      const { data, error } = await admin
        .from('messages')
        .insert({ id: m.id, thread_id: m.threadId, org_id: m.orgId, author_kind: 'person', author_user: m.userId, author_name: (member?.display_name as string | undefined) ?? '', parts: m.parts })
        .select(MESSAGE_COLUMNS)
        .single();
      if (error) throw error;
      return messageFromRow(data);
    },
    async quotePart(messageId, threadId) {
      const { data, error } = await admin.rpc('quote_part', { target_message: messageId, target_thread: threadId });
      if (error) throw error;
      return (data as MessagePart | null) ?? null;
    },
  };
}
