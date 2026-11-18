// Google, the first account connector (docs/plans/ongoing/connectors.md, kind
// B-app): our own OAuth client «Ghostaff Conectores» in ghostaff-prod, and the
// tools agents get from it. Google's own MCP servers for Calendar and Sheets are
// still a developer preview, so the tools call Google's stable REST APIs; they
// sit behind the same Tool shape an MCP-backed tool would.
//
// Scopes are the narrowest that do the job: calendar.events (sensitive, no
// security assessment) and drive.file, which reaches only files Ghostaff itself
// creates, never the rest of the person's Drive.

import type { AccountGrant, OAuthProvider } from './accounts';
import { AccountGone, codeChallenge, randomToken } from './accounts';
import { clip, type Tool, type ToolContext, ToolError } from './tools';

export const GOOGLE_SCOPES = {
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  driveFile: 'https://www.googleapis.com/auth/drive.file',
} as const;

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE = 'https://oauth2.googleapis.com/revoke';

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

type Fetch = typeof fetch;

async function tokenRequest(f: Fetch, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await f(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // invalid_grant: the person revoked us, or (in Testing) the grant is older than seven days.
  if (json.error === 'invalid_grant') throw new AccountGone('google');
  if (!res.ok) throw new Error(`google token endpoint answered ${res.status} ${String(json.error ?? '')}`);
  return json;
}

export const GOOGLE_REQUESTED_SCOPES = ['openid', 'email', GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.driveFile];

export function googleOAuth(client: GoogleClient, f: Fetch = fetch): OAuthProvider {
  return {
    id: 'google',
    method: 'oauth',
    usefulScopes: [GOOGLE_SCOPES.calendar, GOOGLE_SCOPES.driveFile],
    async begin({ state, redirectUri }) {
      const codeVerifier = randomToken();
      const q = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_REQUESTED_SCOPES.join(' '),
        // A refresh token, and asked again each time so a reconnect always yields one.
        access_type: 'offline',
        prompt: 'consent',
        state,
        code_challenge: codeChallenge(codeVerifier),
        code_challenge_method: 'S256',
      });
      return { url: `${AUTHORIZE}?${q}`, codeVerifier };
    },
    async exchange({ code, codeVerifier, redirectUri }): Promise<AccountGrant> {
      const t = await tokenRequest(f, {
        code,
        code_verifier: codeVerifier,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      });
      if (typeof t.refresh_token !== 'string' || typeof t.access_token !== 'string') {
        throw new Error('google gave no refresh token');
      }
      return {
        refreshToken: t.refresh_token,
        accessToken: t.access_token,
        expiresIn: Number(t.expires_in ?? 3600),
        scopes: String(t.scope ?? '').split(' ').filter(Boolean),
      };
    },
    async refresh(refreshToken) {
      const t = await tokenRequest(f, {
        refresh_token: refreshToken,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        grant_type: 'refresh_token',
      });
      if (typeof t.access_token !== 'string') throw new Error('google gave no access token');
      return { accessToken: t.access_token, expiresIn: Number(t.expires_in ?? 3600) };
    },
    async identity(accessToken) {
      const res = await f(USERINFO, { headers: { Authorization: `Bearer ${accessToken}` } });
      const json = (await res.json().catch(() => ({}))) as { email?: unknown };
      if (!res.ok || typeof json.email !== 'string') throw new Error(`google userinfo answered ${res.status}`);
      return json.email;
    },
    async revoke(token) {
      await f(REVOKE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      });
    },
  };
}

// ── Tools ────────────────────────────────────────────────────────────────────

async function google(ctx: ToolContext, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await ctx.fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (res.ok) return json;
  if (res.status === 401) throw new ToolError('Google no acepta nuestro permiso: hay que volver a conectar la cuenta en Conexiones.');
  if (res.status === 403) throw new ToolError(`Google no deja hacerlo: ${json.error?.message ?? 'sin permiso'}.`);
  if (res.status === 404) throw new ToolError('Google no encuentra eso.');
  if (res.status === 400) throw new ToolError(`Google rechaza la petición: ${json.error?.message ?? 'datos no válidos'}.`);
  throw new ToolError(`Google no responde bien ahora (${res.status}). Prueba en un momento.`);
}

const str = (v: unknown, max = 500): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** An RFC 3339 date-time with its offset, or a bare date for an all-day event. */
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function when(v: unknown, field: string): { dateTime: string } | { date: string } {
  const s = str(v, 40);
  if (s && DATE_TIME.test(s)) return { dateTime: s };
  if (s && DATE.test(s)) return { date: s };
  throw new ToolError(`${field} debe ser una fecha (2026-11-20) o una fecha y hora con zona (2026-11-20T10:00:00+01:00).`);
}

function timeBound(v: unknown, field: string, fallback: Date): string {
  if (v === undefined || v === null || v === '') return fallback.toISOString();
  const s = str(v, 40);
  if (!s || !DATE_TIME.test(s)) throw new ToolError(`${field} debe ser una fecha y hora con zona, como 2026-11-20T00:00:00+01:00.`);
  return s;
}

const DAY = 86_400_000;
const TIME_ZONE = 'Europe/Madrid';

export function googleTools(now: () => Date = () => new Date()): Tool[] {
  return [
    {
      name: 'google_calendar_list_events',
      description:
        'Lista los eventos del calendario principal de Google de la organización entre dos momentos (por defecto, los próximos 7 días). ' +
        'Úsala para saber qué hay en la agenda, buscar un hueco o encontrar una reunión. `query` busca por texto.',
      input_schema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Inicio, fecha y hora con zona (RFC 3339). Por defecto, ahora.' },
          to: { type: 'string', description: 'Fin, fecha y hora con zona (RFC 3339). Por defecto, 7 días después del inicio.' },
          query: { type: 'string', description: 'Texto a buscar en los eventos.' },
          max: { type: 'integer', minimum: 1, maximum: 100, description: 'Cuántos como mucho (25 por defecto).' },
        },
      },
      provider: 'google',
      scope: GOOGLE_SCOPES.calendar,
      writes: false,
      step: 'Mirando el calendario',
      async run(ctx, input) {
        const from = timeBound(input.from, 'from', now());
        const to = timeBound(input.to, 'to', new Date(Date.parse(from) + 7 * DAY));
        const max = Math.min(100, Math.max(1, Math.trunc(Number(input.max ?? 25)) || 25));
        const q = new URLSearchParams({ timeMin: from, timeMax: to, singleEvents: 'true', orderBy: 'startTime', maxResults: String(max) });
        const query = str(input.query, 200);
        if (query) q.set('q', query);
        const data = await google(ctx, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`);
        const items = (data.items as Array<Record<string, any>> | undefined) ?? [];
        const events = items.map((e) => ({
          title: e.summary ?? '(sin título)',
          start: e.start?.dateTime ?? e.start?.date,
          end: e.end?.dateTime ?? e.end?.date,
          location: e.location,
          attendees: Array.isArray(e.attendees) ? e.attendees.length : undefined,
          link: e.htmlLink,
        }));
        return clip(JSON.stringify({ timeZone: data.timeZone, from, to, events }));
      },
    },
    {
      name: 'google_calendar_create_event',
      description:
        'Crea un evento en el calendario principal de Google de la organización y devuelve su enlace. ' +
        'Úsala solo si la persona te ha pedido crear ese evento; si no, propónlo y pregunta.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título del evento.' },
          start: { type: 'string', description: 'Inicio: fecha y hora con zona (RFC 3339), o una fecha (AAAA-MM-DD) si dura todo el día.' },
          end: { type: 'string', description: 'Fin, en el mismo formato que el inicio. En uno de todo el día, el día siguiente al último.' },
          description: { type: 'string', description: 'Notas del evento.' },
          location: { type: 'string', description: 'Lugar.' },
        },
        required: ['title', 'start', 'end'],
      },
      provider: 'google',
      scope: GOOGLE_SCOPES.calendar,
      writes: true,
      step: 'Creando el evento en el calendario',
      async run(ctx, input) {
        const title = str(input.title, 300);
        if (!title) throw new ToolError('Falta el título del evento.');
        const start = when(input.start, 'start');
        const end = when(input.end, 'end');
        if ('date' in start !== 'date' in end) throw new ToolError('El inicio y el fin tienen que ser los dos fechas, o los dos fechas y horas.');
        const zone = (w: { dateTime: string } | { date: string }) => ('dateTime' in w ? { ...w, timeZone: TIME_ZONE } : w);
        const created = await google(ctx, 'https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          body: JSON.stringify({
            summary: title,
            description: str(input.description, 4000),
            location: str(input.location, 300),
            start: zone(start),
            end: zone(end),
          }),
        });
        return JSON.stringify({ created: true, title, link: created.htmlLink });
      },
    },
    {
      name: 'google_sheets_create',
      description:
        'Crea una hoja de cálculo nueva en el Google Drive de la organización con las filas que le des (la primera, los encabezados) y devuelve su enlace. ' +
        'Es la forma de entregar un Excel: desde la hoja se descarga como .xlsx (Archivo, Descargar, Microsoft Excel). ' +
        'Las fórmulas que empiecen por = se calculan.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Nombre del archivo.' },
          rows: {
            type: 'array',
            description: 'Filas de la hoja; cada fila, una lista de celdas (texto o número).',
            items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } },
          },
        },
        required: ['title', 'rows'],
      },
      provider: 'google',
      scope: GOOGLE_SCOPES.driveFile,
      writes: true,
      step: 'Creando la hoja de cálculo',
      async run(ctx, input) {
        const title = str(input.title, 200);
        if (!title) throw new ToolError('Falta el nombre de la hoja.');
        const rows = input.rows;
        if (!Array.isArray(rows) || rows.length === 0 || !rows.every(Array.isArray)) {
          throw new ToolError('`rows` debe ser una lista de filas, y cada fila una lista de celdas.');
        }
        if (rows.length > 10_000 || rows.some((r) => (r as unknown[]).length > 200)) {
          throw new ToolError('Demasiado grande: como mucho 10.000 filas de 200 columnas.');
        }
        const values = (rows as unknown[][]).map((r) => r.map((c) => (c === null || c === undefined ? '' : c)));
        const sheet = await google(ctx, 'https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          body: JSON.stringify({ properties: { title, locale: 'es_ES', timeZone: TIME_ZONE } }),
        });
        const id = String(sheet.spreadsheetId);
        await google(ctx, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}/values/A1?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          body: JSON.stringify({ values }),
        });
        return JSON.stringify({ created: true, title, rows: values.length, link: sheet.spreadsheetUrl });
      },
    },
  ];
}
