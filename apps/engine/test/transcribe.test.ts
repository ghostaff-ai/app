import { describe, expect, it, vi } from 'vitest';
import { Refusal } from '../src/connections';
import { audioType, MAX_AUDIO_BYTES, NoteLimiter, readAudio, vertexTranscriber } from '../src/transcribe';

describe('audioType', () => {
  it('takes only audio, as its bare type', () => {
    expect(audioType('Audio/WebM; codecs=opus')).toBe('audio/webm');
    expect(audioType('audio/mp4')).toBe('audio/mp4');
    for (const bad of ['text/plain', 'audio/webm junk', 'audio/', undefined]) {
      expect(() => audioType(bad)).toThrow(expect.objectContaining({ status: 415, code: 'unsupported_media' }));
    }
  });

  it('names the m4a aliases audio/mp4', () => {
    expect(audioType('audio/x-m4a')).toBe('audio/mp4');
    expect(audioType('audio/m4a')).toBe('audio/mp4');
  });
});

describe('readAudio', () => {
  const body = (bytes: Uint8Array<ArrayBuffer>) => new Response(bytes).body;

  it('reads the exact bytes', async () => {
    expect([...(await readAudio({ contentLength: '4', body: body(new Uint8Array([7, 8, 9, 10])) }))]).toEqual([7, 8, 9, 10]);
  });

  it('is capped at 10 MB, whatever Content-Length claims, and refuses nothing', async () => {
    expect(MAX_AUDIO_BYTES).toBe(10 * 1024 * 1024);
    await expect(readAudio({ contentLength: undefined, body: body(new Uint8Array(MAX_AUDIO_BYTES + 1)) })).rejects.toMatchObject({ status: 413, code: 'too_large' });
    await expect(readAudio({ contentLength: String(MAX_AUDIO_BYTES + 1), body: body(new Uint8Array([1])) })).rejects.toMatchObject({ status: 413 });
    await expect(readAudio({ contentLength: '0', body: body(new Uint8Array()) })).rejects.toMatchObject({ status: 400 });
    await expect(readAudio({ contentLength: undefined, body: null })).rejects.toMatchObject({ status: 400 });
  });
});

describe('NoteLimiter', () => {
  it('gives each person 30 notes in a rolling hour', () => {
    let now = 0;
    const limiter = new NoteLimiter({ now: () => now });
    for (let i = 0; i < 30; i++) {
      expect(limiter.take('ana')).toBe(true);
      now += 1000;
    }
    expect(limiter.take('ana')).toBe(false);
    expect(limiter.take('bea')).toBe(true);
    // The first note leaves the window an hour after it was sent.
    now = 3_600_000;
    expect(limiter.take('ana')).toBe(true);
    expect(limiter.take('ana')).toBe(false);
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
});
