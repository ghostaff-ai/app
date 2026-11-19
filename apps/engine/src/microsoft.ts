// Microsoft 365 (docs/plans/ongoing/connectors.md, kind B-app): our own app in
// Microsoft Entra, multitenant, for work and personal accounts, and the tools
// agents get from it over Microsoft Graph. Microsoft's own MCP servers (Work IQ)
// need a Copilot licence and an admin, which a small company does not have.
//
// Scopes a person can consent to alone, without their admin: their own mail,
// calendar and files. Never Mail.Send: an agent leaves drafts, a person sends.
// The tools never delete, and a new event has no attendees, so no invitation
// leaves without a person.

import type { AccountProvider } from '@ghostaff/shared';
import type { AccountGrant, OAuthProvider } from './accounts';
import { AccountGone, codeChallenge, randomToken } from './accounts';
import type { AppClient } from './apps';
import { str } from './google';
import { clip, type Tool, type ToolContext, ToolError } from './tools';

export const MICROSOFT_SCOPES = {
  mail: 'Mail.ReadWrite',
  calendar: 'Calendars.ReadWrite',
  files: 'Files.ReadWrite',
} as const;

const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const REQUESTED = ['openid', 'email', 'offline_access', 'User.Read', ...Object.values(MICROSOFT_SCOPES)];

type Fetch = typeof fetch;

/** Graph scopes come back as `https://graph.microsoft.com/Mail.ReadWrite` or bare; the tools name them bare. */
export const bareScope = (s: string) => s.replace(/^https:\/\/graph\.microsoft\.com\//i, '');

async function tokenRequest(f: Fetch, form: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await f(`${LOGIN}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // invalid_grant: revoked, expired after 90 idle days, or the person's admin removed us.
  if (json.error === 'invalid_grant' || json.error === 'interaction_required') throw new AccountGone('microsoft');
  if (!res.ok) throw new Error(`microsoft token endpoint answered ${res.status} ${String(json.error ?? '')}`);
  return json;
}

/** `app` reads our Entra app from the vault (apps.ts); until it is there, connecting answers «not available yet». */
export function microsoftOAuth(app: () => Promise<AppClient>, f: Fetch = fetch): OAuthProvider {
  const secretOf = async () => {
    const a = await app();
    return { client_id: a.clientId, ...(a.clientSecret ? { client_secret: a.clientSecret } : {}) };
  };
  return {
    id: 'microsoft' as AccountProvider,
    method: 'oauth',
    usefulScopes: Object.values(MICROSOFT_SCOPES),
    async begin({ state, redirectUri }) {
      const { clientId } = await app();
      const codeVerifier = randomToken();
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        response_mode: 'query',
        scope: REQUESTED.join(' '),
        // Lets the person pick the account, instead of silently taking the one the browser is signed into.
        prompt: 'select_account',
        state,
        code_challenge: codeChallenge(codeVerifier),
        code_challenge_method: 'S256',
      });
      return { url: `${LOGIN}/authorize?${q}`, codeVerifier };
    },
    async exchange({ code, codeVerifier, redirectUri }): Promise<AccountGrant> {
      const t = await tokenRequest(f, {
        ...(await secretOf()),
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: REQUESTED.join(' '),
      });
      if (typeof t.refresh_token !== 'string' || typeof t.access_token !== 'string') throw new Error('microsoft gave no refresh token');
      return {
        refreshToken: t.refresh_token,
        accessToken: t.access_token,
        expiresIn: Number(t.expires_in ?? 3600),
        scopes: String(t.scope ?? '').split(' ').filter(Boolean).map(bareScope),
      };
    },
    async refresh(refreshToken) {
      const t = await tokenRequest(f, {
        ...(await secretOf()),
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        scope: REQUESTED.join(' '),
      });
      if (typeof t.access_token !== 'string') throw new Error('microsoft gave no access token');
      // Microsoft rotates refresh tokens: the new one replaces the old.
      return {
        accessToken: t.access_token,
        expiresIn: Number(t.expires_in ?? 3600),
        ...(typeof t.refresh_token === 'string' ? { refreshToken: t.refresh_token } : {}),
      };
    },
    async identity(accessToken) {
      const res = await f(`${GRAPH}/me?$select=mail,userPrincipalName`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const json = (await res.json().catch(() => ({}))) as { mail?: unknown; userPrincipalName?: unknown };
      if (!res.ok) throw new Error(`microsoft /me answered ${res.status}`);
      const email = typeof json.mail === 'string' && json.mail ? json.mail : json.userPrincipalName;
      return typeof email === 'string' ? email : null;
    },
    // Microsoft has no per-token revocation for apps; the token leaves the vault, and the person can remove
    // Ghostaff at myapps.microsoft.com (work) or account.live.com/consent (personal).
    async revoke() {},
  };
}

// ── Tools ────────────────────────────────────────────────────────────────────

const TIME_ZONE = 'Europe/Madrid';

/** A Graph call with the run's token; Microsoft's refusals become words the agent can pass on. */
async function graph(ctx: ToolContext, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await ctx.fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: `outlook.timezone="${TIME_ZONE}", outlook.body-content-type="text"`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204) return {};
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (res.ok) return json;
  const why = json.error?.message ?? '';
  if (res.status === 401) throw new ToolError('Microsoft no acepta nuestro permiso: hay que volver a conectar la cuenta en Conexiones.');
  if (res.status === 403) throw new ToolError(`Microsoft no deja hacerlo${why ? `: ${why}` : ''}.`);
  if (res.status === 404) throw new ToolError('Microsoft no encuentra eso.');
  if (res.status === 400) throw new ToolError(`Microsoft rechaza la petición${why ? `: ${why}` : ''}.`);
  if (res.status === 429) throw new ToolError('Microsoft pide esperar un poco antes de seguir. Prueba en un minuto.');
  throw new ToolError(`Microsoft no responde bien ahora (${res.status}). Prueba en un momento.`);
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86_400_000;

function moment(v: unknown, field: string, fallback?: Date): Date {
  if ((v === undefined || v === null || v === '') && fallback) return fallback;
  const s = str(v, 40);
  if (!s || !DATE_TIME.test(s)) throw new ToolError(`${field} debe ser una fecha y hora con zona, como 2026-11-20T10:00:00+01:00.`);
  return new Date(s);
}

/** Graph's ids are opaque: one path segment, escaped. */
function id(v: unknown, what: string): string {
  const s = str(v, 2000);
  if (!s || !/^[A-Za-z0-9_\-=!+]+$/.test(s)) throw new ToolError(`Falta ${what}, o no es válido.`);
  return encodeURIComponent(s);
}

function emails(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out = list.map((e) => (typeof e === 'string' ? e.trim() : '')).filter(Boolean);
  if (out.length > 50) throw new ToolError('Demasiados destinatarios: como mucho 50.');
  for (const e of out) if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e)) throw new ToolError(`«${e.slice(0, 100)}» no es una dirección de correo.`);
  return out;
}

const max = (v: unknown, dflt: number, top: number) => Math.min(top, Math.max(1, Math.trunc(Number(v ?? dflt)) || dflt));

/** An Excel range address, A1 style, optionally with its sheet: no quotes or parentheses can reach the URL. */
const ADDRESS = /^([A-Za-z0-9 _.-]{1,31}!)?\$?[A-Z]{1,3}\$?\d{1,7}(:\$?[A-Z]{1,3}\$?\d{1,7})?$/;
/** A sheet or table name: letters, digits, spaces and a few marks; a quote is doubled by `quoted`. */
const NAME = /^[\p{L}\p{N} _.'-]{1,100}$/u;
const quoted = (s: string) => encodeURIComponent(s.replace(/'/g, "''"));

export function microsoftTools(now: () => Date = () => new Date()): Tool[] {
  return [
    {
      name: 'outlook_calendar_list_events',
      description:
        'Lista los eventos del calendario de Outlook (Microsoft 365) de la organización entre dos momentos (por defecto, los próximos 7 días). ' +
        'Úsala para ver la agenda, buscar un hueco o encontrar una reunión. `query` filtra por texto del título.',
      input_schema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Inicio, fecha y hora con zona (RFC 3339). Por defecto, ahora.' },
          to: { type: 'string', description: 'Fin, fecha y hora con zona. Por defecto, 7 días después del inicio.' },
          query: { type: 'string', description: 'Texto a buscar en el título.' },
          max: { type: 'integer', minimum: 1, maximum: 100, description: 'Cuántos como mucho (25 por defecto).' },
        },
      },
      provider: 'microsoft' as AccountProvider,
      scope: MICROSOFT_SCOPES.calendar,
      writes: false,
      step: 'Mirando el calendario de Outlook',
      async run(ctx, input) {
        const from = moment(input.from, 'from', now());
        const to = moment(input.to, 'to', new Date(from.getTime() + 7 * DAY));
        if (to <= from) throw new ToolError('`to` tiene que ser posterior a `from`.');
        const q = new URLSearchParams({
          startDateTime: from.toISOString(),
          endDateTime: to.toISOString(),
          $top: String(max(input.max, 25, 100)),
          $orderby: 'start/dateTime',
          $select: 'subject,start,end,location,isAllDay,attendees,webLink,organizer',
        });
        const data = await graph(ctx, `/me/calendarView?${q}`);
        const query = str(input.query, 200)?.toLowerCase();
        const events = ((data.value as Array<Record<string, any>> | undefined) ?? [])
          .filter((e) => !query || String(e.subject ?? '').toLowerCase().includes(query))
          .map((e) => ({
            title: e.subject || '(sin título)',
            start: e.start?.dateTime,
            end: e.end?.dateTime,
            allDay: e.isAllDay || undefined,
            location: e.location?.displayName || undefined,
            attendees: Array.isArray(e.attendees) && e.attendees.length ? e.attendees.length : undefined,
            link: e.webLink,
          }));
        return clip(JSON.stringify({ timeZone: TIME_ZONE, from: from.toISOString(), to: to.toISOString(), events }));
      },
    },
    {
      name: 'outlook_calendar_create_event',
      description:
        'Crea un evento en el calendario de Outlook de la organización, sin invitados (no envía invitaciones), y devuelve su enlace. ' +
        'Úsala solo si la persona te ha pedido crear ese evento; si no, propónlo y pregunta.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título del evento.' },
          start: { type: 'string', description: 'Inicio: fecha y hora con zona (RFC 3339), o una fecha (AAAA-MM-DD) si dura todo el día.' },
          end: { type: 'string', description: 'Fin, en el mismo formato. En uno de todo el día, el día siguiente al último.' },
          description: { type: 'string', description: 'Notas del evento.' },
          location: { type: 'string', description: 'Lugar.' },
        },
        required: ['title', 'start', 'end'],
      },
      provider: 'microsoft' as AccountProvider,
      scope: MICROSOFT_SCOPES.calendar,
      writes: true,
      step: 'Creando el evento en Outlook',
      action: 'Crear un evento en el calendario de Outlook',
      async run(ctx, input) {
        const title = str(input.title, 300);
        if (!title) throw new ToolError('Falta el título del evento.');
        const s = str(input.start, 40) ?? '';
        const e = str(input.end, 40) ?? '';
        let when: Record<string, unknown>;
        if (DATE.test(s) && DATE.test(e)) {
          if (e <= s) throw new ToolError('El fin de un evento de todo el día es el día siguiente al último, posterior al inicio.');
          when = { isAllDay: true, start: { dateTime: `${s}T00:00:00`, timeZone: TIME_ZONE }, end: { dateTime: `${e}T00:00:00`, timeZone: TIME_ZONE } };
        } else {
          const start = moment(s, 'start');
          const end = moment(e, 'end');
          if (end <= start) throw new ToolError('El fin tiene que ser posterior al inicio.');
          const utc = (d: Date) => ({ dateTime: d.toISOString().replace('Z', ''), timeZone: 'UTC' });
          when = { start: utc(start), end: utc(end) };
        }
        const description = str(input.description, 4000);
        const location = str(input.location, 300);
        const created = await graph(ctx, '/me/events', {
          method: 'POST',
          body: JSON.stringify({
            subject: title,
            ...when,
            ...(description ? { body: { contentType: 'text', content: description } } : {}),
            ...(location ? { location: { displayName: location } } : {}),
          }),
        });
        return JSON.stringify({ created: true, title, link: created.webLink });
      },
    },
    {
      name: 'outlook_mail_search',
      description:
        'Busca correos en el buzón de Outlook de la organización y devuelve los más recientes con remitente, asunto y un extracto. ' +
        'Sin `query`, los últimos recibidos. `query` acepta palabras y filtros de Outlook como from:ana@empresa.com o subject:factura.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Qué buscar.' },
          unread: { type: 'boolean', description: 'Solo los no leídos (sin `query`).' },
          max: { type: 'integer', minimum: 1, maximum: 50, description: 'Cuántos como mucho (15 por defecto).' },
        },
      },
      provider: 'microsoft' as AccountProvider,
      scope: MICROSOFT_SCOPES.mail,
      writes: false,
      step: 'Buscando en el correo',
      async run(ctx, input) {
        const q = new URLSearchParams({
          $top: String(max(input.max, 15, 50)),
          $select: 'id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments,webLink',
        });
        const query = str(input.query, 300);
        if (query) {
          // $search takes no ordering: Outlook returns by relevance and date.
          q.set('$search', `"${query.replace(/["\\]/g, ' ')}"`);
        } else {
          q.set('$orderby', 'receivedDateTime desc');
          if (input.unread === true) q.set('$filter', 'isRead eq false');
        }
        const data = await graph(ctx, `/me/messages?${q}`);
        const messages = ((data.value as Array<Record<string, any>> | undefined) ?? []).map((m) => ({
          id: m.id,
          from: m.from?.emailAddress?.address,
          fromName: m.from?.emailAddress?.name,
          subject: m.subject || '(sin asunto)',
          received: m.receivedDateTime,
          unread: m.isRead === false || undefined,
          attachments: m.hasAttachments || undefined,
          preview: typeof m.bodyPreview === 'string' ? m.bodyPreview.slice(0, 300) : undefined,
        }));
        return clip(JSON.stringify({ messages }));
      },
    },
    {
      name: 'outlook_mail_read',
      description: 'Lee un correo de Outlook entero (remitente, destinatarios, fecha y texto), por el `id` que da outlook_mail_search.',
      input_schema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'El id del correo.' } },
        required: ['id'],
      },
      provider: 'microsoft' as AccountProvider,
      scope: MICROSOFT_SCOPES.mail,
      writes: false,
      step: 'Leyendo el correo',
      async run(ctx, input) {
        const m = (await graph(
          ctx,
          `/me/messages/${id(input.id, 'el id del correo')}?$select=subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,webLink`,
        )) as Record<string, any>;
        const who = (list: unknown) =>
          Array.isArray(list) ? list.map((r: any) => r?.emailAddress?.address).filter(Boolean) : undefined;
        return clip(
          JSON.stringify({
            from: m.from?.emailAddress?.address,
            to: who(m.toRecipients),
            cc: who(m.ccRecipients),
            subject: m.subject,
            received: m.receivedDateTime,
            attachments: m.hasAttachments || undefined,
            text: m.body?.content,
          }),
        );
      },
    },
    {
      name: 'outlook_mail_create_draft',
      description:
        'Deja un borrador en la carpeta Borradores de Outlook: un correo nuevo, o la respuesta a uno (`replyTo`, el id del correo). ' +
        'No lo envía: la persona lo revisa y lo envía desde Outlook. Devuelve el enlace al borrador.',
      input_schema: {
        type: 'object',
        properties: {
          replyTo: { type: 'string', description: 'El id del correo al que responde, si es una respuesta.' },
          to: { type: 'array', items: { type: 'string' }, description: 'Destinatarios (en un correo nuevo).' },
          cc: { type: 'array', items: { type: 'string' }, description: 'En copia.' },
          subject: { type: 'string', description: 'Asunto (en un correo nuevo).' },
          text: { type: 'string', description: 'El texto del correo.' },
        },
        required: ['text'],
      },
      provider: 'microsoft' as AccountProvider,
      scope: MICROSOFT_SCOPES.mail,
      writes: true,
      step: 'Dejando el borrador en Outlook',
      action: 'Dejar un borrador en Outlook, sin enviarlo',
      async run(ctx, input) {
        const text = typeof input.text === 'string' ? input.text.trim() : '';
        if (!text) throw new ToolError('Falta el texto del correo.');
        if (text.length > 100_000) throw new ToolError('Demasiado largo: como mucho 100.000 caracteres.');
        const cc = emails(input.cc).map((address) => ({ emailAddress: { address } }));
        let draft: Record<string, unknown>;
        if (input.replyTo !== undefined && input.replyTo !== null && input.replyTo !== '') {
          draft = await graph(ctx, `/me/messages/${id(input.replyTo, 'el id del correo')}/createReply`, {
            method: 'POST',
            body: JSON.stringify({ comment: text, ...(cc.length ? { message: { ccRecipients: cc } } : {}) }),
          });
        } else {
          const to = emails(input.to);
          if (!to.length) throw new ToolError('Falta a quién va el correo (`to`).');
          const subject = str(input.subject, 300);
          if (!subject) throw new ToolError('Falta el asunto.');
          draft = await graph(ctx, '/me/messages', {
            method: 'POST',
            body: JSON.stringify({
              subject,
              body: { contentType: 'text', content: text },
              toRecipients: to.map((address) => ({ emailAddress: { address } })),
              ...(cc.length ? { ccRecipients: cc } : {}),
            }),
          });
        }
        return JSON.stringify({ draft: true, sent: false, link: draft.webLink });
      },
    },
    {
      name: 'onedrive_search',
      description:
        'Busca archivos en el OneDrive de la organización por nombre o contenido y devuelve nombre, tipo, fecha y enlace. ' +
        'El `id` de un Excel sirve para excel_read y excel_add_rows.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Qué buscar.' },
          max: { type: 'integer', minimum: 1, maximum: 50, description: 'Cuántos como mucho (20 por defecto).' },
        },
        required: ['query'],
      },
      provider: 'microsoft' as AccountProvider,
      scope: MICROSOFT_SCOPES.files,
      writes: false,
      step: 'Buscando en OneDrive',
      async run(ctx, input) {
        const query = str(input.query, 200);
        if (!query) throw new ToolError('Falta qué buscar.');
        const q = new URLSearchParams({ $top: String(max(input.max, 20, 50)), $select: 'id,name,webUrl,size,lastModifiedDateTime,file,folder' });
        const data = await graph(ctx, `/me/drive/root/search(q='${quoted(query)}')?${q}`);
        const files = ((data.value as Array<Record<string, any>> | undefined) ?? []).map((i) => ({
          id: i.id,
          name: i.name,
          kind: i.folder ? 'carpeta' : (i.file?.mimeType ?? 'archivo'),
          modified: i.lastModifiedDateTime,
          size: i.size,
          link: i.webUrl,
        }));
        return clip(JSON.stringify({ files }));
      },
    },
    {
      name: 'excel_read',
      description:
        'Lee un Excel de OneDrive por su `id` (de onedrive_search). Sin `sheet`, lista sus hojas y tablas. ' +
        'Con `sheet`, devuelve las celdas usadas de esa hoja, o el rango `range` (A1:F50) si lo das.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'El id del archivo.' },
          sheet: { type: 'string', description: 'El nombre de la hoja.' },
          range: { type: 'string', description: 'Un rango, como A1:F50.' },
        },
        required: ['id'],
      },
      provider: 'microsoft' as AccountProvider,
      scope: MICROSOFT_SCOPES.files,
      writes: false,
      step: 'Leyendo el Excel',
      async run(ctx, input) {
        const book = `/me/drive/items/${id(input.id, 'el id del archivo')}/workbook`;
        const sheet = str(input.sheet, 100);
        if (!sheet) {
          const [sheets, tables] = await Promise.all([graph(ctx, `${book}/worksheets?$select=name`), graph(ctx, `${book}/tables?$select=name`)]);
          const names = (d: Record<string, unknown>) => ((d.value as Array<{ name?: string }> | undefined) ?? []).map((x) => x.name);
          return JSON.stringify({ sheets: names(sheets), tables: names(tables) });
        }
        if (!NAME.test(sheet)) throw new ToolError('Ese nombre de hoja no es válido.');
        const range = str(input.range, 40);
        if (range && !ADDRESS.test(range)) throw new ToolError('`range` debe ser un rango como A1:F50.');
        const path = range
          ? `${book}/worksheets('${quoted(sheet)}')/range(address='${quoted(range)}')?$select=address,values`
          : `${book}/worksheets('${quoted(sheet)}')/usedRange(valuesOnly=true)?$select=address,values`;
        const data = await graph(ctx, path);
        return clip(JSON.stringify({ address: data.address, values: data.values }));
      },
    },
    {
      name: 'excel_add_rows',
      description:
        'Añade filas al final de una tabla de un Excel de OneDrive (las tablas las lista excel_read). Cada fila, una lista de celdas en el orden de las columnas de la tabla.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'El id del archivo.' },
          table: { type: 'string', description: 'El nombre de la tabla.' },
          rows: {
            type: 'array',
            description: 'Las filas; cada una, una lista de celdas (texto o número).',
            items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } },
          },
        },
        required: ['id', 'table', 'rows'],
      },
      provider: 'microsoft' as AccountProvider,
      scope: MICROSOFT_SCOPES.files,
      writes: true,
      step: 'Añadiendo filas al Excel',
      action: 'Añadir filas a un Excel de OneDrive',
      async run(ctx, input) {
        const table = str(input.table, 100);
        if (!table || !NAME.test(table)) throw new ToolError('Falta el nombre de la tabla, o no es válido.');
        const rows = input.rows;
        if (!Array.isArray(rows) || rows.length === 0 || !rows.every(Array.isArray)) {
          throw new ToolError('`rows` debe ser una lista de filas, y cada fila una lista de celdas.');
        }
        if (rows.length > 1000 || rows.some((r) => (r as unknown[]).length > 100)) throw new ToolError('Demasiado: como mucho 1.000 filas de 100 columnas.');
        const values = (rows as unknown[][]).map((r) => r.map((c) => (c === null || c === undefined ? '' : c)));
        await graph(ctx, `/me/drive/items/${id(input.id, 'el id del archivo')}/workbook/tables('${quoted(table)}')/rows`, {
          method: 'POST',
          body: JSON.stringify({ values }),
        });
        return JSON.stringify({ added: values.length, table });
      },
    },
  ];
}
