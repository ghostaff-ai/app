// TikTok (docs/plans/ongoing/connectors.md, phase 2, kind A): our own TikTok
// app, Login Kit and the Content Posting API. Until TikTok's audit passes, a
// post can only be private (TikTok offers SELF_ONLY alone, and only to five
// accounts a day); the tool says so instead of failing silently.
//
// The engine uploads the video itself (FILE_UPLOAD), so no domain has to be
// verified with TikTok. That means the engine fetches a URL the model gives:
// only public https hosts, never an IP, localhost or an internal name, and
// never more than MAX_VIDEO_BYTES. The name check is the first line; the
// download goes through fetchPublic, which also refuses a public name whose
// addresses are private, at the moment it connects (publicFetch.ts).

import type { AccountGrant, OAuthProvider } from './accounts';
import { AccountGone, randomToken } from './accounts';
import { fetchPublic } from './publicFetch';
import { clip, type Tool, type ToolContext, ToolError } from './tools';

export const TIKTOK_SCOPES = {
  basic: 'user.info.basic',
  stats: 'user.info.stats',
  list: 'video.list',
  publish: 'video.publish',
} as const;

const API = 'https://open.tiktokapis.com/v2';
export const MAX_VIDEO_BYTES = 120 * 1024 * 1024;
const MB = 1024 * 1024;

export interface TikTokApp {
  clientKey: string;
  clientSecret: string;
}

type Fetch = typeof fetch;

async function tokenRequest(f: Fetch, form: Record<string, string>) {
  const res = await f(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (json.error === 'invalid_grant') throw new AccountGone('tiktok');
  if (!res.ok || typeof json.access_token !== 'string') throw new Error(`tiktok token endpoint: ${json.error ?? res.status}`);
  return json;
}

export function tiktokOAuth(app: TikTokApp, f: Fetch = fetch): OAuthProvider {
  const scopes = Object.values(TIKTOK_SCOPES);
  return {
    id: 'tiktok',
    method: 'oauth',
    usefulScopes: scopes,
    async begin({ state, redirectUri }) {
      const q = new URLSearchParams({ client_key: app.clientKey, scope: scopes.join(','), response_type: 'code', redirect_uri: redirectUri, state });
      // A web app's code is swapped server side with our secret; TikTok asks PKCE only of mobile and desktop apps.
      return { url: `https://www.tiktok.com/v2/auth/authorize/?${q}`, codeVerifier: randomToken() };
    },
    async exchange({ code, redirectUri }): Promise<AccountGrant> {
      const t = await tokenRequest(f, {
        client_key: app.clientKey,
        client_secret: app.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      });
      return {
        refreshToken: t.refresh_token,
        accessToken: t.access_token,
        expiresIn: Number(t.expires_in ?? 86_400),
        scopes: String(t.scope ?? '').split(',').filter(Boolean),
      };
    },
    async refresh(refreshToken) {
      const t = await tokenRequest(f, { client_key: app.clientKey, client_secret: app.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken });
      return { accessToken: t.access_token, expiresIn: Number(t.expires_in ?? 86_400), refreshToken: t.refresh_token };
    },
    async identity(accessToken) {
      const res = await f(`${API}/user/info/?fields=display_name`, { headers: { Authorization: `Bearer ${accessToken}` } });
      const json = (await res.json().catch(() => ({}))) as { data?: { user?: { display_name?: string } } };
      return json.data?.user?.display_name ?? null;
    },
    async revoke(token) {
      await f(`${API}/oauth/revoke/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: app.clientKey, client_secret: app.clientSecret, token }).toString(),
      });
    },
  };
}

// ── Tools ────────────────────────────────────────────────────────────────────

async function tiktok(ctx: ToolContext, path: string, body?: unknown): Promise<Record<string, any>> {
  const res = await ctx.fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${ctx.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: Record<string, any>; error?: { code?: string; message?: string } };
  if (res.ok && (!json.error || json.error.code === 'ok')) return json.data ?? {};
  if (json.error?.code === 'access_token_invalid') throw new ToolError('TikTok ya no acepta nuestro permiso: hay que volver a conectar la cuenta en Conexiones.');
  if (json.error?.code === 'scope_not_authorized') throw new ToolError('Al conectar TikTok no se dio permiso para esto: vuelve a conectarlo y marca todas las casillas.');
  if (json.error?.code === 'spam_risk_too_many_posts') throw new ToolError('TikTok no deja publicar más hoy desde esta cuenta.');
  throw new ToolError(`TikTok no deja hacerlo: ${json.error?.message ?? json.error?.code ?? `error ${res.status}`}.`);
}

/** A public https URL the engine may fetch: no IPs, no localhost, no internal names. */
export function publicHttpsUrl(v: unknown): URL {
  let u: URL;
  try {
    u = new URL(typeof v === 'string' ? v.trim() : '');
  } catch {
    throw new ToolError('El vídeo tiene que ser una dirección https pública.');
  }
  const host = u.hostname.toLowerCase();
  const internal =
    u.protocol !== 'https:' ||
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    host.startsWith('[') ||
    host === 'localhost' ||
    /\.(internal|local|localhost)$/.test(host);
  if (internal) throw new ToolError('El vídeo tiene que ser una dirección https pública.');
  return u;
}

/** TikTok's chunk rules: one chunk up to 64 MB; otherwise 10 MB chunks, the last one taking the rest. */
export function chunking(size: number): { chunkSize: number; count: number } {
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

/**
 * Reads the video as it comes, counting: a server that sends no length, or
 * lies about it, cannot make the engine hold more than MAX_VIDEO_BYTES.
 */
async function download(ctx: ToolContext, url: URL): Promise<Uint8Array> {
  const res = await (ctx.fetchPublic ?? fetchPublic)(url, { redirect: 'error' });
  if (!res.ok || !res.body) throw new ToolError(`No se puede descargar el vídeo (${res.status}).`);
  const tooBig = () => new ToolError('El vídeo es demasiado grande: como mucho 120 MB.');
  if (Number(res.headers.get('content-length') ?? 0) > MAX_VIDEO_BYTES) throw tooBig();
  const parts: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_VIDEO_BYTES) {
      await reader.cancel().catch(() => {});
      throw tooBig();
    }
    parts.push(value);
  }
  if (size === 0) throw new ToolError('El vídeo está vacío.');
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return bytes;
}

export function tiktokTools(): Tool[] {
  const base = { provider: 'tiktok' as const };
  return [
    {
      ...base,
      scope: TIKTOK_SCOPES.stats,
      name: 'tiktok_account',
      description: 'Datos de la cuenta de TikTok conectada: nombre, seguidores, seguidos, me gusta y número de vídeos.',
      input_schema: { type: 'object', properties: {} },
      writes: false,
      step: 'Mirando tu TikTok',
      async run(ctx) {
        const data = await tiktok(ctx, '/user/info/?fields=open_id,display_name,follower_count,following_count,likes_count,video_count');
        return JSON.stringify(data.user ?? {});
      },
    },
    {
      ...base,
      scope: TIKTOK_SCOPES.list,
      name: 'tiktok_list_videos',
      description: 'Lista los últimos vídeos publicados, con su texto, fecha, enlace, visualizaciones, me gusta, comentarios y compartidos.',
      input_schema: { type: 'object', properties: { max: { type: 'integer', minimum: 1, maximum: 20, description: 'Cuántos (10 por defecto).' } } },
      writes: false,
      step: 'Mirando tus vídeos de TikTok',
      async run(ctx, input) {
        const max = Math.min(20, Math.max(1, Math.trunc(Number(input.max ?? 10)) || 10));
        const data = await tiktok(ctx, '/video/list/?fields=id,title,video_description,create_time,share_url,view_count,like_count,comment_count,share_count', {
          max_count: max,
        });
        return clip(JSON.stringify({ videos: data.videos ?? [] }));
      },
    },
    {
      ...base,
      scope: TIKTOK_SCOPES.publish,
      name: 'tiktok_publish_video',
      description:
        'Sube un vídeo a TikTok con su texto. Es público si la cuenta lo permite: úsala solo con un vídeo que la persona haya aprobado. ' +
        'El vídeo tiene que estar en una dirección https pública (mp4). Devuelve un `publish_id` para seguir el estado con tiktok_publish_status.',
      input_schema: {
        type: 'object',
        properties: {
          video: { type: 'string', description: 'La dirección https del vídeo.' },
          caption: { type: 'string', description: 'El texto del vídeo, con sus hashtags.' },
          privacy: {
            type: 'string',
            enum: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'],
            description: 'Quién lo ve. Por defecto, todo el mundo.',
          },
        },
        required: ['video'],
      },
      writes: true,
      step: 'Subiendo el vídeo a TikTok',
      action: 'Subir un vídeo a TikTok',
      editable: [{ field: 'caption', label: 'Texto', max: 2200, multiline: true }],
      async run(ctx, input) {
        const url = publicHttpsUrl(input.video);
        const privacy = typeof input.privacy === 'string' ? input.privacy : 'PUBLIC_TO_EVERYONE';
        const creator = await tiktok(ctx, '/post/publish/creator_info/query/', {});
        const options = (creator.privacy_level_options as string[] | undefined) ?? [];
        if (!options.includes(privacy)) {
          throw new ToolError(
            options.length === 1 && options[0] === 'SELF_ONLY'
              ? 'TikTok solo deja publicar en privado (SELF_ONLY) hasta que apruebe nuestra app. Puedes subirlo en privado.'
              : `TikTok no deja publicarlo así; opciones de esta cuenta: ${options.join(', ') || 'ninguna'}.`,
          );
        }
        const bytes = await download(ctx, url);
        const { chunkSize, count } = chunking(bytes.length);
        const init = await tiktok(ctx, '/post/publish/video/init/', {
          post_info: {
            title: typeof input.caption === 'string' ? input.caption.slice(0, 2200) : '',
            privacy_level: privacy,
            disable_comment: false,
            disable_duet: false,
            disable_stitch: false,
          },
          source_info: { source: 'FILE_UPLOAD', video_size: bytes.length, chunk_size: chunkSize, total_chunk_count: count },
        });
        const uploadUrl = String(init.upload_url ?? '');
        if (!uploadUrl.startsWith('https://')) throw new ToolError('TikTok no ha dado dónde subir el vídeo.');
        for (let i = 0; i < count; i++) {
          const start = i * chunkSize;
          const end = i === count - 1 ? bytes.length : start + chunkSize;
          const put = await ctx.fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end - 1}/${bytes.length}` },
            body: bytes.slice(start, end),
          });
          if (!put.ok) throw new ToolError(`La subida a TikTok ha fallado en el trozo ${i + 1} de ${count}.`);
        }
        return JSON.stringify({ uploaded: true, publish_id: init.publish_id, privacy });
      },
    },
    {
      ...base,
      scope: TIKTOK_SCOPES.publish,
      name: 'tiktok_publish_status',
      description: 'En qué punto está un vídeo subido con tiktok_publish_video: procesando, publicado o fallido, y por qué.',
      input_schema: { type: 'object', properties: { publish_id: { type: 'string' } }, required: ['publish_id'] },
      writes: false,
      step: 'Mirando cómo va el vídeo',
      async run(ctx, input) {
        const id = typeof input.publish_id === 'string' ? input.publish_id.trim() : '';
        if (!/^[A-Za-z0-9_.~-]{1,100}$/.test(id)) throw new ToolError('`publish_id` no es válido.');
        return JSON.stringify(await tiktok(ctx, '/post/publish/status/fetch/', { publish_id: id }));
      },
    },
  ];
}
