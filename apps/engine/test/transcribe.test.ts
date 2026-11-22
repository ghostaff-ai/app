import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { type Membership, Refusal } from '../src/connections';
import { MAX_AUDIO_BYTES, NoteLimiter, type Transcriber, vertexTranscriber } from '../src/transcribe';

const ORG = '10000000-0000-0000-0000-000000000001';

function setup(opts: { transcriber?: Transcriber | null; limiter?: NoteLimiter } = {}) {
  const members: Record<string, Membership> = { ana: { role: 'member', displayName: 'Ana' } };
  const heard: Array<{ audio: Uint8Array; mimeType: string }> = [];
  const fake: Transcriber = {
    async transcribe(audio, mimeType) {
      heard.push({ audio, mimeType });
      return 'hola mundo';
    },
  };
  const app = createApp({
    store: { membership: async (o: string, u: string) => (o === ORG ? (members[u] ?? null) : null) } as never,
    vault: {} as never,
    checks: {} as never,
    userFromToken: async (t) => (t.startsWith('token-') ? t.slice(6) : null),
    serviceAccount: '',
    chat: {} as never,
    accounts: {} as never,
    actions: {} as never,
    transcribeLimiter: opts.limiter,
    transcriber: opts.transcriber === null ? undefined : (opts.transcriber ?? fake),
  });
  const send = (opts: { user?: string; org?: string | null; type?: string; body?: Uint8Array<ArrayBuffer>; headers?: Record<string, string> }) =>
    app.request(`/transcribe${opts.org === null ? '' : `?org=${opts.org ?? ORG}`}`, {
      method: 'POST',
      headers: {
        ...(opts.user === undefined || opts.user ? { Authorization: `Bearer token-${opts.user ?? 'ana'}` } : {}),
        'Content-Type': opts.type ?? 'audio/webm',
        ...opts.headers,
      },
      body: opts.body ?? new Uint8Array([1, 2, 3]),
    });
  return { send, heard };
}

describe('POST /transcribe', () => {
  it('needs a signed-in member of the organisation', async () => {
    const { send, heard } = setup();
    expect((await send({ user: '' })).status).toBe(401);
    const noOrg = await send({ org: null });
    expect(noOrg.status).toBe(400);
    expect(await noOrg.json()).toMatchObject({ error: 'bad_request' });
    const outsider = await send({ user: 'zoe' });
    expect(outsider.status).toBe(403);
    expect(await outsider.json()).toMatchObject({ error: 'not_member' });
    expect(heard).toHaveLength(0);
  });

  it('takes only audio, up to MAX_AUDIO_BYTES', async () => {
    const { send, heard } = setup();
    const text = await send({ type: 'text/plain' });
    expect(text.status).toBe(415);
    expect(await text.json()).toMatchObject({ error: 'unsupported_media' });
    expect((await send({ type: 'audio/webm junk' })).status).toBe(415);
    expect((await send({ type: 'audio/' })).status).toBe(415);
    const big = await send({ body: new Uint8Array(MAX_AUDIO_BYTES + 1) });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: 'too_large' });
    const claimed = await send({ headers: { 'Content-Length': String(MAX_AUDIO_BYTES + 1) } });
    expect(claimed.status).toBe(413);
    expect((await send({ body: new Uint8Array() })).status).toBe(400);
    expect(heard).toHaveLength(0);
  });

  it('is capped at 10 MB', () => {
    expect(MAX_AUDIO_BYTES).toBe(10 * 1024 * 1024);
  });

  it('names the m4a aliases audio/mp4', async () => {
    const { send, heard } = setup();
    await send({ type: 'audio/x-m4a' });
    await send({ type: 'audio/m4a' });
    expect(heard.map((h) => h.mimeType)).toEqual(['audio/mp4', 'audio/mp4']);
  });

  it('limits each person to 30 notes in a rolling hour, after membership and before the body', async () => {
    let now = 0;
    const limiter = new NoteLimiter({ max: 30, windowMs: 3_600_000, now: () => now });
    const { send, heard } = setup({ limiter });
    for (let i = 0; i < 30; i++) {
      expect((await send({})).status).toBe(200);
      now += 1000;
    }
    const over = await send({});
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: 'too_many' });
    expect(heard).toHaveLength(30);
    // An outsider is refused as not_member and doesn't use up anything.
    expect((await send({ user: 'zoe' })).status).toBe(403);
    // The first note leaves the window an hour after it was sent.
    now = 3_600_000;
    expect((await send({})).status).toBe(200);
    expect((await send({})).status).toBe(429);
  });

  it('answers 503 when dictation is off', async () => {
    const { send } = setup({ transcriber: null });
    const res = await send({});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'transcription_off' });
  });

  it('passes the exact bytes and their bare type to the transcriber and answers its text', async () => {
    const { send, heard } = setup();
    const res = await send({ type: 'Audio/WebM; codecs=opus', body: new Uint8Array([7, 8, 9, 10]) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'hola mundo' });
    expect(heard).toHaveLength(1);
    expect([...heard[0]!.audio]).toEqual([7, 8, 9, 10]);
    expect(heard[0]!.mimeType).toBe('audio/webm');
  });
});

describe('vertexTranscriber', () => {
  const reply = (text: string) => ({ status: 200, data: { candidates: [{ content: { role: 'model', parts: [{ text }] } }] } });

  it('calls Gemini in the eu multi-region with the audio inline, in SMART mode', async () => {
    const calls: Array<{ url: string; body: any; opts: unknown }> = [];
    const t = vertexTranscriber({
      project: 'ghostaff-beta',
      model: 'gemini-3.5-transcribe',
      request: async (url, body, opts) => {
        calls.push({ url, body, opts });
        return reply('  Hola, mundo.\n');
      },
    });
    expect(await t.transcribe(new Uint8Array([104, 105]), 'audio/webm')).toBe('Hola, mundo.');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      'https://aiplatform.eu.rep.googleapis.com/v1/projects/ghostaff-beta/locations/eu/publishers/google/models/gemini-3.5-transcribe:generateContent',
    );
    expect(calls[0]!.body).toEqual({
      contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/webm', data: 'aGk=' } }] }],
      generationConfig: { audioTranscriptionConfig: { mode: 'SMART' } },
    });
    expect(calls[0]!.opts).toEqual({ timeoutMs: 120_000 });
  });

  it('gives an empty text when there was no speech, and throws when Google refuses', async () => {
    const empty = vertexTranscriber({ project: 'p', model: 'm', request: async () => ({ status: 200, data: { candidates: [{ content: { parts: [] } }] } }) });
    expect(await empty.transcribe(new Uint8Array([1]), 'audio/wav')).toBe('');
    const none = vertexTranscriber({ project: 'p', model: 'm', request: async () => ({ status: 200, data: {} }) });
    expect(await none.transcribe(new Uint8Array([1]), 'audio/wav')).toBe('');
  });

  it('a refusal, a quota limit or no answer from Google is a 502 provider_unavailable, with the status only', async () => {
    const quota = vertexTranscriber({ project: 'p', model: 'm', request: async () => ({ status: 429, data: { error: { message: 'said: hola mundo' } } }) });
    const err = await quota.transcribe(new Uint8Array([1]), 'audio/wav').catch((e) => e);
    expect(err).toBeInstanceOf(Refusal);
    expect(err).toMatchObject({ status: 502, code: 'provider_unavailable' });
    expect(err.message).toContain('429');
    expect(err.message).not.toContain('hola');
    const timedOut = vertexTranscriber({ project: 'p', model: 'm', request: async () => { throw new Error('timeout of 120000ms exceeded'); } });
    await expect(timedOut.transcribe(new Uint8Array([1]), 'audio/wav')).rejects.toMatchObject({ status: 502, code: 'provider_unavailable' });
  });

  it('warns with the status or «timeout», the type and the size, never the content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const quota = vertexTranscriber({ project: 'p', model: 'm', request: async () => ({ status: 429, data: { error: { message: 'said: hola mundo' } } }) });
    await quota.transcribe(new Uint8Array([1, 2]), 'audio/mp4').catch(() => {});
    const hung = vertexTranscriber({ project: 'p', model: 'm', request: async () => { throw new Error('boom: hola'); } });
    await hung.transcribe(new Uint8Array([1, 2, 3]), 'audio/webm').catch(() => {});
    expect(warn.mock.calls).toEqual([
      ['transcribe: vertex', 429, 'audio/mp4', 2],
      ['transcribe: vertex', 'timeout', 'audio/webm', 3],
    ]);
    warn.mockRestore();
  });

  it('the route answers that 502 with its code', async () => {
    const quota = vertexTranscriber({ project: 'p', model: 'm', request: async () => ({ status: 429, data: {} }) });
    const res = await setup({ transcriber: quota }).send({});
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'provider_unavailable' });
  });
});
