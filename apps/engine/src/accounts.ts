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
import { ACCOUNT_PROVIDERS, type AccountConnectResult, type AccountProvider } from '@ghostaff/shared';
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

export interface AccountGrant {
  refreshToken: string;
  accessToken: string;
  /** Seconds. */
  expiresIn: number;
  scopes: string[];
}

/** One provider's sign-in, as the engine needs it. */
export interface OAuthProvider {
  id: AccountProvider;
  /** What we ask for. The person may grant fewer: some consent screens let them untick boxes. */
  scopes: string[];
  /** Without at least one of these the connection serves no tool, so it is not kept. */
  usefulScopes: string[];
  authorizeUrl(p: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<AccountGrant>;
  /** Throws AccountGone when the grant is no longer valid. */
  refresh(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }>;
  /** The account's email, which the app shows to recognise it. */
  identity(accessToken: string): Promise<string>;
  revoke(token: string): Promise<void>;
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
  method: 'oauth';
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
  /** Web origins the app may ask to go back to, besides the app's own schemes and localhost. */
  returnOrigins: string[];
  /** Every tool there is; an organisation gets those its accounts grant. */
  tools: Tool[];
  now?: () => Date;
  fetch?: typeof fetch;
}

/** How long a sign-in may take before its attempt is refused. */
export const ATTEMPT_TTL_MS = 10 * 60_000;

const base64url = (b: Buffer) => b.toString('base64url');
const randomToken = () => base64url(randomBytes(32));
export const codeChallenge = (verifier: string) => base64url(createHash('sha256').update(verifier).digest());

export const isAccountProvider = (p: unknown): p is AccountProvider => ACCOUNT_PROVIDERS.includes(p as AccountProvider);

export const callbackUrl = (publicUrl: string, provider: AccountProvider) =>
  `${publicUrl.replace(/\/$/, '')}/connections/oauth/${provider}/callback`;

/** The app's own schemes (builds, dev builds, Expo Go). */
const APP_PROTOCOLS = new Set(['ghostaff:', 'exp+ghostaff:', 'exp:']);

/**
 * Where the engine may send the person back to: the app itself, localhost (a
 * web app run locally), or an origin we list. Never anywhere else, so the
 * callback cannot be used to bounce someone to a page of an attacker's choosing.
 */
export function allowedReturn(returnTo: unknown, origins: string[]): returnTo is string {
  if (typeof returnTo !== 'string' || returnTo.length > 500) return false;
  let u: URL;
  try {
    u = new URL(returnTo);
  } catch {
    return false;
  }
  if (APP_PROTOCOLS.has(u.protocol)) return true;
  if ((u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
  return (u.protocol === 'https:' || u.protocol === 'http:') && origins.includes(u.origin);
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
  if (!allowedReturn(input.returnTo, deps.returnOrigins)) throw new Refusal(400, 'bad_return', 'returnTo is not an address of the app');
  const state = randomToken();
  const codeVerifier = randomToken();
  await deps.accounts.createAttempt({
    state,
    orgId: input.orgId as string,
    userId,
    provider: p.id,
    codeVerifier,
    returnTo: input.returnTo,
  });
  return { url: p.authorizeUrl({ state, codeChallenge: codeChallenge(codeVerifier), redirectUri: callbackUrl(deps.publicUrl, p.id) }) };
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
    const useful = grant.scopes.filter((s) => p.usefulScopes.includes(s));
    if (useful.length === 0) {
      await p.revoke(grant.refreshToken).catch(() => {});
      return { result: 'missing_scopes' };
    }
    const email = await p.identity(grant.accessToken);
    await deps.vault.put(accountSecretName(attempt.orgId, p.id), JSON.stringify({ refreshToken: grant.refreshToken }), {
      org_id: attempt.orgId,
      provider: p.id,
      kind: 'account',
    });
    const at = now.toISOString();
    await deps.accounts.upsertAccount({
      org_id: attempt.orgId,
      kind: 'account',
      provider: p.id,
      method: 'oauth',
      hint: email.slice(0, 80),
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
  if (stored && p) await p.revoke((JSON.parse(stored) as { refreshToken: string }).refreshToken).catch(() => {});
  // The token goes first: if that fails, the row stays and the owner can retry.
  await deps.vault.remove(name);
  await deps.accounts.removeAccount(orgId as string, provider);
}

/**
 * Short-lived access tokens from the vault's refresh tokens, kept in memory
 * until a minute before they expire. One per organisation and provider.
 */
export function accessTokens(deps: AccountDeps) {
  const cache = new Map<string, { token: string; until: number }>();
  const now = () => (deps.now ?? (() => new Date()))().getTime();
  return async (orgId: string, provider: AccountProvider): Promise<string> => {
    const key = `${orgId}/${provider}`;
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.token;
    const p = deps.providers[provider];
    const stored = await deps.vault.get(accountSecretName(orgId, provider));
    if (!p || !stored) throw new AccountGone(provider);
    const { accessToken, expiresIn } = await p.refresh((JSON.parse(stored) as { refreshToken: string }).refreshToken);
    cache.set(key, { token: accessToken, until: now() + Math.max(0, expiresIn - 60) * 1000 });
    return accessToken;
  };
}

const PROVIDER_NAMES: Record<AccountProvider, string> = { google: 'Google' };

/**
 * The tools an organisation's agents get in a run: those of its connected
 * accounts, each only if the account granted the scope it needs.
 */
export async function toolsFor(deps: AccountDeps, token: ReturnType<typeof accessTokens>, orgId: string): Promise<AgentTools> {
  const connected = (await deps.accounts.accounts(orgId)).filter((a) => a.status === 'ok' && deps.providers[a.provider]);
  if (connected.length === 0) return NO_TOOLS;
  const tools = deps.tools.filter((t) => connected.some((a) => a.provider === t.provider && a.scopes.includes(t.scope)));
  if (tools.length === 0) return NO_TOOLS;
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    specs: tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })),
    accounts: connected.map((a) => `${PROVIDER_NAMES[a.provider]}, con la cuenta ${a.hint}`),
    stepFor: (name) => byName.get(name)?.step ?? 'Trabajando',
    async run(name, input) {
      const tool = byName.get(name);
      if (!tool) return { content: `No existe la herramienta ${name}.`, isError: true };
      if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        return { content: 'La entrada de la herramienta tiene que ser un objeto.', isError: true };
      }
      try {
        const accessToken = await token(orgId, tool.provider);
        const content = await tool.run({ accessToken, fetch: deps.fetch ?? fetch }, input as Record<string, unknown>);
        return { content, isError: false };
      } catch (e) {
        if (e instanceof AccountGone) {
          await deps.accounts.setStatus(orgId, tool.provider, 'failing').catch(() => {});
          return {
            content: `La cuenta de ${PROVIDER_NAMES[tool.provider]} ya no nos da acceso. Quien es propietario tiene que volver a conectarla en Conexiones.`,
            isError: true,
          };
        }
        if (e instanceof ToolError) return { content: e.message, isError: true };
        console.error('tool failed', name, e instanceof Error ? e.name : typeof e);
        return { content: 'La herramienta ha fallado. Prueba otra vez en un momento.', isError: true };
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
      const rows = check(await admin.from('connections').select('provider, hint, settings, status').eq('org_id', orgId).eq('kind', 'account')) ?? [];
      return rows.map((r) => ({ provider: r.provider, hint: r.hint, scopes: r.settings?.scopes ?? [], status: r.status }));
    },
  };
}
