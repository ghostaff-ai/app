import type { ChatMessage, VoicePart } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { ChatAgent, ChatStore, ChatThreadHead, Level, Writer } from '../src/chat';
import { Refusal } from '../src/connections';
import { NoteLimiter, type Transcriber } from '../src/transcribe';
import type { VoiceNoteStore } from '../src/voiceNotes';
import { NO_TOOLS } from '../src/tools';
import { MemoryVault } from '../src/vault';

const ORG = '10000000-0000-0000-0000-000000000001';
const AGENT = '20000000-0000-0000-0000-000000000001';
const CHAT = '30000000-0000-0000-0000-000000000009';
const secretaria: ChatAgent = { id: AGENT, orgId: ORG, name: 'Secretaría', ghost: 'secretaria', department: 'direccion' };
const MISSING = '40000000-0000-0000-0000-000000000000';

function setup(
  opts: {
    levels?: Record<string, Level>;
    transcriber?: Transcriber | null;
    voice?: 'off';
    limiter?: NoteLimiter;
    /** Fails the message's insert, as a database error would. */
    failInsert?: boolean;
  } = {},
) {
  const levels = opts.levels ?? { ana: 'talk', bea: 'talk', carla: 'read' };
  const messages: ChatMessage[] = [];
  const stored = new Map<string, { audio: Uint8Array; mimeType: string }>();
  const heard: Array<{ audio: Uint8Array; mimeType: string }> = [];
  const threads: ChatThreadHead[] = [];
  const opened: string[] = [];
  const asked: unknown[] = [];

  const voice: VoiceNoteStore = {
    async putAudio(path, audio, mimeType) {
      stored.set(path, { audio, mimeType });
    },
    async getAudio(path) {
      const a = stored.get(path);
      if (!a) throw new Error('missing');
      return a.audio;
    },
    async removeAudio(path) {
      stored.delete(path);
    },
    async addVoiceNote(note) {
      if (opts.failInsert) throw new Error('insert failed');
      const m: ChatMessage = {
        id: note.id,
        threadId: note.threadId,
        authorKind: 'person',
        authorUserId: note.userId,
        authorAgentId: null,
        authorName: note.userId === 'ana' ? 'Ana' : 'Bea',
        parts: [note.part],
        state: 'done',
        steps: [],
        createdAt: new Date(2026, 10, 23, 10, messages.length).toISOString(),
      };
      messages.push(m);
      return m;
    },
    async message(id) {
      return messages.find((m) => m.id === id) ?? null;
    },
    async setParts(id, parts) {
      const m = messages.find((x) => x.id === id);
      if (m) m.parts = parts;
    },
  };

  let working: string | null = null;
  const chat: ChatStore = {
    levelFor: async (_a, u) => levels[u] ?? 'none',
    thread: async (id) => threads.find((t) => t.id === id) ?? null,
    agent: async (id) => (id === AGENT ? secretaria : null),
    orgAgents: async () => [secretaria],
    orgName: async () => 'Panadería',
    memberNames: async () => ['Ana', 'Bea'],
    recentMessages: async () => messages,
    startReply: async () => {
      if (working) return null;
      working = `reply-${messages.length}`;
      return working;
    },
    updateReply: async (id, patch) => {
      if (patch.state && patch.state !== 'working') {
        working = null;
        messages.push({
          id,
          threadId: CHAT,
          authorKind: 'agent',
          authorUserId: null,
          authorAgentId: AGENT,
          authorName: 'Secretaría',
          parts: [{ type: 'text', text: patch.text ?? '' }],
          state: 'done',
          steps: [],
          createdAt: new Date(2026, 10, 23, 11, messages.length).toISOString(),
        });
      }
    },
    touchThread: async () => {},
    personalChat: async (orgId, agentId, title, userId) => {
      opened.push(userId);
      const id = userId === 'ana' ? CHAT : '30000000-0000-0000-0000-00000000000b';
      if (!threads.some((t) => t.id === id)) threads.push({ id, orgId, agentId, title });
      return id;
    },
    aiAccounts: async () => [{ id: 'key-1', provider: 'anthropic' }],
    recordAiUse: async () => {},
    proposeAction: async () => 'action-1',
  };
  const write: Writer = async (req) => {
    asked.push(req.messages);
    req.onText('Apuntado.');
  };
  const fake: Transcriber = {
    async transcribe(audio, mimeType) {
      heard.push({ audio, mimeType });
      return 'Llama mañana al proveedor de harina.';
    },
  };
  const app = createApp({
    store: {} as never,
    vault: new MemoryVault(),
    checks: {} as never,
    userFromToken: async (t) => (t.startsWith('token-') ? t.slice(6) : null),
    serviceAccount: 'x',
    chat: { chat, flushMs: 0, writerFor: async () => write, toolsFor: async () => NO_TOOLS },
    accounts: {} as never,
    actions: {} as never,
    voice: opts.voice === 'off' ? undefined : voice,
    transcriber: opts.transcriber === null ? undefined : (opts.transcriber ?? fake),
    transcribeLimiter: opts.limiter,
  });

  const send = (o: { user?: string; agent?: string; type?: string; body?: Uint8Array<ArrayBuffer>; duration?: string } = {}) =>
    app.request(`/agents/${o.agent ?? AGENT}/voice-notes${o.duration === undefined ? '?durationMs=4200' : o.duration}`, {
      method: 'POST',
      headers: { Authorization: `Bearer token-${o.user ?? 'ana'}`, 'Content-Type': o.type ?? 'audio/mp4' },
      body: o.body ?? new Uint8Array([1, 2, 3]),
    });
  const transcribe = (id: string, user = 'ana') =>
    app.request(`/voice-notes/${id}/transcribe`, { method: 'POST', headers: { Authorization: `Bearer token-${user}` } });
  const sent = async (o?: Parameters<typeof send>[0]) => {
    const res = await send(o);
    expect(res.status).toBe(201);
    return ((await res.json()) as { message: ChatMessage }).message;
  };
  const voicePart = (m: ChatMessage) => m.parts[0] as unknown as VoicePart;
  return { send, sent, transcribe, messages, stored, heard, opened, asked, voicePart };
}

describe('POST /agents/:id/voice-notes', () => {
  it('stores the audio and writes the note in the person’s own chat, still to be transcribed', async () => {
    const { sent, stored, messages, opened, heard, voicePart } = setup();
    const message = await sent({ type: 'audio/mp4', body: new Uint8Array([7, 8, 9]) });
    expect(opened).toEqual(['ana']);
    expect(message.threadId).toBe(CHAT);
    expect(message.authorUserId).toBe('ana');
    expect(message.parts).toHaveLength(1);
    expect(voicePart(message)).toEqual({
      type: 'voice',
      path: `${ORG}/${CHAT}/${message.id}.m4a`,
      mediaType: 'audio/mp4',
      durationMs: 4200,
      transcription: 'pending',
    });
    expect([...stored.get(voicePart(message).path)!.audio]).toEqual([7, 8, 9]);
    expect(stored.get(voicePart(message).path)!.mimeType).toBe('audio/mp4');
    expect(messages).toHaveLength(1);
    expect(heard).toHaveLength(0); // the transcript is the second call
  });

  it('names the file by the audio’s bare type, and drops a duration that makes no sense', async () => {
    const { sent, voicePart } = setup();
    const web = await sent({ type: 'audio/webm;codecs=opus', duration: '?durationMs=abc' });
    expect(voicePart(web).path).toMatch(/\.webm$/);
    expect(voicePart(web).mediaType).toBe('audio/webm');
    expect(voicePart(web).durationMs).toBeNull();
    const long = await sent({ duration: '?durationMs=99999999' });
    expect(voicePart(long).durationMs).toBeNull();
    const none = await sent({ duration: '' });
    expect(voicePart(none).durationMs).toBeNull();
  });

  it('needs someone who may talk to the agent', async () => {
    const { send, stored, opened } = setup();
    const reader = await send({ user: 'carla' });
    expect(reader.status).toBe(403);
    expect(await reader.json()).toMatchObject({ error: 'not_allowed' });
    expect((await send({ user: 'zoe' })).status).toBe(403);
    expect((await send({ agent: MISSING })).status).toBe(404);
    expect((await send({ agent: 'nope' })).status).toBe(400);
    expect(stored.size).toBe(0);
    expect(opened).toHaveLength(0);
  });

  it('takes only audio, up to 10 MB', async () => {
    const { send, stored } = setup();
    expect((await send({ type: 'text/plain' })).status).toBe(415);
    expect((await send({ body: new Uint8Array(10 * 1024 * 1024 + 1) })).status).toBe(413);
    expect((await send({ body: new Uint8Array() })).status).toBe(400);
    expect(stored.size).toBe(0);
  });

  it('limits each person to 30 notes an hour', async () => {
    const { send } = setup({ limiter: new NoteLimiter({ max: 2, now: () => 0 }) });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    const over = await send();
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: 'too_many' });
    expect((await send({ user: 'bea' })).status).toBe(201);
  });

  it('answers 503 when voice notes are off', async () => {
    for (const off of [setup({ transcriber: null }), setup({ voice: 'off' })]) {
      const res = await off.send();
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ error: 'transcription_off' });
    }
  });

  it('keeps no audio when the message could not be written', async () => {
    const { send, stored } = setup({ failInsert: true });
    expect((await send()).status).toBe(500);
    expect(stored.size).toBe(0);
  });
});

describe('POST /voice-notes/:id/transcribe', () => {
  it('puts the transcript after the audio and lets the agent answer it', async () => {
    const { sent, transcribe, messages, heard, asked, voicePart } = setup();
    const note = await sent({ body: new Uint8Array([5, 6]) });
    const res = await transcribe(note.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ transcription: 'done', replied: true });
    expect([...heard[0]!.audio]).toEqual([5, 6]);
    expect(heard[0]!.mimeType).toBe('audio/mp4');
    const stored = messages.find((m) => m.id === note.id)!;
    expect(voicePart(stored).transcription).toBe('done');
    expect(stored.parts[1]).toEqual({ type: 'text', text: 'Llama mañana al proveedor de harina.' });
    // The agent read the transcript, as if it were typed.
    expect(JSON.stringify(asked[0])).toContain('Ana: Llama mañana al proveedor de harina.');
    expect(messages.at(-1)).toMatchObject({ authorKind: 'agent', parts: [{ type: 'text', text: 'Apuntado.' }] });
  });

  it('leaves a transcribed note alone', async () => {
    const { sent, transcribe, heard } = setup();
    const note = await sent();
    await transcribe(note.id);
    const again = await transcribe(note.id);
    expect(await again.json()).toEqual({ transcription: 'done', replied: false });
    expect(heard).toHaveLength(1);
  });

  it('marks a note where nobody spoke «empty», and the agent stays quiet', async () => {
    const { sent, transcribe, messages, asked, voicePart } = setup({ transcriber: { transcribe: async () => '' } });
    const note = await sent();
    expect(await (await transcribe(note.id)).json()).toEqual({ transcription: 'empty', replied: false });
    expect(messages).toHaveLength(1);
    expect(voicePart(messages[0]!).transcription).toBe('empty');
    expect(messages[0]!.parts).toHaveLength(1);
    expect(asked).toHaveLength(0);
  });

  it('marks a failed transcription «failed» and answers 502; a retry shows «pending» and then the text', async () => {
    let fail = true;
    const seen: string[] = [];
    const h = setup({
      transcriber: {
        async transcribe() {
          seen.push((h.voicePart(h.messages[0]!)).transcription);
          if (fail) throw new Refusal(502, 'provider_unavailable', 'Vertex AI answered 429');
          return 'A la segunda.';
        },
      },
    });
    const note = await h.sent();
    const first = await h.transcribe(note.id);
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ error: 'provider_unavailable' });
    expect(h.voicePart(h.messages[0]!).transcription).toBe('failed');
    expect(h.asked).toHaveLength(0);
    fail = false;
    expect(await (await h.transcribe(note.id)).json()).toEqual({ transcription: 'done', replied: true });
    expect(seen).toEqual(['pending', 'pending']);
    expect(h.messages[0]!.parts[1]).toEqual({ type: 'text', text: 'A la segunda.' });
  });

  it('a lost audio is a failure too, not a crash', async () => {
    const h = setup();
    const note = await h.sent();
    h.stored.clear();
    expect((await h.transcribe(note.id)).status).toBe(502);
    expect(h.voicePart(h.messages[0]!).transcription).toBe('failed');
  });

  it('only for the note’s author: anyone else gets not found', async () => {
    const { sent, transcribe, heard } = setup();
    const note = await sent();
    expect((await transcribe(note.id, 'bea')).status).toBe(404);
    expect((await transcribe(MISSING)).status).toBe(404);
    expect((await transcribe('nope')).status).toBe(400);
    expect(heard).toHaveLength(0);
  });

  it('refuses a message that is not a voice note', async () => {
    const h = setup();
    const note = await h.sent();
    h.messages[0]!.parts = [{ type: 'text', text: 'Hola' }];
    expect((await h.transcribe(note.id)).status).toBe(400);
  });
});
