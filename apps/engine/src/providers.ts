// Checking an AI account before it is saved: one cheap call that costs nothing
// (listing models, or asking Google which permissions we hold), so a typo or a
// missing permission shows up when the owner connects, not when an agent runs.

import { VERTEX_EU_REGIONS } from '@ghostaff/shared';

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'no_access' | 'unavailable'; detail: string };

type Fetch = typeof fetch;

/** Looks like a key at all: one token, no spaces, a sane length. */
export function looksLikeKey(provider: 'anthropic' | 'openai', key: string): boolean {
  if (!/^[A-Za-z0-9_\-.]{20,400}$/.test(key)) return false;
  return provider === 'anthropic' ? key.startsWith('sk-ant-') : key.startsWith('sk-');
}

/** `sk-ant-…a1b2` → `a1b2`: all the app ever shows of a key. */
export const keyHint = (key: string) => key.slice(-4);

function fromStatus(status: number, detail: string): CheckResult {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 401) return { ok: false, reason: 'invalid', detail };
  if (status === 403) return { ok: false, reason: 'no_access', detail };
  return { ok: false, reason: 'unavailable', detail };
}

async function probe(f: Fetch, url: string, headers: Record<string, string>): Promise<CheckResult> {
  try {
    const res = await f(url, { headers });
    return fromStatus(res.status, res.ok ? '' : await res.text().catch(() => ''));
  } catch (e) {
    return { ok: false, reason: 'unavailable', detail: e instanceof Error ? e.message : String(e) };
  }
}

export function checkAnthropicKey(key: string, f: Fetch = fetch): Promise<CheckResult> {
  return probe(f, 'https://api.anthropic.com/v1/models?limit=1', {
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
  });
}

export function checkOpenAiKey(key: string, f: Fetch = fetch): Promise<CheckResult> {
  return probe(f, 'https://api.openai.com/v1/models', { Authorization: `Bearer ${key}` });
}

/** Google Cloud project IDs: 6–30 characters, lowercase letters, digits and hyphens. */
export const looksLikeProject = (p: string) => /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(p);
export const isEuRegion = (r: string) => (VERTEX_EU_REGIONS as readonly string[]).includes(r);

/** The permission an agent needs to call Claude on Vertex AI in the customer's project. */
export const VERTEX_PERMISSION = 'aiplatform.endpoints.predict';

/**
 * Asks Google whether our service account may call Vertex AI in the customer's
 * project. `request` is an authenticated Google API call (as the engine).
 */
export async function checkVertexProject(
  project: string,
  request: (url: string, body: unknown) => Promise<{ status: number; data: unknown }>,
): Promise<CheckResult> {
  try {
    const res = await request(`https://cloudresourcemanager.googleapis.com/v1/projects/${project}:testIamPermissions`, {
      permissions: [VERTEX_PERMISSION],
    });
    if (res.status !== 200) return fromStatus(res.status === 404 ? 403 : res.status, JSON.stringify(res.data));
    const granted = (res.data as { permissions?: string[] }).permissions ?? [];
    return granted.includes(VERTEX_PERMISSION)
      ? { ok: true }
      : { ok: false, reason: 'no_access', detail: `missing ${VERTEX_PERMISSION}` };
  } catch (e) {
    return { ok: false, reason: 'unavailable', detail: e instanceof Error ? e.message : String(e) };
  }
}
