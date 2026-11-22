import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineError, transcribe } from '../src/services';

const engine = { url: 'https://engine.test/', token: 'tok' };

describe('transcribe', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the raw audio with its type to /transcribe for the organisation and returns the text', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ text: 'hola mundo' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    expect(await transcribe(engine, 'org 1', audio, 'audio/webm')).toBe('hola mundo');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://engine.test/transcribe?org=org%201');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'audio/webm' });
    expect(init.body).toBe(audio);
  });

  it('turns a refusal into an EngineError with its code', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'too_large', message: 'audio over' }), { status: 413 }));
    const err = await transcribe(engine, 'o', new Blob([]), 'audio/webm').catch((e) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ code: 'too_large', status: 413 });
  });
});
