import { describe, expect, it } from 'vitest';
import { AccountGone } from '../src/accounts';
import { INSTAGRAM_SCOPES, instagramOAuth, instagramTools } from '../src/instagram';
import { ToolError } from '../src/tools';

type Call = { url: string; method: string; body: string };

function fakeFetch(answers: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: String(init.body ?? '') });
    const a = answers.shift() ?? { json: {} };
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const app = { appId: '1234', appSecret: 'app-secret' };
const tool = (name: string) => {
  const t = instagramTools({ pollMs: 0, polls: 3 }).find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
};

describe('Instagram sign-in', () => {
  it('asks for the business scopes on Instagram\'s own page, without our secret', async () => {
    const begun = await instagramOAuth(app).begin({ state: 's', redirectUri: 'https://e/cb' });
    const url = new URL(begun.url);
    expect(url.origin + url.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(url.searchParams.get('scope')?.split(',')).toEqual(Object.values(INSTAGRAM_SCOPES));
    expect(url.searchParams.get('state')).toBe('s');
    expect(begun.url).not.toContain('app-secret');
  });

  it('swaps the code for a long-lived token, kept as the one to renew', async () => {
    const { f, calls } = fakeFetch([
      { json: { data: [{ access_token: 'short', user_id: '9', permissions: 'instagram_business_basic,instagram_business_manage_comments' }] } },
      { json: { access_token: 'long', expires_in: 5184000 } },
    ]);
    const grant = await instagramOAuth(app, f).exchange({ code: 'abc#_', codeVerifier: '', redirectUri: 'https://e/cb' });
    expect(grant).toEqual({ refreshToken: 'long', accessToken: 'long', expiresIn: 5184000, scopes: ['instagram_business_basic', 'instagram_business_manage_comments'] });
    expect(new URLSearchParams(calls[0]?.body).get('code')).toBe('abc');
    expect(calls[1]?.url).toContain('grant_type=ig_exchange_token');
  });

  it('renews the long-lived token, and an invalid one is AccountGone', async () => {
    const ok = fakeFetch([{ json: { access_token: 'long-2', expires_in: 5184000 } }]);
    expect(await instagramOAuth(app, ok.f).refresh('long-1')).toEqual({ accessToken: 'long-2', refreshToken: 'long-2', expiresIn: 5184000 });
    const gone = fakeFetch([{ status: 400, json: { error: { code: 190, type: 'OAuthException', message: 'Error validating access token' } } }]);
    await expect(instagramOAuth(app, gone.f).refresh('long-1')).rejects.toBeInstanceOf(AccountGone);
  });
});

describe('Instagram tools', () => {
  it('publishes a reel: container, wait until processed, publish, link', async () => {
    const { f, calls } = fakeFetch([
      { json: { id: '111' } },
      { json: { status_code: 'IN_PROGRESS' } },
      { json: { status_code: 'FINISHED' } },
      { json: { id: '222' } },
      { json: { permalink: 'https://instagram.com/p/x' } },
    ]);
    const out = JSON.parse(await tool('instagram_publish').run({ accessToken: 'tok', fetch: f }, { kind: 'reel', media: ['https://cdn.example/v.mp4'], caption: 'Hola' }));
    expect(out).toEqual({ published: true, id: '222', link: 'https://instagram.com/p/x' });
    const create = new URLSearchParams(calls[0]?.body);
    expect(create.get('media_type')).toBe('REELS');
    expect(create.get('video_url')).toBe('https://cdn.example/v.mp4');
    expect(create.get('access_token')).toBe('tok');
    expect(new URLSearchParams(calls[3]?.body).get('creation_id')).toBe('111');
  });

  it('builds a carousel from its children', async () => {
    const { f, calls } = fakeFetch([
      { json: { id: '1' } },
      { json: { status_code: 'FINISHED' } },
      { json: { id: '2' } },
      { json: { status_code: 'FINISHED' } },
      { json: { id: '3' } },
      { json: { status_code: 'FINISHED' } },
      { json: { id: '4' } },
      { json: {} },
    ]);
    await tool('instagram_publish').run({ accessToken: 't', fetch: f }, { kind: 'carousel', media: ['https://a/1.jpg', 'https://a/2.mp4'] });
    expect(new URLSearchParams(calls[2]?.body).get('media_type')).toBe('VIDEO');
    expect(new URLSearchParams(calls[4]?.body).get('children')).toBe('1,2');
  });

  it('refuses non-https media, wrong counts and non-numeric ids before calling Instagram', async () => {
    const { f, calls } = fakeFetch([]);
    const ctx = { accessToken: 't', fetch: f };
    await expect(tool('instagram_publish').run(ctx, { kind: 'image', media: ['http://a/1.jpg'] })).rejects.toBeInstanceOf(ToolError);
    await expect(tool('instagram_publish').run(ctx, { kind: 'carousel', media: ['https://a/1.jpg'] })).rejects.toBeInstanceOf(ToolError);
    await expect(tool('instagram_reply_comment').run(ctx, { comment: '1/../2', message: 'x' })).rejects.toBeInstanceOf(ToolError);
    expect(calls).toHaveLength(0);
  });

  it('answers and hides comments, and passes on Meta\'s refusal in words', async () => {
    const { f, calls } = fakeFetch([{ json: { id: '77' } }, { json: { success: true } }, { status: 400, json: { error: { message: 'Unsupported request' } } }]);
    const ctx = { accessToken: 't', fetch: f };
    expect(JSON.parse(await tool('instagram_reply_comment').run(ctx, { comment: '55', message: '¡Gracias!' }))).toEqual({ replied: true, id: '77' });
    expect(calls[0]?.url).toBe('https://graph.instagram.com/v23.0/55/replies');
    await tool('instagram_hide_comment').run(ctx, { comment: '56', hide: true });
    expect(new URLSearchParams(calls[1]?.body).get('hide')).toBe('true');
    await expect(tool('instagram_list_comments').run(ctx, { media: '9' })).rejects.toThrow('Unsupported request');
  });
});
