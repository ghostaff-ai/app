// Audio from an agent (docs/plans/ongoing/agent-audio.md): an mp3 or m4a an
// agent made in its run on our runner (La Mesa's episode, a Productor draft),
// played in the agent's chat with the voice notes' player.
//
// The agent leaves it in ~/outbox/; when Claude Code ends, the runner (root,
// with the run's nonce) uploads each file with POST /runs/:id/audio, then
// reports. The upload stores the audio in the «voice-notes» bucket at
// <org_id>/<chat>/<message_id>.<ext>, the folder the voice notes' read policy
// knows, and keeps it on the run (agent_runs.audio); the report posts each as
// a message of the agent, after its text (jobs.ts, reportRun). A run that never
// reports has its audio removed when the tick closes it (expireRuns).

import { randomUUID } from 'node:crypto';
import type { AudioPart } from '@ghostaff/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatAgent, ChatDeps } from './chat';
import { Refusal } from './connections';
import type { JobDeps } from './jobs';
import { checkRunner, nonceMatches } from './runner';
import { audioType, readAudio } from './transcribe';
import { BUCKET } from './voiceNotes';

/** An episode of about 25 minutes at 128 kbit/s; Cloud Run takes requests up to 32 MiB. */
export const MAX_RUN_AUDIO_BYTES = 25 * 1024 * 1024;
/** La Mesa makes two a week (English and Spanish); room for a few drafts. */
export const MAX_RUN_AUDIO_FILES = 4;
/** What plays on iPhone, Android and the web alike, and its file extension. */
export const RUN_AUDIO_TYPES: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a' };

/** One audio a run uploaded, waiting for its report. */
export interface RunAudio {
  /** The message that will hold it, named before it exists so the path can carry it. */
  id: string;
  threadId: string;
  path: string;
  mediaType: string;
  title: string;
}

/** The bucket, the runs' audio lists and the agents' messages, with the service role. */
export interface RunAudioStore {
  put(path: string, audio: Uint8Array, mediaType: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  /** The run's audio still waiting for its report, in the order uploaded. */
  list(runId: string): Promise<RunAudio[]>;
  /** Appends one to a run's list. Only the run's own runner calls it, one file after another. */
  add(runId: string, audio: RunAudio): Promise<void>;
  /** Forgets a run's list once posted or removed. */
  clear(runId: string): Promise<void>;
  /** The agent's finished message holding the audio, in its chat. */
  post(agent: ChatAgent, audio: RunAudio): Promise<void>;
}

/** A title from the file's name: what a person reads above the player. Control characters and slashes never get in. */
export function audioTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const title = raw.replace(/\s+/g, ' ').trim();
  if (!title || title.length > 120 || /[\u0000-\u001f\u007f/\\]/.test(title)) return null;
  return title;
}

/** Whether the bytes start like an mp3 (an ID3 tag or a frame) or an MP4 container: a file named .mp3 that isn't one doesn't get posted. */
export function looksLikeAudio(audio: Uint8Array, mediaType: string): boolean {
  if (mediaType === 'audio/mpeg') {
    const id3 = audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33;
    const frame = audio[0] === 0xff && ((audio[1] ?? 0) & 0xe0) === 0xe0;
    return id3 || frame;
  }
  if (mediaType === 'audio/mp4') return String.fromCharCode(...audio.subarray(4, 8)) === 'ftyp';
  return false;
}

/**
 * POST /runs/:id/audio: one audio of a run on our runner, which still works and has its spec, proven by our runner's
 * identity and the run's nonce. Stored at once and kept on the run until it reports.
 */
export async function receiveRunAudio(
  chat: ChatDeps,
  deps: JobDeps,
  caller: string | null,
  runId: string,
  upload: { nonce: string | undefined; title: unknown; contentType: string | undefined; contentLength: string | undefined; body: ReadableStream<Uint8Array> | null },
): Promise<{ id: string }> {
  checkRunner(deps, caller);
  const store = deps.audio;
  if (!store) throw new Refusal(503, 'audio_off', 'agent audio is not configured on this engine');
  const run = /^[0-9a-f-]{36}$/i.test(runId) ? await deps.jobs.run(runId) : null;
  if (!run || !nonceMatches(upload.nonce, run.nonceHash) || run.state !== 'running' || !run.specFetched) throw new Refusal(403, 'not_allowed', 'not this run');
  const title = audioTitle(upload.title);
  if (!title) throw new Refusal(400, 'bad_request', 'title must be 1 to 120 characters, without slashes');
  const mediaType = audioType(upload.contentType);
  const ext = RUN_AUDIO_TYPES[mediaType];
  if (!ext) throw new Refusal(415, 'unsupported_media', 'an agent posts audio as mp3 (audio/mpeg) or m4a (audio/mp4)');
  if ((await store.list(run.id)).length >= MAX_RUN_AUDIO_FILES) throw new Refusal(429, 'too_many', `at most ${MAX_RUN_AUDIO_FILES} audio files a run`);
  const audio = await readAudio(upload, MAX_RUN_AUDIO_BYTES);
  if (!looksLikeAudio(audio, mediaType)) throw new Refusal(415, 'unsupported_media', `not an ${ext} file`);

  const agent = await chat.chat.agent(run.agentId);
  if (!agent || agent.orgId !== run.orgId) throw new Refusal(403, 'not_allowed', 'not this run');
  const threadId = run.threadId ?? (await chat.chat.agentChat(agent.id));
  const id = randomUUID();
  const entry: RunAudio = { id, threadId, path: `${run.orgId}/${threadId}/${id}.${ext}`, mediaType, title };
  await store.put(entry.path, audio, mediaType);
  try {
    await store.add(run.id, entry);
  } catch (e) {
    await store.remove([entry.path]).catch(() => {});
    throw e;
  }
  return { id };
}

/** At the report: each audio the run uploaded, as a message of the agent in its chat, in order. Returns how many. */
export async function postRunAudio(deps: JobDeps, agent: ChatAgent, runId: string, waiting?: RunAudio[]): Promise<number> {
  const store = deps.audio;
  if (!store) return 0;
  const audio = waiting ?? (await store.list(runId));
  let posted = 0;
  for (const a of audio) {
    try {
      await store.post(agent, a);
      posted++;
    } catch (e) {
      console.error('run audio not posted', runId, a.id, e instanceof Error ? e.message : typeof e);
      await store.remove([a.path]).catch(() => {});
    }
  }
  if (audio.length) await store.clear(runId).catch(() => {});
  return posted;
}

/** A run closed without its report: the audio it uploaded goes, since nobody said it was ready. */
export async function dropRunAudio(deps: JobDeps, runId: string): Promise<void> {
  const store = deps.audio;
  if (!store) return;
  const audio = await store.list(runId);
  if (!audio.length) return;
  await store.remove(audio.map((a) => a.path));
  await store.clear(runId);
}

const isRunAudio = (x: unknown): x is RunAudio => {
  const a = x as Partial<RunAudio> | null;
  return !!a && typeof a.id === 'string' && typeof a.threadId === 'string' && typeof a.path === 'string' && typeof a.mediaType === 'string' && typeof a.title === 'string';
};

/** `afterAgentWrite` runs after each post, as in `supabaseChatStore`: the pushes go out. */
export function supabaseRunAudioStore(admin: SupabaseClient, opts: { afterAgentWrite?: () => void } = {}): RunAudioStore {
  const bucket = () => admin.storage.from(BUCKET);
  const list = async (runId: string): Promise<RunAudio[]> => {
    const { data, error } = await admin.from('agent_runs').select('audio').eq('id', runId).maybeSingle();
    if (error) throw error;
    const audio = (data as { audio?: unknown } | null)?.audio;
    return Array.isArray(audio) ? audio.filter(isRunAudio) : [];
  };
  return {
    async put(path, audio, mediaType) {
      const { error } = await bucket().upload(path, audio, { contentType: mediaType, upsert: false });
      if (error) throw error;
    },
    async remove(paths) {
      const { error } = await bucket().remove(paths);
      if (error) throw error;
    },
    list,
    async add(runId, audio) {
      // Read and write: the run's runner is its only writer, and it uploads one file after another.
      const { error } = await admin
        .from('agent_runs')
        .update({ audio: [...(await list(runId)), audio] })
        .eq('id', runId)
        .eq('state', 'running');
      if (error) throw error;
    },
    async clear(runId) {
      const { error } = await admin.from('agent_runs').update({ audio: [] }).eq('id', runId);
      if (error) throw error;
    },
    async post(agent, a) {
      const part: AudioPart = { type: 'audio', path: a.path, mediaType: a.mediaType, durationMs: null, title: a.title };
      const now = new Date().toISOString();
      const { error } = await admin.from('messages').insert({
        id: a.id,
        thread_id: a.threadId,
        org_id: agent.orgId,
        author_kind: 'agent',
        author_agent: agent.id,
        author_name: agent.name,
        parts: [part],
        state: 'done',
        finished_at: now,
      });
      if (error) throw error;
      const { error: touched } = await admin.from('threads').update({ last_message_at: now }).eq('id', a.threadId);
      if (touched) console.error('thread not touched after an audio', touched.message);
      opts.afterAgentWrite?.();
    },
  };
}
