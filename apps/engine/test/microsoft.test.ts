import { describe, expect, it } from 'vitest';
import { AccountGone, NotConfigured } from '../src/accounts';
import { appClient, appSecretName } from '../src/apps';
import { bareScope, MICROSOFT_SCOPES, microsoftOAuth, microsoftTools } from '../src/microsoft';
import { ToolError } from '../src/tools';
import { MemoryVault } from '../src/vault';

type Call = { url: string; method: string; body: string; headers: Headers };

function fakeFetch(answers: Array<{ status?: number; json: unknown }>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', body: String(init.body ?? ''), headers: new Headers(init.headers) });
    const a = answers.shift() ?? { json: {} };
    return new Response(JSON.stringify(a.json), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const now = () => new Date('2026-11-19T10:00:00Z');
const tool = (name: string) => {
  const t = microsoftTools(now).find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
};

async function withApp(value: string | null, f: typeof fetch) {
  const vault = new MemoryVault();
  if (value !== null) await vault.put(appSecretName('microsoft'), value, {});
  return microsoftOAuth(appClient(vault, 'microsoft'), f);
}

describe('connecting Microsoft 365', () => {
  it('signs in with our Entra app from the vault, with PKCE and never Mail.Send', async () => {
    const p = await withApp(JSON.stringify({ client_id: 'entra-app', client_secret: 's' }), fakeFetch([]).f);
    const begun = await p.begin({ state: 'st', redirectUri: 'https://engine.example/connections/oauth/microsoft/callback' });
    const q = new URL(begun.url).searchParams;
    expect(begun.url.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/authorize?')).toBe(true);
    expect(q.get('client_id')).toBe('entra-app');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('scope')).toBe('openid email offline_access User.Read Mail.ReadWrite Calendars.ReadWrite Files.ReadWrite');
    expect(q.get('scope')).not.toContain('Send');
  });

  it('is not configured until our app is in the vault', async () => {
    const p = await withApp(null, fakeFetch([]).f);
    await expect(p.begin({ state: 's', redirectUri: 'x' })).rejects.toBeInstanceOf(NotConfigured);
  });

  it('swaps the code, names the scopes bare, and keeps the rotated refresh token', async () => {
    const { f, calls } = fakeFetch([
      { json: { access_token: 'a1', refresh_token: 'r1', expires_in: 3599, scope: 'https://graph.microsoft.com/Mail.ReadWrite Calendars.ReadWrite openid' } },
      { json: { access_token: 'a2', refresh_token: 'r2', expires_in: 3599 } },
      { status: 400, json: { error: 'invalid_grant' } },
    ]);
    const p = await withApp(JSON.stringify({ client_id: 'entra-app', client_secret: 's' }), f);
    const grant = await p.exchange({ code: 'c', codeVerifier: 'v', redirectUri: 'r' });
    expect(grant.scopes).toEqual(['Mail.ReadWrite', 'Calendars.ReadWrite', 'openid']);
    expect(grant.client).toBeUndefined();
    expect(new URLSearchParams(calls[0]?.body).get('client_secret')).toBe('s');
    expect(await p.refresh('r1')).toEqual({ accessToken: 'a2', expiresIn: 3599, refreshToken: 'r2' });
    await expect(p.refresh('r2')).rejects.toBeInstanceOf(AccountGone);
    expect(bareScope('https://graph.microsoft.com/Files.ReadWrite')).toBe('Files.ReadWrite');
  });
});

describe('Microsoft 365 tools', () => {
  it('each needs one of the card\'s scopes, and only drafts, events and rows write', () => {
    for (const t of microsoftTools()) {
      expect(Object.values(MICROSOFT_SCOPES)).toContain(t.scope);
      expect(t.provider).toBe('microsoft');
    }
    expect(microsoftTools().filter((t) => t.writes).map((t) => t.name)).toEqual([
      'outlook_calendar_create_event',
      'outlook_mail_create_draft',
      'excel_add_rows',
    ]);
  });

  it('a new event has no attendees, in UTC', async () => {
    const { f, calls } = fakeFetch([{ json: { webLink: 'https://outlook/e' } }]);
    await tool('outlook_calendar_create_event').run({ accessToken: 't', fetch: f }, {
      title: 'Cena',
      start: '2026-11-20T21:00:00+01:00',
      end: '2026-11-20T23:00:00+01:00',
    });
    const body = JSON.parse(calls[0]?.body ?? '{}');
    expect(calls[0]?.url).toBe('https://graph.microsoft.com/v1.0/me/events');
    expect(body.start).toEqual({ dateTime: '2026-11-20T20:00:00.000', timeZone: 'UTC' });
    expect(body.attendees).toBeUndefined();
  });

  it('a draft goes to Drafts and is never sent; a reply is made from the original', async () => {
    const { f, calls } = fakeFetch([{ json: { webLink: 'https://outlook/d1' } }, { json: { webLink: 'https://outlook/d2' } }]);
    const run = tool('outlook_mail_create_draft').run;
    const out = JSON.parse(await run({ accessToken: 't', fetch: f }, { to: ['ana@empresa.es'], subject: 'Hola', text: 'Qué tal' }));
    expect(out).toEqual({ draft: true, sent: false, link: 'https://outlook/d1' });
    await run({ accessToken: 't', fetch: f }, { replyTo: 'AAMk-abc=', text: 'Gracias' });
    expect(calls.map((c) => c.url)).toEqual([
      'https://graph.microsoft.com/v1.0/me/messages',
      'https://graph.microsoft.com/v1.0/me/messages/AAMk-abc%3D/createReply',
    ]);
    expect(calls.some((c) => c.url.includes('/send'))).toBe(false);
    await expect(run({ accessToken: 't', fetch: f }, { to: ['no es correo'], subject: 'x', text: 'y' })).rejects.toBeInstanceOf(ToolError);
  });

  it('Excel: names and ranges cannot reach the URL unchecked', async () => {
    const { f, calls } = fakeFetch([{ json: { address: 'Hoja1!A1:B2', values: [[1, 2]] } }]);
    const run = tool('excel_read').run;
    const out = JSON.parse(await run({ accessToken: 't', fetch: f }, { id: '01ABC', sheet: "Ventas d'oro", range: 'A1:B2' }));
    expect(out.values).toEqual([[1, 2]]);
    expect(calls[0]?.url).toBe("https://graph.microsoft.com/v1.0/me/drive/items/01ABC/workbook/worksheets('Ventas%20d''oro')/range(address='A1%3AB2')?$select=address,values");
    await expect(run({ accessToken: 't', fetch: f }, { id: '01ABC', sheet: 'Hoja1', range: "A1')/delete" })).rejects.toBeInstanceOf(ToolError);
    await expect(run({ accessToken: 't', fetch: f }, { id: '../x', sheet: 'Hoja1' })).rejects.toBeInstanceOf(ToolError);
  });

  it('mail search: the last ones by default, Outlook\'s search with a query', async () => {
    const { f, calls } = fakeFetch([{ json: { value: [] } }, { json: { value: [] } }]);
    const run = tool('outlook_mail_search').run;
    await run({ accessToken: 't', fetch: f }, { unread: true });
    await run({ accessToken: 't', fetch: f }, { query: 'factura "marzo"' });
    const q0 = new URL(calls[0]?.url ?? '').searchParams;
    const q1 = new URL(calls[1]?.url ?? '').searchParams;
    expect(q0.get('$orderby')).toBe('receivedDateTime desc');
    expect(q0.get('$filter')).toBe('isRead eq false');
    expect(q1.get('$search')).toBe('"factura  marzo "');
    expect(q1.get('$orderby')).toBeNull();
  });
});
