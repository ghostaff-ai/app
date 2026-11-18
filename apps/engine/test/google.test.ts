import { connectorFor, type GoogleConnector } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import { AccountGone, codeChallenge } from '../src/accounts';
import { streamWith } from '../src/chatStore';
import { GOOGLE_SCOPES, googleOAuth, googleTools } from '../src/google';
import { googleBusinessTools } from '../src/googleBusiness';
import type { AgentTools } from '../src/tools';
import { ToolError } from '../src/tools';

type Call = { url: string; method: string; body: string; auth: string | null };

function fakeFetch(answers: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    calls.push({ url: String(url), method: init.method ?? 'GET', body: String(init.body ?? ''), auth: headers.get('Authorization') });
    const a = answers.shift() ?? { json: {} };
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const client = { clientId: 'client-id.apps.googleusercontent.com', clientSecret: 'client-secret' };
const card = connectorFor('google') as GoogleConnector;

describe('Google sign-in', () => {
  it('asks for offline access with PKCE and only the narrow scopes', async () => {
    const begun = await googleOAuth(client, card).begin({ state: 's', redirectUri: 'https://e/cb' });
    const url = new URL(begun.url);
    const q = url.searchParams;
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(q.get('scope')?.split(' ')).toEqual(['openid', 'email', GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.driveFile]);
    expect(q.get('access_type')).toBe('offline');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBe(codeChallenge(begun.codeVerifier));
    expect(begun.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(url.toString()).not.toContain(begun.codeVerifier);
    expect(q.get('state')).toBe('s');
    expect(url.toString()).not.toContain('client-secret');
  });

  it('swaps the code for tokens with the verifier, and reads which scopes were granted', async () => {
    const { f, calls } = fakeFetch([
      { json: { access_token: 'a', refresh_token: 'r', expires_in: 3599, scope: `openid ${GOOGLE_SCOPES.calendar}` } },
    ]);
    const grant = await googleOAuth(client, card, f).exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'https://e/cb' });
    expect(grant).toEqual({ refreshToken: 'r', accessToken: 'a', expiresIn: 3599, scopes: ['openid', GOOGLE_SCOPES.calendar] });
    const form = new URLSearchParams(calls[0]?.body);
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(form.get('code_verifier')).toBe('v');
    expect(form.get('grant_type')).toBe('authorization_code');
  });

  it('a revoked or expired grant is AccountGone', async () => {
    const { f } = fakeFetch([{ status: 400, json: { error: 'invalid_grant' } }]);
    await expect(googleOAuth(client, card, f).refresh('r')).rejects.toBeInstanceOf(AccountGone);
  });
});

describe('Google tools', () => {
  const now = () => new Date('2026-11-18T09:00:00Z');
  const tool = (name: string) => {
    const t = googleTools(now).find((x) => x.name === name);
    if (!t) throw new Error(name);
    return t;
  };

  it('lists the next week of the primary calendar by default', async () => {
    const { f, calls } = fakeFetch([
      { json: { timeZone: 'Europe/Madrid', items: [{ summary: 'Gestoría', start: { dateTime: '2026-11-19T10:00:00+01:00' }, end: { dateTime: '2026-11-19T11:00:00+01:00' }, htmlLink: 'https://cal/1' }] } },
    ]);
    const out = JSON.parse(await tool('google_calendar_list_events').run({ accessToken: 'tok', fetch: f }, {}));
    const q = new URL(calls[0]?.url ?? '').searchParams;
    expect(calls[0]?.auth).toBe('Bearer tok');
    expect(q.get('timeMin')).toBe('2026-11-18T09:00:00.000Z');
    expect(q.get('timeMax')).toBe('2026-11-25T09:00:00.000Z');
    expect(q.get('singleEvents')).toBe('true');
    expect(out.events).toEqual([{ title: 'Gestoría', start: '2026-11-19T10:00:00+01:00', end: '2026-11-19T11:00:00+01:00', link: 'https://cal/1' }]);
  });

  it('creates an event in Madrid time, or all day, and refuses mixed or vague dates', async () => {
    const { f, calls } = fakeFetch([{ json: { htmlLink: 'https://cal/2' } }, { json: { htmlLink: 'https://cal/3' } }]);
    const create = tool('google_calendar_create_event');
    const out = JSON.parse(
      await create.run({ accessToken: 't', fetch: f }, { title: 'Cierre', start: '2026-11-20T10:00:00+01:00', end: '2026-11-20T11:00:00+01:00' }),
    );
    expect(out).toEqual({ created: true, title: 'Cierre', link: 'https://cal/2' });
    expect(JSON.parse(calls[0]?.body ?? '{}').start).toEqual({ dateTime: '2026-11-20T10:00:00+01:00', timeZone: 'Europe/Madrid' });
    await create.run({ accessToken: 't', fetch: f }, { title: 'Feria', start: '2026-11-21', end: '2026-11-22' });
    expect(JSON.parse(calls[1]?.body ?? '{}').start).toEqual({ date: '2026-11-21' });
    await expect(create.run({ accessToken: 't', fetch: f }, { title: 'x', start: '2026-11-21', end: '2026-11-21T10:00:00Z' })).rejects.toBeInstanceOf(ToolError);
    await expect(create.run({ accessToken: 't', fetch: f }, { title: 'x', start: 'mañana', end: 'pasado' })).rejects.toBeInstanceOf(ToolError);
    expect(calls).toHaveLength(2);
  });

  it('creates a spreadsheet with the rows and returns its link', async () => {
    const { f, calls } = fakeFetch([{ json: { spreadsheetId: 'abc', spreadsheetUrl: 'https://sheets/abc' } }, { json: {} }]);
    const out = JSON.parse(
      await tool('google_sheets_create').run({ accessToken: 't', fetch: f }, { title: 'Ventas', rows: [['Mes', 'Total'], ['Octubre', 1200], ['Noviembre', null]] }),
    );
    expect(out).toEqual({ created: true, title: 'Ventas', rows: 3, link: 'https://sheets/abc' });
    expect(calls[1]?.method).toBe('PUT');
    expect(calls[1]?.url).toContain('/spreadsheets/abc/values/A1?valueInputOption=USER_ENTERED');
    expect(JSON.parse(calls[1]?.body ?? '{}').values).toEqual([['Mes', 'Total'], ['Octubre', 1200], ['Noviembre', '']]);
  });

  it('turns Google\'s refusals into words the agent can pass on', async () => {
    const { f } = fakeFetch([{ status: 401, json: {} }, { status: 403, json: { error: { message: 'Insufficient Permission' } } }]);
    const list = tool('google_calendar_list_events');
    await expect(list.run({ accessToken: 't', fetch: f }, {})).rejects.toThrow('volver a conectar');
    await expect(list.run({ accessToken: 't', fetch: f }, {})).rejects.toThrow('Insufficient Permission');
  });
});

describe('the model writer with tools', () => {
  /** A fake Anthropic client: each stream call plays the next scripted reply. */
  function fakeClient(replies: Array<{ text?: string; tools?: Array<{ id: string; name: string; input: unknown }> }>) {
    const requests: Array<{ messages: unknown[]; tools?: unknown }> = [];
    const client = {
      messages: {
        stream(req: { messages: unknown[]; tools?: unknown }) {
          requests.push({ messages: [...req.messages], tools: req.tools });
          const r = replies.shift() ?? { text: '' };
          const events = r.text ? [{ type: 'content_block_delta', delta: { type: 'text_delta', text: r.text } }] : [];
          const content = [
            ...(r.text ? [{ type: 'text', text: r.text }] : []),
            ...(r.tools ?? []).map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.input })),
          ];
          return {
            async *[Symbol.asyncIterator]() {
              yield* events;
            },
            finalMessage: async () => ({ content, stop_reason: r.tools?.length ? 'tool_use' : 'end_turn' }),
          };
        },
      },
    };
    return { client, requests };
  }

  it('runs the tools the model asks for, gives back their results, and lets it finish', async () => {
    const { client, requests } = fakeClient([
      { text: 'Miro tu agenda.', tools: [{ id: 'tu1', name: 'google_calendar_list_events', input: { from: 'x' } }] },
      { text: 'Tienes la gestoría el jueves.' },
    ]);
    const ran: Array<{ name: string; input: unknown }> = [];
    const tools: AgentTools = {
      specs: [{ name: 'google_calendar_list_events', description: 'd', input_schema: { type: 'object', properties: {} } }],
      accounts: [],
      stepFor: () => 's',
      writes: () => false,
      actionFor: () => '',
      run: async (name, input) => {
        ran.push({ name, input });
        return { content: '{"events":[]}', isError: false };
      },
    };
    let text = '';
    const used: string[] = [];
    await streamWith(client as never)({
      system: 'sys',
      messages: [{ role: 'user', content: 'Ana: ¿qué tengo esta semana?' }],
      tools,
      onText: (t) => {
        text += t;
      },
      onTool: (n) => used.push(n),
    });
    expect(used).toEqual(['google_calendar_list_events']);
    expect(ran).toEqual([{ name: 'google_calendar_list_events', input: { from: 'x' } }]);
    expect(text).toBe('Miro tu agenda.\n\nTienes la gestoría el jueves.');
    expect(requests[0]?.tools).toHaveLength(1);
    const second = requests[1]?.messages as Array<{ role: string; content: unknown }>;
    expect(second.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '{"events":[]}', is_error: false }],
    });
  });

  it('sends no tools when the organisation has none', async () => {
    const { client, requests } = fakeClient([{ text: 'Hola.' }]);
    await streamWith(client as never)({
      system: 's',
      messages: [{ role: 'user', content: 'hola' }],
      tools: { specs: [], accounts: [], stepFor: () => '', writes: () => false, actionFor: () => '', run: async () => ({ content: '', isError: true }) },
      onText: () => {},
      onTool: () => {},
    });
    expect(requests[0]?.tools).toBeUndefined();
  });
});

describe('Google reviews', () => {
  const tool = (name: string) => {
    const t = googleBusinessTools().find((x) => x.name === name);
    if (!t) throw new Error(name);
    return t;
  };

  it('the reviews card asks only for business.manage, apart from the calendar', async () => {
    const begun = await googleOAuth(client, connectorFor('googlebusiness') as GoogleConnector).begin({ state: 's', redirectUri: 'https://e/cb' });
    expect(new URL(begun.url).searchParams.get('scope')?.split(' ')).toEqual(['openid', 'email', GOOGLE_SCOPES.business]);
  });

  it('lists the businesses and their reviews, the unanswered ones on request', async () => {
    const { f, calls } = fakeFetch([
      { json: { accounts: [{ name: 'accounts/111' }] } },
      { json: { locations: [{ name: 'locations/222', title: 'Panadería', storefrontAddress: { addressLines: ['Calle Mayor 1'], locality: 'Madrid' } }] } },
      {
        json: {
          averageRating: 4.5,
          totalReviewCount: 2,
          reviews: [
            { name: 'accounts/111/locations/222/reviews/r1', reviewer: { displayName: 'Luis' }, starRating: 'FIVE', comment: 'Buenísimo', reviewReply: { comment: 'Gracias' } },
            { name: 'accounts/111/locations/222/reviews/r2', reviewer: { displayName: 'Eva' }, starRating: 'TWO', comment: 'Tardaron' },
          ],
        },
      },
    ]);
    const locs = JSON.parse(await tool('google_business_list_locations').run({ accessToken: 't', fetch: f }, {}));
    expect(locs.locations).toEqual([{ location: 'accounts/111/locations/222', title: 'Panadería', address: 'Calle Mayor 1, Madrid' }]);
    const out = JSON.parse(await tool('google_business_list_reviews').run({ accessToken: 't', fetch: f }, { location: 'accounts/111/locations/222', onlyUnanswered: true }));
    expect(out.reviews).toEqual([{ review: 'accounts/111/locations/222/reviews/r2', author: 'Eva', stars: 2, text: 'Tardaron', reply: null }]);
    expect(calls[2]?.url).toContain('/v4/accounts/111/locations/222/reviews?pageSize=20');
  });

  it('replies to a review, and refuses anything that is not a review\'s exact name', async () => {
    const { f, calls } = fakeFetch([{ json: {} }]);
    const reply = tool('google_business_reply_review');
    await reply.run({ accessToken: 't', fetch: f }, { review: 'accounts/1/locations/2/reviews/abc', reply: 'Gracias, Eva' });
    expect(calls[0]).toMatchObject({ url: 'https://mybusiness.googleapis.com/v4/accounts/1/locations/2/reviews/abc/reply', method: 'PUT' });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ comment: 'Gracias, Eva' });
    for (const review of ['accounts/1/locations/2/reviews/abc/../../x', 'https://evil.example', 'accounts/1']) {
      await expect(reply.run({ accessToken: 't', fetch: f }, { review, reply: 'x' })).rejects.toBeInstanceOf(ToolError);
    }
    await expect(tool('google_business_list_reviews').run({ accessToken: 't', fetch: f }, { location: '../x' })).rejects.toBeInstanceOf(ToolError);
    expect(calls).toHaveLength(1);
  });
});
