import { describe, expect, it } from 'vitest';
import {
  AccountGone,
  type AccountRecord,
  type AccountStore,
  accessTokens,
  allowedReturn,
  type Attempt,
  codeChallenge,
  NotConfigured,
  type OAuthProvider,
  type RefreshLeases,
  toolsFor,
} from '../src/accounts';
import { createApp } from '../src/app';
import type { Membership } from '../src/connections';
import { NO_TOOLS, type Tool, ToolError } from '../src/tools';
import { accountSecretName, MemoryVault } from '../src/vault';

const ORG = '10000000-0000-0000-0000-000000000001';
const OTHER = '10000000-0000-0000-0000-000000000002';
const ANA = 'ana'; // owner of ORG
const BEA = 'bea'; // member of ORG
const CARLA = 'carla'; // owner of OTHER
const CAL = 'https://www.googleapis.com/auth/calendar.events';
const FILES = 'https://www.googleapis.com/auth/drive.file';
const RETURN = 'ghostaff://conexiones';
const ENGINE = 'https://engine.example';

function setup(opts: { grantScopes?: string[]; now?: () => Date; exchangeFails?: boolean } = {}) {
  const members: Record<string, Membership> = {
    [`${ORG}/${ANA}`]: { role: 'owner', displayName: 'Ana' },
    [`${ORG}/${BEA}`]: { role: 'member', displayName: 'Bea' },
    [`${OTHER}/${CARLA}`]: { role: 'owner', displayName: 'Carla' },
  };
  const attempts = new Map<string, Attempt>();
  const rows = new Map<string, AccountRecord & { status: 'ok' | 'failing' }>();
  let clock = new Date('2026-11-18T10:00:00Z');
  const now = opts.now ?? (() => clock);
  const accounts: AccountStore = {
    membership: async (o, u) => members[`${o}/${u}`] ?? null,
    createAttempt: async (a) => {
      attempts.set(a.state, { ...a, createdAt: now().toISOString() });
    },
    findAttempt: async (state) => attempts.get(state) ?? null,
    takeAttempt: async (state) => {
      const a = attempts.get(state) ?? null;
      attempts.delete(state);
      return a;
    },
    upsertAccount: async (r) => {
      rows.set(`${r.org_id}/${r.provider}`, r);
    },
    removeAccount: async (o, p) => {
      rows.delete(`${o}/${p}`);
    },
    setStatus: async (o, p, status) => {
      const r = rows.get(`${o}/${p}`);
      if (r) rows.set(`${o}/${p}`, { ...r, status: status as 'ok' });
    },
    accounts: async (o) =>
      [...rows.values()]
        .filter((r) => r.org_id === o)
        .map((r) => ({ provider: r.provider, hint: r.hint, scopes: r.settings.scopes, status: r.status, version: r.updated_at })),
  };
  const calls = { exchanged: [] as Array<{ code: string; codeVerifier: string; redirectUri: string }>, revoked: [] as string[], refreshed: 0 };
  let refreshGone = false;
  const google: OAuthProvider = {
    id: 'google',
    method: 'oauth',
    usefulScopes: [CAL, FILES],
    begin: async ({ state, redirectUri }) => {
      const codeVerifier = `verifier-${state}`.padEnd(43, 'v');
      return {
        url: `https://accounts.example/auth?state=${state}&code_challenge=${codeChallenge(codeVerifier)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
        codeVerifier,
      };
    },
    exchange: async (p) => {
      calls.exchanged.push(p);
      if (opts.exchangeFails) throw new Error('boom');
      return { refreshToken: 'refresh-secret', accessToken: 'access-1', expiresIn: 3600, scopes: opts.grantScopes ?? ['openid', 'email', CAL, FILES] };
    },
    refresh: async () => {
      calls.refreshed += 1;
      if (refreshGone) throw new AccountGone('google');
      return { accessToken: `access-${calls.refreshed + 1}`, expiresIn: 3600 };
    },
    identity: async () => 'ana@panaderia.es',
    revoke: async (t) => {
      calls.revoked.push(t);
    },
  };
  const vault = new MemoryVault();
  const deps = { accounts, vault, providers: { google }, publicUrl: ENGINE, returnOrigins: ['https://app.ghostaff.ai'], tools: [] as Tool[], now };
  const app = createApp({
    store: {} as never,
    vault,
    checks: {} as never,
    userFromToken: async (t) => (t.startsWith('token-') ? t.slice(6) : null),
    serviceAccount: 'x',
    chat: { chat: {} as never, writerFor: async () => async () => {}, toolsFor: async () => NO_TOOLS },
    accounts: deps,
    actions: {} as never,
  });
  const call = (user: string | null, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { ...(user ? { Authorization: `Bearer token-${user}` } : {}), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  const start = async (user: string | null = ANA, body: unknown = { orgId: ORG, returnTo: RETURN }) => call(user, 'POST', '/connections/accounts/google/start', body);
  const stateOf = (url: string) => new URL(url).searchParams.get('state') ?? '';
  const back = async (query: string) => app.request(`/connections/oauth/google/callback?${query}`);
  const finish = async (user: string, body: unknown) => call(user, 'POST', '/connections/accounts/google/finish', body);
  /** Start as `starter`, come back from Google, finish as `finisher`: what the app does. */
  const connect = async (starter = ANA, finisher = starter, org = starter === CARLA ? OTHER : ORG) => {
    const { url } = (await (await start(starter, { orgId: org, returnTo: RETURN })).json()) as { url: string };
    const state = stateOf(url);
    const res = await back(`state=${state}&code=the-code`);
    return { state, res, done: await finish(finisher, { state, code: 'the-code' }) };
  };
  return {
    app,
    deps,
    rows,
    vault,
    attempts,
    calls,
    call,
    start,
    stateOf,
    back,
    finish,
    connect,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    goneOnRefresh: () => {
      refreshGone = true;
    },
  };
}

describe('connecting a Google account', () => {
  it('an owner gets Google\'s sign-in page, with a one-time state and a PKCE challenge', async () => {
    const { start, attempts, stateOf } = setup();
    const res = await start();
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const state = stateOf(url);
    expect(state.length).toBeGreaterThanOrEqual(43);
    const attempt = attempts.get(state);
    expect(attempt).toMatchObject({ orgId: ORG, userId: ANA, provider: 'google', returnTo: RETURN });
    expect(new URL(url).searchParams.get('code_challenge')).toBe(codeChallenge(attempt?.codeVerifier ?? ''));
    expect(url).not.toContain(attempt?.codeVerifier ?? 'x');
    expect(new URL(url).searchParams.get('redirect_uri')).toBe(`${ENGINE}/connections/oauth/google/callback`);
  });

  it('only an owner may start, and an outsider hears the same as a member', async () => {
    const { start } = setup();
    const member = await start(BEA);
    const outsider = await start(CARLA);
    expect(member.status).toBe(403);
    expect(outsider.status).toBe(403);
    expect(await outsider.json()).toEqual(await member.json());
    expect((await start(null)).status).toBe(401);
  });

  it('never sends the person back anywhere but the app', async () => {
    const { start } = setup();
    for (const returnTo of ['https://evil.example/x', 'javascript:alert(1)', 'not a url', '']) {
      expect((await start(ANA, { orgId: ORG, returnTo })).status).toBe(400);
    }
    expect(allowedReturn('ghostaff://conexiones', [])).toBe(true);
    expect(allowedReturn('https://app.ghostaff.ai/conexiones', ['https://app.ghostaff.ai'])).toBe(true);
    expect(allowedReturn('https://app.ghostaff.ai.evil.example/', ['https://app.ghostaff.ai'])).toBe(false);
    // Development addresses only for a local engine: Expo Go could open anyone's project with the code in it.
    expect(allowedReturn('exp://attacker.example/--/x', [])).toBe(false);
    expect(allowedReturn('http://localhost:8083/conexiones', [])).toBe(false);
    expect(allowedReturn('exp+ghostaff://expo-development-client/?url=x', [], true)).toBe(true);
    expect(allowedReturn('http://localhost:8083/conexiones', [], true)).toBe(true);
  });

  it('coming back from Google passes the code on to the app and keeps nothing yet', async () => {
    const { start, stateOf, back, rows, attempts } = setup();
    const { url } = (await (await start()).json()) as { url: string };
    const state = stateOf(url);
    const res = await back(`state=${state}&code=the-code`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`ghostaff://conexiones?connected=google&state=${state}&code=the-code`);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(rows.size).toBe(0);
    expect(attempts.has(state)).toBe(true);
  });

  it('the app finishes it: the token goes to the vault, the database keeps only the email and scopes', async () => {
    const { connect, rows, vault, calls } = setup();
    const { done } = await connect();
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ result: 'ok' });
    expect(calls.exchanged[0]).toMatchObject({ code: 'the-code', redirectUri: `${ENGINE}/connections/oauth/google/callback` });
    const row = rows.get(`${ORG}/google`);
    expect(row).toMatchObject({ kind: 'account', method: 'oauth', hint: 'ana@panaderia.es', connected_by: ANA, connected_by_name: 'Ana' });
    expect(row?.settings.scopes).toEqual([CAL, FILES]);
    expect(JSON.stringify(row)).not.toContain('refresh-secret');
    expect(await vault.get(accountSecretName(ORG, 'google'))).toContain('refresh-secret');
  });

  it('only the person who started may finish: a stranger lured into signing in gives nothing away', async () => {
    // Carla starts a connect for her workshop and gets Ana to sign in with her Google account.
    const { connect, rows, vault, calls } = setup();
    const { done } = await connect(CARLA, ANA);
    expect(done.status).toBe(403);
    expect(((await done.json()) as { error: string }).error).toBe('not_yours');
    expect(calls.exchanged).toHaveLength(0);
    expect(rows.size).toBe(0);
    expect(await vault.get(accountSecretName(OTHER, 'google'))).toBeNull();
  });

  it('a state works once', async () => {
    const { connect, finish, back } = setup();
    const { state } = await connect();
    expect((await finish(ANA, { state, code: 'the-code' })).status).toBe(404);
    expect((await back(`state=${state}&code=c`)).status).toBe(400);
    expect((await back('state=made-up&code=c')).status).toBe(400);
  });

  it('a sign-in that took too long is refused', async () => {
    const { start, stateOf, back, finish, rows, advance } = setup();
    const { url } = (await (await start()).json()) as { url: string };
    await back(`state=${stateOf(url)}&code=c`);
    advance(11 * 60_000);
    expect(await (await finish(ANA, { state: stateOf(url), code: 'c' })).json()).toEqual({ result: 'expired' });
    expect(rows.size).toBe(0);
  });

  it('saying no at Google, or a failure, keeps nothing', async () => {
    const denied = setup();
    const { url } = (await (await denied.start()).json()) as { url: string };
    const res = await denied.back(`state=${denied.stateOf(url)}&error=access_denied`);
    expect(res.headers.get('location')).toBe('ghostaff://conexiones?connected=google&result=denied');
    expect(denied.attempts.size).toBe(0);
    expect(denied.rows.size).toBe(0);

    const failing = setup({ exchangeFails: true });
    const { done } = await failing.connect();
    expect(await done.json()).toEqual({ result: 'failed' });
    expect(failing.rows.size).toBe(0);
  });

  it('when the person unticks every useful permission, the grant is revoked and nothing kept', async () => {
    const { connect, rows, vault, calls } = setup({ grantScopes: ['openid', 'email'] });
    const { done } = await connect();
    expect(await done.json()).toEqual({ result: 'missing_scopes' });
    expect(rows.size).toBe(0);
    expect(await vault.get(accountSecretName(ORG, 'google'))).toBeNull();
    expect(calls.revoked).toEqual(['refresh-secret']);
  });

  it('disconnecting revokes our grant, deletes the token and the row; members cannot', async () => {
    const { connect, call, rows, vault, calls } = setup();
    await connect();
    expect((await call(BEA, 'DELETE', `/connections/accounts/google?org=${ORG}`)).status).toBe(403);
    expect((await call(ANA, 'DELETE', `/connections/accounts/google?org=${ORG}`)).status).toBe(200);
    expect(calls.revoked).toEqual(['refresh-secret']);
    expect(rows.size).toBe(0);
    expect(await vault.get(accountSecretName(ORG, 'google'))).toBeNull();
  });

  it('refuses when Google is not configured on this engine', async () => {
    const t = setup();
    t.deps.providers = {} as never;
    expect((await t.start()).status).toBe(503);
  });
});

describe('an organisation\'s tools', () => {
  const listEvents: Tool = {
    name: 'google_calendar_list_events',
    description: 'Lista',
    input_schema: { type: 'object', properties: {} },
    provider: 'google',
    scope: CAL,
    writes: false,
    step: 'Mirando el calendario',
    run: async (ctx) => `token:${ctx.accessToken}`,
  };
  const createSheet: Tool = { ...listEvents, name: 'google_sheets_create', scope: FILES, step: 'Creando la hoja', run: async () => {
    throw new ToolError('Falta el nombre de la hoja.');
  } };

  async function connected(grantScopes?: string[]) {
    const t = setup({ grantScopes });
    t.deps.tools = [listEvents, createSheet];
    await t.connect();
    return t;
  }

  it('gets only the tools its accounts granted, and nothing for another organisation', async () => {
    const t = await connected(['openid', 'email', CAL]);
    const tools = await toolsFor(t.deps, accessTokens(t.deps), ORG);
    expect(tools.specs.map((s) => s.name)).toEqual(['google_calendar_list_events']);
    expect(tools.accounts).toEqual(['Google, con la cuenta ana@panaderia.es']);
    expect(await toolsFor(t.deps, accessTokens(t.deps), OTHER)).toBe(NO_TOOLS);
  });

  it('uses the token from the connect while it lasts, then refreshes once per expiry', async () => {
    const t = await connected();
    const token = accessTokens(t.deps);
    const tools = await toolsFor(t.deps, token, ORG);
    expect(await tools.run('google_calendar_list_events', {})).toEqual({ content: 'token:access-1', isError: false });
    expect(t.calls.refreshed).toBe(0);
    t.advance(3600_000);
    expect(await tools.run('google_calendar_list_events', {})).toEqual({ content: 'token:access-2', isError: false });
    expect(await tools.run('google_calendar_list_events', {})).toEqual({ content: 'token:access-2', isError: false });
    expect(t.calls.refreshed).toBe(1);
  });

  it('tells the model a tool\'s own failure, an unknown tool, and a bad input', async () => {
    const t = await connected();
    const tools = await toolsFor(t.deps, accessTokens(t.deps), ORG);
    expect(await tools.run('google_sheets_create', {})).toEqual({ content: 'Falta el nombre de la hoja.', isError: true });
    expect((await tools.run('borrar_todo', {})).isError).toBe(true);
    expect((await tools.run('google_calendar_list_events', 'x')).isError).toBe(true);
  });

  it('when Google no longer honours the grant, marks the connection failing and says to reconnect', async () => {
    const t = await connected();
    t.goneOnRefresh();
    t.advance(3600_000);
    const tools = await toolsFor(t.deps, accessTokens(t.deps), ORG);
    const out = await tools.run('google_calendar_list_events', {});
    expect(out.isError).toBe(true);
    expect(out.content).toContain('volver a conectarla en Conexiones');
    expect(t.rows.get(`${ORG}/google`)?.status).toBe('failing');
    expect(await toolsFor(t.deps, accessTokens(t.deps), ORG)).toBe(NO_TOOLS);
  });
});

describe('keeping a connection alive', () => {
  const tool: Tool = {
    name: 'acme_list',
    description: 'd',
    input_schema: { type: 'object', properties: {} },
    provider: 'notion',
    scope: '',
    writes: false,
    step: 's',
    run: async (ctx) => `token:${ctx.accessToken}`,
  };

  function provider(over: Partial<OAuthProvider> = {}): OAuthProvider {
    return {
      id: 'notion',
      method: 'mcp',
      usefulScopes: null,
      begin: async () => ({ url: 'https://x', codeVerifier: 'v'.repeat(43) }),
      exchange: async () => ({ accessToken: 'a0', refreshToken: 'r0', expiresIn: 3600, scopes: null }),
      refresh: async (r) => ({ accessToken: `a-from-${r}`, expiresIn: 3600, refreshToken: `${r}+` }),
      identity: async () => null,
      revoke: async () => {},
      tools: async () => [tool],
      ...over,
    };
  }

  it('saves a rotated refresh token before using the new access token', async () => {
    const vault = new MemoryVault();
    await vault.put(accountSecretName(ORG, 'notion'), JSON.stringify({ refreshToken: 'r0' }), {});
    const deps = { accounts: {} as AccountStore, vault, providers: { notion: provider() }, publicUrl: ENGINE, returnOrigins: [], tools: [] };
    expect(await accessTokens(deps)(ORG, 'notion')).toBe('a-from-r0');
    expect(JSON.parse((await vault.get(accountSecretName(ORG, 'notion'))) ?? '{}').refreshToken).toBe('r0+');
  });

  describe('across engine instances', () => {
    const NAME = accountSecretName(ORG, 'notion');
    const fresh = (accessToken: string) => JSON.stringify({ refreshToken: 'r0+', accessToken, expiresAt: Date.now() + 3600_000 });

    function leases(answers: boolean[]) {
      const log: string[] = [];
      const store: RefreshLeases = {
        take: async (org, p, holder) => {
          log.push(`take ${org}/${p} ${holder ? 'by-holder' : ''}`);
          return answers.length > 1 ? (answers.shift() as boolean) : (answers[0] ?? false);
        },
        release: async (org, p) => {
          log.push(`release ${org}/${p}`);
        },
      };
      return { store, log };
    }

    it('takes the account lease before refreshing and gives it back once the new token is saved', async () => {
      const vault = new MemoryVault();
      await vault.put(NAME, JSON.stringify({ refreshToken: 'r0' }), {});
      const l = leases([true]);
      const saving = vault.put.bind(vault);
      vault.put = async (...args: Parameters<MemoryVault['put']>) => {
        l.log.push('save');
        return saving(...args);
      };
      const p = provider({ refresh: async (r) => (l.log.push('refresh'), { accessToken: `a-from-${r}`, expiresIn: 3600, refreshToken: `${r}+` }) });
      const deps = { accounts: {} as AccountStore, vault, providers: { notion: p }, publicUrl: ENGINE, returnOrigins: [], tools: [], leases: l.store };
      expect(await accessTokens(deps)(ORG, 'notion')).toBe('a-from-r0');
      expect(l.log).toEqual([`take ${ORG}/notion by-holder`, 'refresh', 'save', `release ${ORG}/notion`]);
    });

    it('while another instance holds the lease, waits for the token it saves and never refreshes', async () => {
      const vault = new MemoryVault();
      await vault.put(NAME, JSON.stringify({ refreshToken: 'r0' }), {});
      let refreshed = 0;
      const p = provider({ refresh: async () => (refreshed++, { accessToken: 'mine', expiresIn: 3600, refreshToken: 'r1' }) });
      const sleep = async () => {
        await vault.put(NAME, fresh('a-other'), {});
      };
      const deps = { accounts: {} as AccountStore, vault, providers: { notion: p }, publicUrl: ENGINE, returnOrigins: [], tools: [], leases: leases([false]).store, sleep };
      expect(await accessTokens(deps)(ORG, 'notion')).toBe('a-other');
      expect(refreshed).toBe(0);
    });

    it('when the holder goes away without saving, refreshes once the lease is free', async () => {
      const vault = new MemoryVault();
      await vault.put(NAME, JSON.stringify({ refreshToken: 'r0' }), {});
      const l = leases([false, false, true]);
      const deps = { accounts: {} as AccountStore, vault, providers: { notion: provider() }, publicUrl: ENGINE, returnOrigins: [], tools: [], leases: l.store, sleep: async () => {} };
      expect(await accessTokens(deps)(ORG, 'notion')).toBe('a-from-r0');
      expect(l.log.filter((x) => x.startsWith('release'))).toHaveLength(1);
    });

    it('gives up after waiting, without calling the account gone', async () => {
      const vault = new MemoryVault();
      await vault.put(NAME, JSON.stringify({ refreshToken: 'r0' }), {});
      const deps = { accounts: {} as AccountStore, vault, providers: { notion: provider() }, publicUrl: ENGINE, returnOrigins: [], tools: [], leases: leases([false]).store, sleep: async () => {} };
      const err = await accessTokens(deps)(ORG, 'notion').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(AccountGone);
    });
  });

  it('without a refresh token, the access token serves until it expires, then the account is gone', async () => {
    let clock = new Date('2026-11-18T10:00:00Z');
    const vault = new MemoryVault();
    await vault.put(accountSecretName(ORG, 'notion'), JSON.stringify({ accessToken: 'only', expiresAt: clock.getTime() + 3600_000 }), {});
    const deps = { accounts: {} as AccountStore, vault, providers: { notion: provider() }, publicUrl: ENGINE, returnOrigins: [], tools: [], now: () => clock };
    const token = accessTokens(deps);
    expect(await token(ORG, 'notion')).toBe('only');
    clock = new Date(clock.getTime() + 3600_000);
    await expect(token(ORG, 'notion')).rejects.toBeInstanceOf(AccountGone);
  });

  it('an MCP account brings its own tools, and an account that cannot list them does not cost the others', async () => {
    const vault = new MemoryVault();
    await vault.put(accountSecretName(ORG, 'notion'), JSON.stringify({ refreshToken: 'r0' }), {});
    await vault.put(accountSecretName(ORG, 'stripe'), JSON.stringify({ refreshToken: 'r1' }), {});
    const statuses: string[] = [];
    const accounts = {
      accounts: async () => [
        { provider: 'notion', hint: 'Cuenta de Notion', scopes: [], status: 'ok', version: 'v1' },
        { provider: 'stripe', hint: 'Cuenta de Stripe', scopes: [], status: 'ok', version: 'v1' },
      ],
      setStatus: async (_o: string, p: string, st: string) => {
        statuses.push(`${p}:${st}`);
      },
    } as unknown as AccountStore;
    const stripe = provider({ id: 'stripe', refresh: async () => {
      throw new AccountGone('stripe');
    } });
    const deps = { accounts, vault, providers: { notion: provider(), stripe }, publicUrl: ENGINE, returnOrigins: [], tools: [] };
    const tools = await toolsFor(deps, accessTokens(deps), ORG);
    expect(tools.specs.map((t) => t.name)).toEqual(['acme_list']);
    expect(tools.accounts).toEqual(['Notion, con la cuenta Cuenta de Notion']);
    expect(statuses).toEqual(['stripe:failing']);
  });
});

describe('a provider that cannot start a sign-in', () => {
  it('answers provider_unavailable instead of a bare failure', async () => {
    const t = setup();
    t.deps.providers = {
      google: {
        ...(t.deps.providers.google as OAuthProvider),
        begin: async () => {
          throw new Error('server down');
        },
      },
    };
    const res = await t.start();
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('provider_unavailable');
    expect(t.attempts.size).toBe(0);
  });

  it('answers provider_not_configured when our own app with the maker is not set up yet', async () => {
    const t = setup();
    t.deps.providers = {
      google: {
        ...(t.deps.providers.google as OAuthProvider),
        begin: async () => {
          throw new NotConfigured('google');
        },
      },
    };
    const res = await t.start();
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe('provider_not_configured');
    expect(t.attempts.size).toBe(0);
  });
});

describe('a provider whose tokens live long', () => {
  it('renews only inside its window, and keeps the renewed token', async () => {
    let clock = new Date('2026-11-18T10:00:00Z');
    const vault = new MemoryVault();
    const day = 86_400_000;
    await vault.put(accountSecretName(ORG, 'instagram'), JSON.stringify({ refreshToken: 'long-1', accessToken: 'long-1', expiresAt: clock.getTime() + 60 * day }), {});
    let refreshed = 0;
    const ig: OAuthProvider = {
      id: 'instagram',
      method: 'oauth',
      usefulScopes: null,
      refreshWithin: 7 * day,
      begin: async () => ({ url: '', codeVerifier: '' }),
      exchange: async () => ({ accessToken: '', expiresIn: 0, scopes: null }),
      refresh: async () => {
        refreshed += 1;
        return { accessToken: 'long-2', refreshToken: 'long-2', expiresIn: 60 * 86_400 };
      },
      identity: async () => null,
      revoke: async () => {},
    };
    const deps = { accounts: {} as AccountStore, vault, providers: { instagram: ig }, publicUrl: ENGINE, returnOrigins: [], tools: [], now: () => clock };
    expect(await accessTokens(deps)(ORG, 'instagram')).toBe('long-1');
    clock = new Date(clock.getTime() + 50 * day);
    expect(await accessTokens(deps)(ORG, 'instagram')).toBe('long-1');
    expect(refreshed).toBe(0);
    clock = new Date(clock.getTime() + 4 * day);
    expect(await accessTokens(deps)(ORG, 'instagram')).toBe('long-2');
    expect(refreshed).toBe(1);
    expect(JSON.parse((await vault.get(accountSecretName(ORG, 'instagram'))) ?? '{}').refreshToken).toBe('long-2');
  });
});
