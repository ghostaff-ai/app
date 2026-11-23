import { afterEach, describe, expect, it, vi } from 'vitest';
import { isVoicePart, messageText } from '../src/chat';
import { EngineError, sendVoiceNote, transcribeVoiceNote, voiceNoteUrl } from '../src/services';

const engine = { url: 'https://engine.test/', token: 'tok' };
const voice = { type: 'voice', path: 'o/t/m.m4a', mediaType: 'audio/mp4', durationMs: 1200, transcription: 'done' };

describe('isVoicePart', () => {
  it('knows a voice part by its type and path', () => {
    expect(isVoicePart(voice)).toBe(true);
    expect(isVoicePart({ type: 'voice' })).toBe(false);
    expect(isVoicePart({ type: 'text', text: 'hola' })).toBe(false);
  });

  it('leaves the text of a voice note to its transcript', () => {
    expect(messageText([voice, { type: 'text', text: 'Hola, ¿qué tal?' }])).toBe('Hola, ¿qué tal?');
    expect(messageText([{ ...voice, transcription: 'pending' }])).toBe('');
  });
});

describe('sendVoiceNote', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the raw audio with its type and duration to the agent and returns the message', async () => {
    const message = { id: 'm1', threadId: 't1', parts: [{ ...voice, transcription: 'pending' }] };
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ message }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' });
    expect(await sendVoiceNote(engine, 'agent 1', { audio, mimeType: 'audio/mp4', durationMs: 1234.6 })).toEqual(message);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://engine.test/agents/agent%201/voice-notes?durationMs=1235');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'audio/mp4' });
    expect(init.body).toBe(audio);
  });

  it('leaves the duration out when unknown', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ message: {} }), { status: 201 }));
    vi.stubGlobal('fetch', fetch);
    await sendVoiceNote(engine, 'a', { audio: new Blob([]), mimeType: 'audio/webm', durationMs: null });
    expect(fetch.mock.calls[0]![0]).toBe('https://engine.test/agents/a/voice-notes');
  });

  it('turns a refusal into an EngineError with its code', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'too_large', message: 'audio over' }), { status: 413 }));
    const err = await sendVoiceNote(engine, 'a', { audio: new Blob([]), mimeType: 'audio/mp4', durationMs: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err).toMatchObject({ code: 'too_large', status: 413 });
  });
});

describe('transcribeVoiceNote', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks the engine to transcribe the message', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ transcription: 'done' }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await transcribeVoiceNote(engine, 'm 1');
    expect(fetch.mock.calls[0]![0]).toBe('https://engine.test/voice-notes/m%201/transcribe');
    expect(fetch.mock.calls[0]![1].method).toBe('POST');
  });
});

describe('voiceNoteUrl', () => {
  it('signs the path in the voice-notes bucket for an hour', async () => {
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'https://x/signed' }, error: null }));
    const from = vi.fn(() => ({ createSignedUrl }));
    const client = { storage: { from } } as never;
    expect(await voiceNoteUrl(client, 'o/t/m.m4a')).toBe('https://x/signed');
    expect(from).toHaveBeenCalledWith('voice-notes');
    expect(createSignedUrl).toHaveBeenCalledWith('o/t/m.m4a', 3600);
  });

  it('throws when storage refuses', async () => {
    const client = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: new Error('not found') }) }) } } as never;
    await expect(voiceNoteUrl(client, 'x')).rejects.toThrow('not found');
  });
});
