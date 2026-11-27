// A link's preview in the chat, as in WhatsApp (docs/plans/ready/
// chat-like-whatsapp.md, phase 4): its title, a line of description, the site
// and its image, read from the page's Open Graph tags. Only public pages
// (fetchPublic refuses inner addresses), the first 512 kB, 5 seconds at most,
// kept in memory a day. What a page says is shown, never followed.

import { Refusal } from './connections';
import { fetchPublic } from './publicFetch';

export interface LinkPreview {
  url: string;
  title: string | null;
  description: string | null;
  site: string;
  image: string | null;
}

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5000;
const DAY_MS = 86_400_000;
const CACHE_SIZE = 500;
const cache = new Map<string, { at: number; preview: LinkPreview }>();

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? (e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) || m : m));

/** The value of a page's meta tag by property or name, decoded and cut short. */
function meta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, 'i');
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content?.trim()) return decode(content.trim()).slice(0, 300);
  }
  return null;
}

/** What a page's head says about it. */
export function parsePreview(url: URL, html: string): LinkPreview {
  const title = meta(html, ['og:title', 'twitter:title']) ?? (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ? decode(html.match(/<title[^>]*>([^<]*)<\/title>/i)![1]!.trim()).slice(0, 300) : null);
  const image = meta(html, ['og:image', 'twitter:image']);
  let imageUrl: string | null = null;
  if (image) {
    try {
      const abs = new URL(image, url);
      imageUrl = abs.protocol === 'https:' ? abs.toString() : null;
    } catch {
      imageUrl = null;
    }
  }
  return {
    url: url.toString(),
    title: title || null,
    description: meta(html, ['og:description', 'description', 'twitter:description']),
    site: meta(html, ['og:site_name']) ?? url.hostname.replace(/^www\./, ''),
    image: imageUrl,
  };
}

export async function linkPreview(raw: unknown, fetcher: typeof fetch = fetchPublic, now = Date.now()): Promise<LinkPreview> {
  let url: URL;
  try {
    url = new URL(typeof raw === 'string' ? raw : '');
  } catch {
    throw new Refusal(400, 'bad_request', 'not a link');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Refusal(400, 'bad_request', 'only web links');
  const key = url.toString();
  const hit = cache.get(key);
  if (hit && now - hit.at < DAY_MS) return hit.preview;
  let html = '';
  try {
    const res = await fetcher(key, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'text/html', 'User-Agent': 'Mozilla/5.0 (compatible; GhostaffPreview/1.0)' }, redirect: 'follow' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html') || !res.body) throw new Error('not a page');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      html += decoder.decode(value, { stream: true });
      if (size > MAX_BYTES || /<\/head>/i.test(html)) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } catch {
    throw new Refusal(502, 'unavailable', 'the page could not be read');
  }
  const preview = parsePreview(url, html);
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: now, preview });
  return preview;
}
