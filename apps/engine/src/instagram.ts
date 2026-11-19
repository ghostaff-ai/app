// Instagram (docs/plans/ongoing/connectors.md, phase 2, kind A): our own Meta
// app, through «Instagram API with Instagram Login», which needs a professional
// account and no Facebook page. Until Meta's App Review passes, only accounts
// with a role in our app can connect (Meta's development mode); that is enough
// for Órdago.
//
// Instagram has no refresh token: the long-lived token (60 days) is itself
// renewed, once it is a day old. The engine keeps it as both the access token
// and the "refresh" one and renews it in its last week (refreshWithin).
//
// Ids from the model are checked to be numeric before they reach a URL, and
// publishing takes only https media URLs.

import type { AccountGrant, OAuthProvider } from './accounts';
import { AccountGone, randomToken } from './accounts';
import { clip, type Tool, type ToolContext, ToolError } from './tools';

export const INSTAGRAM_SCOPES = {
  basic: 'instagram_business_basic',
  publish: 'instagram_business_content_publish',
  comments: 'instagram_business_manage_comments',
  insights: 'instagram_business_manage_insights',
} as const;

const GRAPH = 'https://graph.instagram.com/v23.0';
const DAY = 86_400_000;

export interface MetaApp {
  appId: string;
  appSecret: string;
}

type Fetch = typeof fetch;

async function graphJson(res: Response): Promise<Record<string, any>> {
  return (await res.json().catch(() => ({}))) as Record<string, any>;
}

/** Meta's code 190 is an invalid or expired token: only reconnecting fixes it. */
const isGone = (json: Record<string, any>) => json.error?.code === 190 || json.error?.type === 'OAuthException' && /expired|invalid/i.test(json.error?.message ?? '');

export function instagramOAuth(app: MetaApp, f: Fetch = fetch): OAuthProvider {
  const scopes = Object.values(INSTAGRAM_SCOPES);
  const longLived = async (shortToken: string) => {
    const q = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: app.appSecret, access_token: shortToken });
    const json = await graphJson(await f(`https://graph.instagram.com/access_token?${q}`));
    if (typeof json.access_token !== 'string') throw new Error(`instagram long-lived exchange failed: ${json.error?.message ?? 'no token'}`);
    return { token: json.access_token as string, expiresIn: Number(json.expires_in ?? 60 * 86_400) };
  };
  return {
    id: 'instagram',
    method: 'oauth',
    usefulScopes: scopes,
    refreshWithin: 7 * DAY,
    async begin({ state, redirectUri }) {
      const q = new URLSearchParams({
        client_id: app.appId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(','),
        state,
      });
      // Instagram takes no PKCE: the code is swapped with our app secret, server side, by the person who started.
      return { url: `https://www.instagram.com/oauth/authorize?${q}`, codeVerifier: randomToken() };
    },
    async exchange({ code, redirectUri }): Promise<AccountGrant> {
      const res = await f('https://api.instagram.com/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: app.appId,
          client_secret: app.appSecret,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
          code: code.replace(/#_$/, ''),
        }).toString(),
      });
      const json = await graphJson(res);
      const t = (Array.isArray(json.data) ? json.data[0] : json) as { access_token?: string; permissions?: string | string[] };
      if (!res.ok || typeof t?.access_token !== 'string') throw new Error(`instagram code exchange failed: ${json.error_message ?? json.error?.message ?? res.status}`);
      const granted = Array.isArray(t.permissions) ? t.permissions : String(t.permissions ?? '').split(',').filter(Boolean);
      const long = await longLived(t.access_token);
      return { refreshToken: long.token, accessToken: long.token, expiresIn: long.expiresIn, scopes: granted };
    },
    async refresh(token) {
      const q = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
      const json = await graphJson(await f(`https://graph.instagram.com/refresh_access_token?${q}`));
      if (typeof json.access_token === 'string') {
        return { accessToken: json.access_token, refreshToken: json.access_token, expiresIn: Number(json.expires_in ?? 60 * 86_400) };
      }
      if (isGone(json)) throw new AccountGone('instagram');
      throw new Error(`instagram refresh failed: ${json.error?.message ?? 'no token'}`);
    },
    async identity(accessToken) {
      const json = await graphJson(await f(`${GRAPH}/me?fields=username&access_token=${encodeURIComponent(accessToken)}`));
      return typeof json.username === 'string' ? `@${json.username}` : null;
    },
    // Instagram Login offers no revocation call: the person removes Ghostaff in Instagram's settings.
    async revoke() {},
  };
}

// ── Tools ────────────────────────────────────────────────────────────────────

async function graph(ctx: ToolContext, path: string, init: { method?: 'GET' | 'POST'; params?: Record<string, string> } = {}) {
  const params = new URLSearchParams({ ...(init.params ?? {}), access_token: ctx.accessToken });
  const method = init.method ?? 'GET';
  const res =
    method === 'GET'
      ? await ctx.fetch(`${GRAPH}${path}?${params}`)
      : await ctx.fetch(`${GRAPH}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
  const json = await graphJson(res);
  if (res.ok && !json.error) return json;
  if (isGone(json)) throw new ToolError('Instagram ya no acepta nuestro permiso: hay que volver a conectar la cuenta en Conexiones.');
  throw new ToolError(`Instagram no deja hacerlo: ${json.error?.error_user_msg ?? json.error?.message ?? `error ${res.status}`}.`);
}

const id = (v: unknown, what: string): string => {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
  if (!/^\d{1,30}$/.test(s)) throw new ToolError(`${what} debe ser el número que da Instagram.`);
  return s;
};

const httpsUrl = (v: unknown): string => {
  const s = typeof v === 'string' ? v.trim() : '';
  try {
    if (new URL(s).protocol === 'https:') return s;
  } catch {}
  throw new ToolError('Cada archivo tiene que ser una dirección https pública (Instagram lo descarga de ahí).');
};

const isVideo = (url: string) => /\.(mp4|mov)(\?|$)/i.test(url);

export interface InstagramToolOptions {
  /** Waits between checks of a container that is still processing (tests pass 0). */
  pollMs?: number;
  /** How many checks before giving up on a video still processing. */
  polls?: number;
}

export function instagramTools(opts: InstagramToolOptions = {}): Tool[] {
  const pollMs = opts.pollMs ?? 3000;
  const polls = opts.polls ?? 40;
  const base = { provider: 'instagram' as const };

  /** Waits for Instagram to finish processing a container before it may be published. */
  const ready = async (ctx: ToolContext, container: string) => {
    for (let i = 0; i < polls; i++) {
      const s = await graph(ctx, `/${container}`, { params: { fields: 'status_code,status' } });
      if (s.status_code === 'FINISHED') return;
      if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED') throw new ToolError(`Instagram no ha podido procesar el archivo: ${s.status ?? s.status_code}.`);
      if (pollMs) await new Promise((r) => setTimeout(r, pollMs));
    }
    throw new ToolError('Instagram sigue procesando el vídeo. Prueba a publicar otra vez en unos minutos.');
  };

  return [
    {
      ...base,
      scope: INSTAGRAM_SCOPES.basic,
      name: 'instagram_account',
      description: 'Datos de la cuenta de Instagram conectada: usuario, seguidores, seguidos y número de publicaciones.',
      input_schema: { type: 'object', properties: {} },
      writes: false,
      step: 'Mirando tu Instagram',
      async run(ctx) {
        return JSON.stringify(await graph(ctx, '/me', { params: { fields: 'user_id,username,name,account_type,followers_count,follows_count,media_count' } }));
      },
    },
    {
      ...base,
      scope: INSTAGRAM_SCOPES.basic,
      name: 'instagram_list_media',
      description: 'Lista las últimas publicaciones de la cuenta, con su texto, tipo, enlace, fecha, me gusta y comentarios. Da el `id` que piden las demás herramientas.',
      input_schema: { type: 'object', properties: { max: { type: 'integer', minimum: 1, maximum: 50, description: 'Cuántas (12 por defecto).' } } },
      writes: false,
      step: 'Mirando tus publicaciones',
      async run(ctx, input) {
        const max = Math.min(50, Math.max(1, Math.trunc(Number(input.max ?? 12)) || 12));
        const json = await graph(ctx, '/me/media', {
          params: { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count', limit: String(max) },
        });
        return clip(JSON.stringify({ media: json.data ?? [] }));
      },
    },
    {
      ...base,
      scope: INSTAGRAM_SCOPES.insights,
      name: 'instagram_media_insights',
      description: 'Estadísticas de una publicación: alcance, visualizaciones, me gusta, comentarios, guardados y compartidos.',
      input_schema: { type: 'object', properties: { media: { type: 'string', description: 'El id de la publicación.' } }, required: ['media'] },
      writes: false,
      step: 'Mirando las estadísticas',
      async run(ctx, input) {
        const json = await graph(ctx, `/${id(input.media, '`media`')}/insights`, { params: { metric: 'reach,views,likes,comments,saved,shares' } });
        const metrics = ((json.data as Array<{ name: string; values?: Array<{ value: number }> }> | undefined) ?? []).map((m) => [m.name, m.values?.[0]?.value]);
        return JSON.stringify(Object.fromEntries(metrics));
      },
    },
    {
      ...base,
      scope: INSTAGRAM_SCOPES.comments,
      name: 'instagram_list_comments',
      description: 'Lista los comentarios de una publicación, con sus respuestas y si están ocultos.',
      input_schema: {
        type: 'object',
        properties: { media: { type: 'string', description: 'El id de la publicación.' }, max: { type: 'integer', minimum: 1, maximum: 50 } },
        required: ['media'],
      },
      writes: false,
      step: 'Leyendo los comentarios',
      async run(ctx, input) {
        const max = Math.min(50, Math.max(1, Math.trunc(Number(input.max ?? 25)) || 25));
        const json = await graph(ctx, `/${id(input.media, '`media`')}/comments`, {
          params: { fields: 'id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp}', limit: String(max) },
        });
        return clip(JSON.stringify({ comments: json.data ?? [] }));
      },
    },
    {
      ...base,
      scope: INSTAGRAM_SCOPES.comments,
      name: 'instagram_reply_comment',
      description: 'Contesta en público a un comentario. Usa el tono aprobado de la organización y solo un texto que la persona haya aprobado o que entre en lo que ya se aprobó.',
      input_schema: {
        type: 'object',
        properties: { comment: { type: 'string', description: 'El id del comentario.' }, message: { type: 'string', description: 'La respuesta, tal como se publicará.' } },
        required: ['comment', 'message'],
      },
      writes: true,
      step: 'Contestando el comentario',
      action: 'Contestar en público a un comentario de Instagram',
      async run(ctx, input) {
        const message = typeof input.message === 'string' ? input.message.trim().slice(0, 2200) : '';
        if (!message) throw new ToolError('Falta el texto de la respuesta.');
        const json = await graph(ctx, `/${id(input.comment, '`comment`')}/replies`, { method: 'POST', params: { message } });
        return JSON.stringify({ replied: true, id: json.id });
      },
    },
    {
      ...base,
      scope: INSTAGRAM_SCOPES.comments,
      name: 'instagram_hide_comment',
      description: 'Oculta (o vuelve a mostrar) un comentario: para el spam y los insultos. No lo borra.',
      input_schema: {
        type: 'object',
        properties: { comment: { type: 'string', description: 'El id del comentario.' }, hide: { type: 'boolean', description: 'true para ocultarlo, false para mostrarlo.' } },
        required: ['comment', 'hide'],
      },
      writes: true,
      step: 'Ocultando el comentario',
      action: 'Ocultar (o mostrar) un comentario de Instagram',
      async run(ctx, input) {
        await graph(ctx, `/${id(input.comment, '`comment`')}`, { method: 'POST', params: { hide: input.hide === false ? 'false' : 'true' } });
        return JSON.stringify({ hidden: input.hide !== false });
      },
    },
    {
      ...base,
      scope: INSTAGRAM_SCOPES.publish,
      name: 'instagram_publish',
      description:
        'Publica en Instagram una foto, un reel o un carrusel (2 a 10 archivos) con su texto. Es público: úsala solo con una pieza que la persona haya aprobado. ' +
        'Los archivos tienen que estar en direcciones https públicas; los vídeos, en .mp4 o .mov.',
      input_schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['image', 'reel', 'carousel'], description: 'Qué se publica.' },
          media: { type: 'array', items: { type: 'string' }, description: 'Las direcciones https de los archivos, en orden.' },
          caption: { type: 'string', description: 'El texto de la publicación.' },
        },
        required: ['kind', 'media'],
      },
      writes: true,
      step: 'Publicando en Instagram',
      action: 'Publicar en Instagram',
      async run(ctx, input) {
        const urls = Array.isArray(input.media) ? input.media.map(httpsUrl) : [];
        const caption = typeof input.caption === 'string' ? input.caption.slice(0, 2200) : '';
        let container: string;
        if (input.kind === 'image' && urls.length === 1) {
          container = (await graph(ctx, '/me/media', { method: 'POST', params: { image_url: urls[0] as string, caption } })).id;
        } else if (input.kind === 'reel' && urls.length === 1) {
          container = (await graph(ctx, '/me/media', { method: 'POST', params: { media_type: 'REELS', video_url: urls[0] as string, caption } })).id;
        } else if (input.kind === 'carousel' && urls.length >= 2 && urls.length <= 10) {
          const children: string[] = [];
          for (const url of urls) {
            const params: Record<string, string> = isVideo(url) ? { media_type: 'VIDEO', video_url: url, is_carousel_item: 'true' } : { image_url: url, is_carousel_item: 'true' };
            const child = (await graph(ctx, '/me/media', { method: 'POST', params })).id as string;
            await ready(ctx, child);
            children.push(child);
          }
          container = (await graph(ctx, '/me/media', { method: 'POST', params: { media_type: 'CAROUSEL', children: children.join(','), caption } })).id;
        } else {
          throw new ToolError('Una foto o un reel llevan un archivo; un carrusel, de 2 a 10.');
        }
        await ready(ctx, container);
        const published = await graph(ctx, '/me/media_publish', { method: 'POST', params: { creation_id: container } });
        const link = await graph(ctx, `/${id(published.id, 'La publicación')}`, { params: { fields: 'permalink' } }).catch(() => ({}) as Record<string, any>);
        return JSON.stringify({ published: true, id: published.id, link: link.permalink });
      },
    },
  ];
}
