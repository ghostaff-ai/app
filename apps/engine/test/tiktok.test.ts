import { describe, expect, it } from 'vitest';
import { AccountGone } from '../src/accounts';
import { chunking, MAX_VIDEO_BYTES, publicHttpsUrl, TIKTOK_SCOPES, tiktokOAuth, tiktokTools } from '../src/tiktok';
import { ToolError } from '../src/tools';

type Call = { url: string; method: string; body: unknown; headers: Headers };

function fakeFetch(answers: Array<{ status?: number; json?: unknown; bytes?: Uint8Array; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const f = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: init.body, headers: new Headers(init.headers) });
    const a = answers.shift() ?? { json: {} };
    if (a.bytes) return new Response(a.bytes as unknown as BodyInit, { status: a.status ?? 200, headers: a.headers });
    return new Response(JSON.stringify(a.json ?? {}), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const app = { clientKey: 'key', clientSecret: 'secret' };
const tool = (name: string) => {
  const t = tiktokTools().find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
};

describe('TikTok sign-in', () => {
  it('asks for the stats, video list and publishing scopes', async () => {
    const begun = await tiktokOAuth(app).begin({ state: 's', redirectUri: 'https://e/cb' });
    const q = new URL(begun.url).searchParams;
    expect(q.get('scope')?.split(',')).toEqual(Object.values(TIKTOK_SCOPES));
    expect(q.get('client_key')).toBe('key');
    expect(begun.url).not.toContain('secret');
  });

  it('swaps the code, rotates the refresh token, and a dead grant is AccountGone', async () => {
    const { f } = fakeFetch([
      { json: { access_token: 'a', refresh_token: 'r', expires_in: 86400, scope: 'user.info.basic,video.publish' } },
      { json: { access_token: 'a2', refresh_token: 'r2', expires_in: 86400 } },
      { status: 400, json: { error: 'invalid_grant' } },
    ]);
    const p = tiktokOAuth(app, f);
    expect(await p.exchange({ code: 'c', codeVerifier: '', redirectUri: 'https://e/cb' })).toEqual({
      refreshToken: 'r',
      accessToken: 'a',
      expiresIn: 86400,
      scopes: ['user.info.basic', 'video.publish'],
    });
    expect(await p.refresh('r')).toEqual({ accessToken: 'a2', expiresIn: 86400, refreshToken: 'r2' });
    await expect(p.refresh('r2')).rejects.toBeInstanceOf(AccountGone);
  });
});

describe('TikTok tools', () => {
  it('uploads a video in one chunk with the chosen privacy', async () => {
    const video = new Uint8Array(1000);
    const { f, calls } = fakeFetch([
      { json: { data: { privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'] }, error: { code: 'ok' } } },
      { bytes: video },
      { json: { data: { publish_id: 'p1', upload_url: 'https://upload.tiktok.example/u' }, error: { code: 'ok' } } },
      { json: {} },
    ]);
    const out = JSON.parse(await tool('tiktok_publish_video').run({ accessToken: 'tok', fetch: f }, { video: 'https://cdn.example/v.mp4', caption: 'Mus' }));
    expect(out).toEqual({ uploaded: true, publish_id: 'p1', privacy: 'PUBLIC_TO_EVERYONE' });
    const init = JSON.parse(String(calls[2]?.body));
    expect(init.source_info).toEqual({ source: 'FILE_UPLOAD', video_size: 1000, chunk_size: 1000, total_chunk_count: 1 });
    expect(init.post_info).toMatchObject({ title: 'Mus', privacy_level: 'PUBLIC_TO_EVERYONE' });
    expect(calls[3]).toMatchObject({ url: 'https://upload.tiktok.example/u', method: 'PUT' });
    expect(calls[3]?.headers.get('content-range')).toBe('bytes 0-999/1000');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer tok');
  });

  it('before the audit, says plainly that only private posts are allowed', async () => {
    const { f, calls } = fakeFetch([{ json: { data: { privacy_level_options: ['SELF_ONLY'] }, error: { code: 'ok' } } }]);
    await expect(tool('tiktok_publish_video').run({ accessToken: 't', fetch: f }, { video: 'https://cdn.example/v.mp4' })).rejects.toThrow('solo deja publicar en privado');
    expect(calls).toHaveLength(1);
  });

  it('never fetches an internal or non-https address', () => {
    for (const bad of ['http://cdn.example/v.mp4', 'https://localhost/v.mp4', 'https://10.0.0.1/v.mp4', 'https://metadata.google.internal/x', 'https://[::1]/v', 'https://intranet/v']) {
      expect(() => publicHttpsUrl(bad)).toThrow(ToolError);
    }
    expect(publicHttpsUrl('https://storage.googleapis.com/b/v.mp4').hostname).toBe('storage.googleapis.com');
  });

  it('splits big videos into chunks as TikTok asks, and refuses oversized ones', async () => {
    expect(chunking(5 * 1024 * 1024)).toEqual({ chunkSize: 5 * 1024 * 1024, count: 1 });
    expect(chunking(100 * 1024 * 1024)).toEqual({ chunkSize: 10 * 1024 * 1024, count: 10 });
    const { f } = fakeFetch([
      { json: { data: { privacy_level_options: ['PUBLIC_TO_EVERYONE'] }, error: { code: 'ok' } } },
      { bytes: new Uint8Array(1), headers: { 'content-length': String(MAX_VIDEO_BYTES + 1) } },
    ]);
    await expect(tool('tiktok_publish_video').run({ accessToken: 't', fetch: f }, { video: 'https://cdn.example/v.mp4' })).rejects.toThrow('demasiado grande');
  });

  it('passes on TikTok\'s refusals in words', async () => {
    const { f } = fakeFetch([{ status: 401, json: { error: { code: 'access_token_invalid', message: 'x' } } }]);
    await expect(tool('tiktok_list_videos').run({ accessToken: 't', fetch: f }, {})).rejects.toThrow('volver a conectar');
  });
});
