// Guided accesses (docs/plans/ready/guided-access.md): an agent's own user or
// key in an app with an HTTP API, given by a person through a guide.
//
// Two halves live here. `checkLanding` tries the credential the person typed
// against the app, once, before anything is kept: a GET under the address
// they gave that must answer 2xx (and, optionally, carry an expected value).
// Once the access exists, `guidedToolsFor` gives the one agent it belongs to a
// `<provider>_request` tool for it.
//
// The model never sees the credential: it lives in the vault, the engine adds
// it to each request, and it is cut out of anything the app answers. Requests
// reach only paths under the access's base and only public addresses
// (fetchPublic). A GET reads; any other method writes, so the chat turns it
// into a card an owner approves (chat.ts, actions.ts).

import { type GuideAuth, type GuideField, type GuideLanding, normaliseBase } from '@ghostaff/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isIP } from 'node:net';
import { TOOL_CALL_TIMEOUT_MS, timedFetch } from './accounts';
import { previewOf } from './actions';
import { fetchPublic, isPublicAddress } from './publicFetch';
import { type AgentTools, clip, NO_TOOLS, ToolError, type ToolSpec } from './tools';
import { guidedSecretName, type Vault } from './vault';

/** How long the check may take before the address counts as unreachable. */
export const CHECK_TIMEOUT_MS = 15_000;

/** The most of an answer the engine reads; the model gets it clipped further (TOOL_OUTPUT_LIMIT). */
const READ_LIMIT = 1_000_000;

/** `connections.settings` of a guided access (migration 20261126100000_guides.sql). */
export interface GuidedSettings {
  /** The https origin the person typed, plus the landing's suffix. */
  base: string;
  auth: GuideAuth;
  /** The header that carries the key; only with `auth: 'header'`. */
  headerName?: string;
  /** The app's name, as the guide called it («WordPress»). */
  app: string;
  /** The guide that created it; its id names the credential in the vault. */
  guideId: string;
}

/** One guided access: a `connections` row with `kind = 'guided'`. */
export interface GuidedAccess {
  id: string;
  agentId: string;
  /** «x» plus the app's slug (`guidedProvider`). */
  provider: string;
  /** The user's name or the key's last four characters. */
  hint: string;
  status: 'ok' | 'failing';
  settings: GuidedSettings;
}

/**
 * The database as guided accesses need it (service role). Reads only for now;
 * finishing a guide adds `createAccess`, removing an access `removeAccess`.
 */
export interface GuidedStore {
  /** The organisation's guided accesses; only one agent's when `agentId` is given. */
  accesses(orgId: string, agentId?: string): Promise<GuidedAccess[]>;
}

/** What the vault keeps under `guidedSecretName`. */
export interface GuidedSecret {
  username?: string;
  password?: string;
  token?: string;
  key?: string;
}

/** What the person typed on the guide's screen, sent with the check. */
export type CheckValues = Partial<Record<GuideField, string>>;

export type CheckResult = { ok: true } | { ok: false; field?: GuideField; message: string };

const UNREACHABLE = 'Esa dirección no se abre desde internet';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * An address that names a machine inside a network rather than on the
 * internet: localhost, or an IP that is not public. A name that only resolves
 * to one is refused by fetchPublic when it connects.
 */
function pointsInside(typed: string): boolean {
  const t = typed.trim();
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`).hostname;
  } catch {
    return false;
  }
  host = host.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  return isIP(host) !== 0 && !isPublicAddress(host);
}

/**
 * A URL under `base` for a path the model or the landing gave, with its query.
 * Throws ToolError (for the model) when the path could leave the base: a
 * scheme, `..`, a leading `//`, a backslash, an encoded dot or slash, a
 * fragment or whitespace. The parsed result is checked again against the base.
 */
export function underBase(base: string, path: unknown, query?: unknown): URL {
  const root = new URL(base);
  if (root.protocol !== 'https:') throw new ToolError('La dirección del acceso no es https.');
  const rootPath = root.pathname.replace(/\/+$/, '');
  const refuse = () =>
    new ToolError(`path tiene que ser una ruta bajo ${root.origin}${rootPath}, empezando por /, sin «..», «//», «://», «\\» ni «#». Los parámetros pueden ir en query.`);
  if (
    typeof path !== 'string' ||
    path.length > 1000 ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('://') ||
    path.includes('..') ||
    /[\\#\s\x00-\x1f]/.test(path) ||
    /%(2e|2f|5c)/i.test(path)
  ) {
    throw refuse();
  }
  const at = path.indexOf('?');
  const pathPart = at === -1 ? path : path.slice(0, at);
  const url = new URL(`${root.origin}${rootPath}${pathPart}`);
  if (at !== -1) url.search = path.slice(at + 1);
  if (url.origin !== root.origin || !(url.pathname === rootPath || url.pathname.startsWith(`${rootPath}/`))) throw refuse();
  if (query !== undefined && query !== null) {
    if (!isRecord(query)) throw new ToolError('query tiene que ser un objeto de parámetros.');
    const plain = (v: unknown): v is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof v);
    for (const [k, v] of Object.entries(query)) {
      if (plain(v)) url.searchParams.append(k, String(v));
      else if (Array.isArray(v) && v.every(plain)) for (const item of v) url.searchParams.append(k, String(item));
      else throw new ToolError(`query.${k} tiene que ser un texto, un número o una lista de ellos.`);
    }
  }
  return url;
}

/**
 * The credential the check's values carry for `auth`, as the vault keeps it,
 * or the field that is missing. Only the fields `auth` allows are kept.
 */
export function secretFrom(auth: GuideAuth, values: CheckValues): { secret: GuidedSecret } | { field: GuideField; message: string } {
  const value = (f: GuideField) => (typeof values[f] === 'string' ? (values[f] as string).trim() : '');
  const bad = (v: string) => /[\r\n\x00]/.test(v);
  switch (auth) {
    case 'basic': {
      const username = value('username');
      const password = value('password');
      if (!username) return { field: 'username', message: 'Falta el usuario' };
      if (username.includes(':') || bad(username)) return { field: 'username', message: 'Ese usuario no es válido' };
      if (!password) return { field: 'password', message: 'Falta la contraseña' };
      if (bad(password)) return { field: 'password', message: 'Esa contraseña no es válida' };
      return { secret: { username, password } };
    }
    case 'bearer': {
      const token = value('token');
      if (!token) return { field: 'token', message: 'Falta el token' };
      if (bad(token)) return { field: 'token', message: 'Ese token no es válido' };
      return { secret: { token } };
    }
    case 'header': {
      const key = value('key');
      if (!key) return { field: 'key', message: 'Falta la clave' };
      if (bad(key)) return { field: 'key', message: 'Esa clave no es válida' };
      return { secret: { key } };
    }
  }
}

/** The headers that sign a request with the credential. */
function authHeaders(auth: GuideAuth, headerName: string | undefined, secret: GuidedSecret): Record<string, string> {
  switch (auth) {
    case 'basic':
      return { Authorization: `Basic ${Buffer.from(`${secret.username ?? ''}:${secret.password ?? ''}`, 'utf8').toString('base64')}` };
    case 'bearer':
      return { Authorization: `Bearer ${secret.token ?? ''}` };
    case 'header':
      return headerName ? { [headerName]: secret.key ?? '' } : {};
  }
}

/** Every form of the credential that could come back in an answer, longest first. */
function secretForms(auth: GuideAuth, headerName: string | undefined, secret: GuidedSecret): string[] {
  const raw = [secret.password, secret.token, secret.key, ...Object.values(authHeaders(auth, headerName, secret))];
  const forms = raw.flatMap((v) => (v ? [v, v.replace(/\s+/g, ''), v.replace(/^(Basic|Bearer) /, '')] : []));
  return [...new Set(forms)].filter((v) => v.length >= 4).sort((a, b) => b.length - a.length);
}

function redact(text: string, forms: string[]): string {
  let out = text;
  for (const f of forms) out = out.split(f).join('•••');
  return out;
}

/** The body as text, reading no more than `max` bytes of it. */
async function readCapped(res: Response, max = READ_LIMIT): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  if (size >= max) await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, max));
}

const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase('es') + s.slice(1);

/** Whether a top-level JSON field includes the expected value: an element of a list, or the text itself (case aside). */
function includes(value: unknown, expected: string): boolean {
  const same = (v: unknown) => typeof v === 'string' && v.toLocaleLowerCase('es') === expected.toLocaleLowerCase('es');
  return Array.isArray(value) ? value.some(same) : same(value);
}

/**
 * Tries the credential the person typed against the app: a GET to the
 * landing's check path under the address they gave, through `f` (fetchPublic
 * in the engine) within 15 seconds. The message is shown to the person, next
 * to `field` when one caused it. `app` names the app in the messages («WordPress»).
 */
export async function checkLanding(landing: GuideLanding, values: CheckValues, f: typeof fetch, app?: string): Promise<CheckResult> {
  const fail = (message: string, field?: GuideField): CheckResult => (field ? { ok: false, field, message } : { ok: false, message });
  const typed = typeof values.base_url === 'string' ? values.base_url : '';
  if (pointsInside(typed)) return fail(UNREACHABLE, 'base_url');
  const base = normaliseBase(typed, landing.suffix ?? '');
  if ('error' in base) return fail(base.error, 'base_url');
  const got = secretFrom(landing.auth, values);
  if ('field' in got) return fail(got.message, got.field);
  let url: URL;
  try {
    url = underBase(base.base, landing.check.path);
  } catch {
    return fail('La guía tiene mal la comprobación: pídele al agente que empiece otra');
  }
  // Who the credential belongs to: the field to point at when the app says it may not.
  const who: GuideField = landing.auth === 'basic' ? 'username' : landing.auth === 'bearer' ? 'token' : 'key';
  const secretField: GuideField = landing.auth === 'basic' ? 'password' : who;
  let res: Response;
  try {
    res = await timedFetch(f, CHECK_TIMEOUT_MS)(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeaders(landing.auth, landing.header, got.secret) },
      redirect: 'manual',
    });
  } catch {
    return fail(UNREACHABLE, 'base_url');
  }
  const body = res.ok && landing.check.expect ? await readCapped(res).catch(() => '') : (await res.body?.cancel().catch(() => {}), '');
  if (res.status === 401) {
    const message =
      landing.auth === 'basic' ? 'Esa contraseña no vale: tiene que ser la de aplicación' : landing.auth === 'bearer' ? 'Ese token no vale' : 'Esa clave no vale';
    return fail(message, secretField);
  }
  if (res.status === 403) {
    const message =
      landing.auth === 'basic'
        ? 'Ese usuario no tiene permiso para esto'
        : landing.auth === 'bearer'
          ? 'Ese token no tiene permiso para esto'
          : 'Esa clave no tiene permiso para esto';
    return fail(message, who);
  }
  const notFound = `No encuentro tu ${app ?? 'aplicación'} en esa dirección`;
  if (res.status === 404) return fail(notFound, 'base_url');
  if (res.status >= 300 && res.status < 400) return fail('Esa dirección lleva a otra: escribe la que ves en el navegador', 'base_url');
  if (!res.ok) return fail(`${app ?? 'La aplicación'} ha contestado con un error (${res.status}). Prueba otra vez en un momento.`);
  const expect = landing.check.expect;
  if (!expect) return { ok: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail(notFound, 'base_url');
  }
  if (!isRecord(parsed)) return fail(notFound, 'base_url');
  if (includes(parsed[expect.field], expect.includes)) return { ok: true };
  const message = /^roles?$/i.test(expect.field) ? `El usuario no tiene el rol ${capitalise(expect.includes)}` : `Ese acceso no tiene ${expect.includes}`;
  return fail(message, who);
}

/** The method the model asked for, normalised; null when it is not one the tool takes. Reads and runs agree through it. */
function methodOf(input: unknown): Method | null {
  const m = isRecord(input) && typeof input.method === 'string' ? input.method.trim().toUpperCase() : '';
  return (METHODS as readonly string[]).includes(m) ? (m as Method) : null;
}

/** A request the tool may send, or a ToolError saying why not. */
function requestOf(access: GuidedAccess, input: unknown): { method: Method; url: URL; body?: string } {
  if (!isRecord(input)) throw new ToolError('La entrada de la herramienta tiene que ser un objeto.');
  const method = methodOf(input);
  if (!method) throw new ToolError(`method tiene que ser ${METHODS.join(', ')}.`);
  const url = underBase(access.settings.base, input.path, input.query);
  if (input.body === undefined || input.body === null) return { method, url };
  if (method === 'GET') throw new ToolError('Una petición GET no lleva body.');
  return { method, url, body: JSON.stringify(input.body) };
}

function requestSpec(name: string, access: GuidedAccess): ToolSpec {
  const { app, base } = access.settings;
  return {
    name,
    description:
      `Calls ${app}'s HTTP API at ${base}, signed as your own ${access.settings.auth === 'basic' ? 'user' : 'key'} there (the engine adds the credential; you never see it). ` +
      `path is relative to ${base} and starts with / (e.g. /wp/v2/posts for a WordPress at …/wp-json). ` +
      'GET reads and runs at once. POST, PUT, PATCH and DELETE change something, so they wait for an owner to approve them: say so, do not claim it is done. ' +
      'The answer is the HTTP status and the body, clipped when long.',
    input_schema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: [...METHODS] },
        path: { type: 'string', description: `A path under ${base}, starting with /.` },
        query: { type: 'object', description: 'Query parameters: text, numbers or lists of them.' },
        body: { description: 'For POST, PUT and PATCH: the JSON body.' },
      },
      required: ['method', 'path'],
    },
  };
}

/**
 * The tools of one agent's guided accesses: one `<provider>_request` each.
 * Only the agent the access belongs to gets it, whatever `agents.accounts`
 * says. The credential is read from the vault when a request runs, never
 * before, and never reaches the model.
 */
export async function guidedToolsFor(store: GuidedStore, vault: Vault, orgId: string, agentId: string, f: typeof fetch = fetchPublic): Promise<AgentTools> {
  const accesses = (await store.accesses(orgId, agentId)).filter((a) => a.agentId === agentId && a.status === 'ok');
  if (accesses.length === 0) return NO_TOOLS;
  const byName = new Map(accesses.map((a) => [`${a.provider}_request`, a]));
  const send = timedFetch(f, TOOL_CALL_TIMEOUT_MS);
  return {
    specs: [...byName].map(([name, a]) => requestSpec(name, a)),
    accounts: accesses.map((a) =>
      a.settings.auth === 'basic' && a.hint
        ? `${a.settings.app} en ${a.settings.base}, con tu propio usuario ${a.hint}`
        : `${a.settings.app} en ${a.settings.base}, con tu propia clave`,
    ),
    accountProviders: accesses.map((a) => a.provider),
    providerOf: (name) => byName.get(name)?.provider,
    stepFor: (name) => {
      const a = byName.get(name);
      return a ? `Usando ${a.settings.app}` : 'Trabajando';
    },
    // Only a GET reads; anything else, or a call without its input, counts as writing.
    writes: (name, input) => !byName.has(name) || methodOf(input) !== 'GET',
    actionFor: (name) => {
      const a = byName.get(name);
      return a ? `Cambiar algo en ${a.settings.app}` : name;
    },
    async describe(name, input) {
      const a = byName.get(name);
      if (!a) return null;
      const { method, url } = requestOf(a, input);
      const path = `${url.pathname.slice(new URL(a.settings.base).pathname.replace(/\/+$/, '').length)}${url.search}`;
      const i = input as Record<string, unknown>;
      return { label: `${a.settings.app}: ${method} ${path}`, preview: previewOf({ ...(i.body === undefined ? {} : { body: i.body }) }) };
    },
    async run(name, input) {
      const a = byName.get(name);
      if (!a) return { content: `No existe la herramienta ${name}.`, isError: true };
      const { app, auth, headerName, guideId } = a.settings;
      let req: ReturnType<typeof requestOf>;
      try {
        req = requestOf(a, input);
      } catch (e) {
        return { content: e instanceof ToolError ? e.message : 'La petición no es válida.', isError: true };
      }
      const raw = await vault.get(guidedSecretName(orgId, guideId));
      if (!raw) return { content: `El acceso a ${app} ya no está guardado: quien es propietario tiene que volver a darlo.`, isError: true };
      const secret = JSON.parse(raw) as GuidedSecret;
      const forms = secretForms(auth, headerName, secret);
      let res: Response;
      try {
        res = await send(req.url.toString(), {
          method: req.method,
          headers: {
            Accept: 'application/json',
            ...(req.body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...authHeaders(auth, headerName, secret),
          },
          ...(req.body === undefined ? {} : { body: req.body }),
          redirect: 'manual',
        });
      } catch {
        return { content: `No he podido llegar a ${app}, o ha tardado demasiado. Prueba otra vez en un momento.`, isError: true };
      }
      const text = await readCapped(res).catch(() => '');
      const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      const head = location ? `HTTP ${res.status}, redirige a ${location} (no sigo redirecciones)` : `HTTP ${res.status}`;
      return { content: clip(redact(text ? `${head}\n${text}` : head, forms)), isError: !res.ok };
    },
  };
}

interface GuidedRow {
  id: string;
  agent_id: string;
  provider: string;
  hint: string | null;
  status: 'ok' | 'failing';
  settings: Record<string, unknown> | null;
}

/** A row as an access, or null when its settings are not a guided access's (never handed to a tool). */
function accessFromRow(r: GuidedRow): GuidedAccess | null {
  const s = r.settings ?? {};
  const auth = s.auth;
  if (typeof s.base !== 'string' || !s.base.startsWith('https://')) return null;
  if (auth !== 'basic' && auth !== 'bearer' && auth !== 'header') return null;
  if (typeof s.app !== 'string' || typeof s.guideId !== 'string') return null;
  if (auth === 'header' && typeof s.headerName !== 'string') return null;
  const settings: GuidedSettings = { base: s.base, auth, app: s.app, guideId: s.guideId };
  if (auth === 'header') settings.headerName = s.headerName as string;
  return { id: r.id, agentId: r.agent_id, provider: r.provider, hint: r.hint ?? '', status: r.status, settings };
}

/** The GuidedStore over Supabase with the service role. */
export function supabaseGuidedStore(admin: SupabaseClient): GuidedStore {
  return {
    async accesses(orgId, agentId) {
      let q = admin.from('connections').select('id, agent_id, provider, hint, status, settings').eq('org_id', orgId).eq('kind', 'guided');
      if (agentId) q = q.eq('agent_id', agentId);
      const { data, error } = await q.returns<GuidedRow[]>();
      if (error) throw error;
      return (data ?? []).map(accessFromRow).filter((a): a is GuidedAccess => a !== null);
    },
  };
}
