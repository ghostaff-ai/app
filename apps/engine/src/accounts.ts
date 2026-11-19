// Connecting an organisation's outside accounts by signing in there
// (docs/plans/ongoing/connectors.md, «How one connector works»), and handing their
// tools to its agents.
//
// 1. An owner asks to connect: the engine stores a one-time `state` and a PKCE
//    verifier, and returns the provider's sign-in page.
// 2. The provider sends the browser back to the engine with a code and that
//    `state`. The engine does not finish there: it passes the code on to the
//    app address the attempt named.
// 3. The app finishes it, signed in. The engine takes the attempt (once, within
//    ten minutes) and goes on only if the person finishing is the one who
//    started: otherwise someone could start a connect for their own
//    organisation and get a stranger to sign in, putting the stranger's account
//    in their hands. Then it swaps the code for tokens (the PKCE verifier never
//    left the engine, so a code seen on the way is useless), keeps the refresh
//    token in the vault, and records in the database only that the account is
//    connected: provider, email, scopes, who.
// 4. When an agent runs, the engine turns the refresh token into a short-lived
//    access token for the organisation of the run, never for one the model names.
//
// Tokens never reach the database, the app or a log.

import { createHash, randomBytes } from 'node:crypto';
import { ACCOUNT_PROVIDERS, type AccountConnectResult, type AccountProvider, connectorFor } from '@ghostaff/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type Membership, Refusal, requireOwner } from './connections';
import { type AgentTools, NO_TOOLS, type Tool, ToolError } from './tools';
import { accountSecretName, type Vault } from './vault';

/** The provider no longer honours our grant: revoked, or expired. Reconnecting fixes it. */
export class AccountGone extends Error {
  constructor(readonly provider: AccountProvider) {
    super(`the ${provider} account no longer grants access`);
    this.name = 'AccountGone';
  }
}

/** Our own app with this provider is not set up on this engine yet: the person sees «not available yet». */
export class NotConfigured extends Error {
  constructor(readonly provider: string) {
    super(`${provider} has no client configured on this engine`);
    this.name = 'NotConfigured';
  }
}

/** The OAuth client a grant was issued to, when it is not one fixed client (an MCP server's registration). */
export interface GrantClient {
  clientId: string;
  clientSecret?: string;
}

export interface AccountGrant {
  /** Absent when the provider gives none: the connection then lasts as long as the access token. */
  refreshToken?: string;
  /** Kept with the tokens, so a client registered again later cannot orphan this grant. */
  client?: GrantClient;
  accessToken: string;
  /** Seconds. */
  expiresIn: number;
  /** The scopes granted, or null when the provider does not say. */
  scopes: string[] | null;
}

/** What the vault keeps for a connected account. */
export interface StoredGrant {
  refreshToken?: string;
  client?: GrantClient;
  accessToken?: string;
  /** Epoch milliseconds. */
  expiresAt?: number;
}

/** One provider's sign-in, as the engine needs it: our own (Google) or a maker's MCP server. */
export interface OAuthProvider {
  id: AccountProvider;
  method: 'oauth' | 'mcp';
  /**
   * Without at least one of these the connection serves no tool, so it is not
   * kept. Null when the provider does not report what was granted.
   */
  usefulScopes: string[] | null;
  /** The provider's sign-in page, and the PKCE verifier to keep until the person comes back. */
  begin(p: { state: string; redirectUri: string }): Promise<{ url: string; codeVerifier: string }>;
  exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<AccountGrant>;
  /** Throws AccountGone when the grant is no longer valid. A provider that rotates refresh tokens returns the new one. */
  refresh(refreshToken: string, client?: GrantClient): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string }>;
  /** The account's email, which the app shows to recognise it; null when the provider does not tell. */
  identity(accessToken: string): Promise<string | null>;
  revoke(token: string): Promise<void>;
  /** The account's own tools (an MCP server lists them). Absent: the engine's tools for this provider, by scope. */
  tools?(accessToken: string): Promise<Tool[]>;
  /**
   * How long before its expiry an access token is renewed, in milliseconds.
   * One minute unless the provider's tokens live long and refresh slowly
   * (Instagram's last 60 days and refuse a refresh in their first day).
   */
  refreshWithin?: number;
}

export interface Attempt {
  state: string;
  orgId: string;
  userId: string;
  provider: AccountProvider;
  codeVerifier: string;
  returnTo: string;
  createdAt: string;
}

export interface AccountRecord {
  org_id: string;
  kind: 'account';
  provider: AccountProvider;
  method: 'oauth' | 'mcp';
  hint: string;
  settings: { scopes: string[] };
  status: 'ok';
  checked_at: string;
  connected_by: string;
  connected_by_name: string;
  updated_at: string;
}

export interface AccountConnection {
  provider: AccountProvider;
  hint: string;
  scopes: string[];
  status: 'ok' | 'failing';
  /** Changes on every reconnect (the row's updated_at): a cached token of an older grant is never used. */
  version: string;
}

/** The database as account connections need it (service role). */
export interface AccountStore {
  membership(orgId: string, userId: string): Promise<Membership | null>;
  createAttempt(a: Omit<Attempt, 'createdAt'>): Promise<void>;
  findAttempt(state: string): Promise<Attempt | null>;
  /** Deletes the attempt and returns it: a `state` works once. */
  takeAttempt(state: string): Promise<Attempt | null>;
  upsertAccount(row: AccountRecord): Promise<void>;
  removeAccount(orgId: string, provider: AccountProvider): Promise<void>;
  setStatus(orgId: string, provider: AccountProvider, status: 'ok' | 'failing'): Promise<void>;
  accounts(orgId: string): Promise<AccountConnection[]>;
}

export interface AccountDeps {
  accounts: AccountStore;
  vault: Vault;
  /** Only providers whose OAuth client is configured; the rest refuse to connect. */
  providers: Partial<Record<AccountProvider, OAuthProvider>>;
  /** The engine's own public URL: providers send the browser back to it. */
  publicUrl: string;
  /** Web origins the app may ask to go back to, besides the app's own scheme. */
  returnOrigins: string[];
  /** Every tool there is; an organisation gets those its accounts grant. */
  tools: Tool[];
  now?: () => Date;
  fetch?: typeof fetch;
}

/** How long a sign-in may take before its attempt is refused. */
export const ATTEMPT_TTL_MS = 10 * 60_000;

const base64url = (b: Buffer) => b.toString('base64url');
export const randomToken = () => base64url(randomBytes(32));
export const codeChallenge = (verifier: string) => base64url(createHash('sha256').update(verifier).digest());

export const isAccountProvider = (p: unknown): p is AccountProvider => ACCOUNT_PROVIDERS.includes(p as AccountProvider);

export const callbackUrl = (publicUrl: string, provider: AccountProvider) =>
  `${publicUrl.replace(/\/$/, '')}/connections/oauth/${provider}/callback`;

/** A local engine (http://localhost…): development, where dev builds, Expo Go and a local web app come back too. */
export const isLocalEngine = (publicUrl: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(publicUrl);

/**
 * Where the engine may send the person back to, with the provider's code in
 * the address: the app's own scheme, or a web origin we list. A local engine
 * also takes the development addresses (the dev build's and Expo Go's schemes,
 * localhost). Never anywhere else: an address of the attacker's choosing would
 * hand them a stranger's code, which they could then finish as themselves.
 */
export function allowedReturn(returnTo: unknown, origins: string[], local = false): returnTo is string {
  if (typeof returnTo !== 'string' || returnTo.length > 500) return false;
  let u: URL;
  try {
    u = new URL(returnTo);
  } catch {
    return false;
  }
  if (u.protocol === 'ghostaff:') return true;
  if ((u.protocol === 'https:' || u.protocol === 'http:') && origins.includes(u.origin)) return true;
  if (!local) return false;
  if (u.protocol === 'exp+ghostaff:' || u.protocol === 'exp:') return true;
  return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
}

function backTo(returnTo: string, provider: AccountProvider, result: AccountConnectResult): string {
  const u = new URL(returnTo);
  u.searchParams.set('connected', provider);
  u.searchParams.set('result', result);
  return u.toString();
}

function providerOrRefuse(deps: AccountDeps, provider: unknown): OAuthProvider {
  if (!isAccountProvider(provider)) throw new Refusal(400, 'bad_request', 'unknown provider');
  const p = deps.providers[provider];
  if (!p) throw new Refusal(503, 'provider_not_configured', `${provider} is not configured on this engine`);
  return p;
}

/** Step 1: returns the provider's sign-in page for an owner of the organisation. */
export async function startAccountConnect(deps: AccountDeps, userId: string, provider: unknown, body: unknown): Promise<{ url: string }> {
  const p = providerOrRefuse(deps, provider);
  const input = (body ?? {}) as { orgId?: unknown; returnTo?: unknown };
  await requireOwner(deps.accounts, input.orgId, userId);
  if (!allowedReturn(input.returnTo, deps.returnOrigins, isLocalEngine(deps.publicUrl))) {
    throw new Refusal(400, 'bad_return', 'returnTo is not an address of the app');
  }
  const state = randomToken();
  let begun: { url: string; codeVerifier: string };
  try {
    begun = await p.begin({ state, redirectUri: callbackUrl(deps.publicUrl, p.id) });
  } catch (e) {
    if (e instanceof NotConfigured) throw new Refusal(503, 'provider_not_configured', `${p.id} is not configured on this engine`);
    // The provider's sign-in could not be prepared: its server is down, or it will not take this engine as a client.
    console.error('account connect could not start', p.id, e instanceof Error ? e.message.slice(0, 200) : typeof e);
    throw new Refusal(502, 'provider_unavailable', `${p.id} could not start a sign-in`);
  }
  const { url, codeVerifier } = begun;
  await deps.accounts.createAttempt({
    state,
    orgId: input.orgId as string,
    userId,
    provider: p.id,
    codeVerifier,
    returnTo: input.returnTo,
  });
  return { url };
}

/**
 * Step 2: the provider's redirect. Returns where to send the browser: the app
 * address of the attempt, with the code to finish it, or how it ended when it
 * cannot be finished. Null when the `state` is unknown (already used, or never
 * ours): then there is nowhere safe to send it.
 */
export async function returnFromProvider(
  deps: AccountDeps,
  provider: unknown,
  query: { state?: string; code?: string; error?: string },
): Promise<string | null> {
  if (!isAccountProvider(provider) || typeof query.state !== 'string' || query.state.length > 128) return null;
  const attempt = await deps.accounts.findAttempt(query.state);
  if (!attempt || attempt.provider !== provider) return null;
  if (query.error || typeof query.code !== 'string' || !query.code) {
    await deps.accounts.takeAttempt(query.state);
    return backTo(attempt.returnTo, attempt.provider, query.error === 'access_denied' ? 'denied' : 'failed');
  }
  const u = new URL(attempt.returnTo);
  u.searchParams.set('connected', attempt.provider);
  u.searchParams.set('state', query.state);
  u.searchParams.set('code', query.code.slice(0, 2048));
  return u.toString();
}

/** Step 3: the app finishes the connect, as the person who started it. */
export async function finishAccountConnect(
  deps: AccountDeps,
  userId: string,
  provider: unknown,
  body: unknown,
): Promise<{ result: AccountConnectResult }> {
  if (!isAccountProvider(provider)) throw new Refusal(400, 'bad_request', 'unknown provider');
  const input = (body ?? {}) as { state?: unknown; code?: unknown };
  if (typeof input.state !== 'string' || input.state.length > 128 || typeof input.code !== 'string' || !input.code) {
    throw new Refusal(400, 'bad_request', 'state and code are required');
  }
  const attempt = await deps.accounts.takeAttempt(input.state);
  if (!attempt || attempt.provider !== provider) throw new Refusal(404, 'not_found', 'no such connect in progress');
  // Only the person who started may finish: the same refusal for anyone else, whoever they are.
  if (attempt.userId !== userId) throw new Refusal(403, 'not_yours', 'this connect was started by someone else');
  const now = (deps.now ?? (() => new Date()))();
  if (now.getTime() - Date.parse(attempt.createdAt) > ATTEMPT_TTL_MS) return { result: 'expired' };
  const p = deps.providers[attempt.provider];
  if (!p) throw new Refusal(503, 'provider_not_configured', `${provider} is not configured on this engine`);

  // Still an owner? They may have been removed while signing in.
  const owner = await deps.accounts.membership(attempt.orgId, attempt.userId);
  if (!owner || owner.role !== 'owner') throw new Refusal(403, 'not_owner', 'only an owner manages connections');
  try {
    const grant = await p.exchange({ code: input.code, codeVerifier: attempt.codeVerifier, redirectUri: callbackUrl(deps.publicUrl, p.id) });
    const useful = p.usefulScopes && grant.scopes ? grant.scopes.filter((s) => p.usefulScopes?.includes(s)) : (grant.scopes ?? []);
    if (p.usefulScopes && useful.length === 0) {
      await p.revoke(grant.refreshToken ?? grant.accessToken).catch(() => {});
      return { result: 'missing_scopes' };
    }
    const email = await p.identity(grant.accessToken).catch(() => null);
    const stored: StoredGrant = {
      refreshToken: grant.refreshToken,
      client: grant.client,
      accessToken: grant.accessToken,
      expiresAt: now.getTime() + grant.expiresIn * 1000,
    };
    await deps.vault.put(accountSecretName(attempt.orgId, p.id), JSON.stringify(stored), {
      org_id: attempt.orgId,
      provider: p.id,
      kind: 'account',
    });
    const at = now.toISOString();
    await deps.accounts.upsertAccount({
      org_id: attempt.orgId,
      kind: 'account',
      provider: p.id,
      method: p.method,
      hint: (email ?? `Cuenta de ${connectorFor(p.id).name}`).slice(0, 80),
      settings: { scopes: useful },
      status: 'ok',
      checked_at: at,
      connected_by: attempt.userId,
      connected_by_name: owner.displayName,
      updated_at: at,
    });
    return { result: 'ok' };
  } catch (e) {
    console.error('account connect failed', provider, e instanceof Error ? e.name : typeof e);
    return { result: 'failed' };
  }
}

/** Removes the account: revokes our grant with the provider, deletes the token, then the row. */
export async function disconnectAccount(deps: AccountDeps, userId: string, orgId: unknown, provider: unknown): Promise<void> {
  if (!isAccountProvider(provider)) throw new Refusal(400, 'bad_request', 'unknown provider');
  await requireOwner(deps.accounts, orgId, userId);
  const name = accountSecretName(orgId as string, provider);
  const stored = await deps.vault.get(name);
  const p = deps.providers[provider];
  if (stored && p) {
    const grant = JSON.parse(stored) as StoredGrant;
    const token = grant.refreshToken ?? grant.accessToken;
    if (token) await p.revoke(token).catch(() => {});
  }
  // The token goes first: if that fails, the row stays and the owner can retry.
  await deps.vault.remove(name);
  await deps.accounts.removeAccount(orgId as string, provider);
}

/**
 * Short-lived access tokens from the vault, refreshed only near their expiry.
 * One per organisation, provider and grant version, so a reconnect is never
 * served an older account's token. Within an instance one refresh at a time
 * per key: a provider that rotates refresh tokens kills the old one, and two
 * refreshes with it would cost the second its grant. Across instances the
 * same race is caught after the fact: a refused refresh rereads the vault and
 * goes on with the token another instance just saved.
 */
export function accessTokens(deps: AccountDeps) {
  const cache = new Map<string, { token: string; until: number }>();
  const inflight = new Map<string, Promise<string>>();
  const now = () => (deps.now ?? (() => new Date()))().getTime();

  const remember = (key: string, prefix: string, token: string, until: number) => {
    for (const k of cache.keys()) if (k.startsWith(prefix) && k !== key) cache.delete(k);
    cache.set(key, { token, until });
  };

  const load = async (orgId: string, provider: AccountProvider, key: string, prefix: string, retried = false): Promise<string> => {
    const p = deps.providers[provider];
    const name = accountSecretName(orgId, provider);
    const raw = await deps.vault.get(name);
    if (!p || !raw) throw new AccountGone(provider);
    const stored = JSON.parse(raw) as StoredGrant;
    // The stored access token while it has life left: no call to the provider at all.
    const margin = p.refreshWithin ?? 60_000;
    if (stored.accessToken && stored.expiresAt && stored.expiresAt - margin > now()) {
      remember(key, prefix, stored.accessToken, stored.expiresAt - margin);
      return stored.accessToken;
    }
    if (!stored.refreshToken) {
      // No refresh token: the access token was all there was.
      if (stored.accessToken && (stored.expiresAt ?? 0) - 60_000 > now()) return stored.accessToken;
      throw new AccountGone(provider);
    }
    let fresh: Awaited<ReturnType<OAuthProvider['refresh']>>;
    try {
      fresh = await p.refresh(stored.refreshToken, stored.client);
    } catch (e) {
      if (!(e instanceof AccountGone) || retried) throw e;
      // Another instance may have rotated it a moment ago: then the vault holds the new one.
      const again = await deps.vault.get(name);
      const now2 = again ? (JSON.parse(again) as StoredGrant) : null;
      if (now2?.refreshToken && now2.refreshToken !== stored.refreshToken) return load(orgId, provider, key, prefix, true);
      throw e;
    }
    const expiresAt = now() + fresh.expiresIn * 1000;
    if (fresh.refreshToken && fresh.refreshToken !== stored.refreshToken) {
      // Rotated: the old one is dead now, so the new one is saved before anything else.
      const next: StoredGrant = { refreshToken: fresh.refreshToken, client: stored.client, accessToken: fresh.accessToken, expiresAt };
      await deps.vault.put(name, JSON.stringify(next), { org_id: orgId, provider, kind: 'account' });
    }
    remember(key, prefix, fresh.accessToken, expiresAt - Math.min(margin, (fresh.expiresIn * 1000) / 2));
    return fresh.accessToken;
  };

  return async (orgId: string, provider: AccountProvider, version = ''): Promise<string> => {
    const prefix = `${orgId}/${provider}/`;
    const key = `${prefix}${version}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.token;
    const running = inflight.get(key);
    if (running) return running;
    const loading = load(orgId, provider, key, prefix).finally(() => inflight.delete(key));
    inflight.set(key, loading);
    return loading;
  };
}

/** How long listing one account's tools may take before the agent goes on without them. */
export const LIST_TOOLS_TIMEOUT_MS = 10_000;
/** How long one tool call may take (a video upload included). */
export const TOOL_CALL_TIMEOUT_MS = 180_000;

/** A fetch that gives up after `ms` unless the caller passed its own signal. */
export function timedFetch(f: typeof fetch, ms: number): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init: RequestInit = {}) =>
    f(input, init.signal ? init : { ...init, signal: AbortSignal.timeout(ms) })) as typeof fetch;
}

function within<T>(ms: number, work: Promise<T>): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms).unref?.())]);
}

/**
 * The tools an organisation's agents get in a run: those of its connected
 * accounts, each only if the account granted the scope it needs.
 */
export async function toolsFor(deps: AccountDeps, token: ReturnType<typeof accessTokens>, orgId: string): Promise<AgentTools> {
  const connected = (await deps.accounts.accounts(orgId)).filter((a) => a.status === 'ok' && deps.providers[a.provider]);
  if (connected.length === 0) return NO_TOOLS;
  const lists = await Promise.all(
    connected.map(async (a): Promise<Tool[]> => {
      const p = deps.providers[a.provider];
      if (!p) return [];
      if (!p.tools) return deps.tools.filter((t) => t.provider === a.provider && a.scopes.includes(t.scope));
      try {
        return await within(LIST_TOOLS_TIMEOUT_MS, (async () => p.tools?.(await token(orgId, a.provider, a.version)) ?? [])());
      } catch (e) {
        // One account that cannot list its tools must not cost the agent the others.
        if (e instanceof AccountGone) await deps.accounts.setStatus(orgId, a.provider, 'failing').catch(() => {});
        else console.error('listing tools failed', a.provider, e instanceof Error ? e.message.slice(0, 200) : typeof e);
        return [];
      }
    }),
  );
  // A name the model sees once only: a duplicate (two servers' tools clipped alike) would make every request fail.
  const tools: Tool[] = [];
  const seen = new Set<string>();
  for (const t of lists.flat()) {
    if (seen.has(t.name) || !/^[a-zA-Z0-9_-]{1,64}$/.test(t.name) || t.input_schema?.type !== 'object') continue;
    seen.add(t.name);
    tools.push(t);
  }
  if (tools.length === 0) return NO_TOOLS;
  const reachable = connected.filter((a, i) => (lists[i]?.length ?? 0) > 0);
  const versions = new Map(connected.map((a) => [a.provider, a.version]));
  const byName = new Map(tools.map((t) => [t.name, t]));
  const f = timedFetch(deps.fetch ?? fetch, TOOL_CALL_TIMEOUT_MS);
  return {
    specs: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
    accounts: reachable.map((a) => `${connectorFor(a.provider).name}, con la cuenta ${a.hint}`),
    stepFor: (name) => byName.get(name)?.step ?? 'Trabajando',
    writes: (name) => byName.get(name)?.writes ?? true,
    actionFor: (name) => byName.get(name)?.action ?? byName.get(name)?.step ?? name,
    async run(name, input) {
      const tool = byName.get(name);
      if (!tool) return { content: `No existe la herramienta ${name}.`, isError: true };
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { content: 'La entrada de la herramienta tiene que ser un objeto.', isError: true };
      }
      try {
        const accessToken = await token(orgId, tool.provider, versions.get(tool.provider));
        const content = await tool.run({ accessToken, fetch: f }, input as Record<string, unknown>);
        return { content, isError: false };
      } catch (e) {
        if (e instanceof AccountGone) {
          await deps.accounts.setStatus(orgId, tool.provider, 'failing').catch(() => {});
          return {
            content: `La cuenta de ${connectorFor(tool.provider).name} ya no nos da acceso. Quien es propietario tiene que volver a conectarla en Conexiones.`,
            isError: true,
          };
        }
        if (e instanceof ToolError) return { content: e.message, isError: true };
        console.error('tool failed', name, e instanceof Error ? e.name : typeof e);
        return { content: 'La herramienta ha fallado o ha tardado demasiado. Prueba otra vez en un momento.', isError: true };
      }
    },
  };
}

interface AttemptRow {
  state: string;
  org_id: string;
  user_id: string;
  provider: AccountProvider;
  code_verifier: string;
  return_to: string;
  created_at: string;
}

function attemptFromRow(r: AttemptRow): Attempt {
  return {
    state: r.state,
    orgId: r.org_id,
    userId: r.user_id,
    provider: r.provider,
    codeVerifier: r.code_verifier,
    returnTo: r.return_to,
    createdAt: r.created_at,
  };
}

/** The AccountStore over Supabase with the service role. */
export function supabaseAccountStore(admin: SupabaseClient): AccountStore {
  const check = <T>(r: { data: T; error: unknown }): T => {
    if (r.error) throw r.error;
    return r.data;
  };
  return {
    async membership(orgId, userId) {
      const r = check(
        await admin.from('memberships').select('role, display_name').eq('org_id', orgId).eq('user_id', userId).maybeSingle(),
      );
      return r ? { role: r.role, displayName: r.display_name } : null;
    },
    async createAttempt(a) {
      // Abandoned sign-ins go: nothing older than an hour is any use (ATTEMPT_TTL_MS is ten minutes).
      check(await admin.from('connection_attempts').delete().lt('created_at', new Date(Date.now() - 3600_000).toISOString()));
      check(
        await admin.from('connection_attempts').insert({
          state: a.state,
          org_id: a.orgId,
          user_id: a.userId,
          provider: a.provider,
          code_verifier: a.codeVerifier,
          return_to: a.returnTo,
        }),
      );
    },
    async findAttempt(state) {
      const r = check(await admin.from('connection_attempts').select().eq('state', state).maybeSingle<AttemptRow>());
      return r ? attemptFromRow(r) : null;
    },
    async takeAttempt(state) {
      const rows = check(await admin.from('connection_attempts').delete().eq('state', state).select().returns<AttemptRow[]>()) ?? [];
      return rows[0] ? attemptFromRow(rows[0]) : null;
    },
    async upsertAccount(row) {
      check(await admin.from('connections').upsert(row, { onConflict: 'org_id,provider' }));
    },
    async removeAccount(orgId, provider) {
      check(await admin.from('connections').delete().eq('org_id', orgId).eq('provider', provider));
    },
    async setStatus(orgId, provider, status) {
      check(await admin.from('connections').update({ status, checked_at: new Date().toISOString() }).eq('org_id', orgId).eq('provider', provider));
    },
    async accounts(orgId) {
      const rows =
        check(await admin.from('connections').select('provider, hint, settings, status, updated_at').eq('org_id', orgId).eq('kind', 'account')) ?? [];
      return rows.map((r) => ({ provider: r.provider, hint: r.hint, scopes: r.settings?.scopes ?? [], status: r.status, version: r.updated_at }));
    },
  };
}
