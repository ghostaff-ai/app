// The record connector's GitHub side (docs/plans/ongoing/ordago-agents-in-ghostaff.md):
// our GitHub App «Ghostaff Registro», installed by an organisation on its record
// repo. The engine signs a ten-minute JWT with the App's key (Secret Manager,
// never in the database) and swaps it for a one-hour installation token limited
// to that one repo. Tokens are kept in memory until five minutes before expiry.

import { createSign } from 'node:crypto';

type Fetch = typeof fetch;

export const GITHUB_API = 'https://api.github.com';

export interface GithubAppConfig {
  appId: string;
  /** The App's private key, PEM. */
  privateKey: string;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** The App's own JWT (RS256), valid ten minutes, issued a minute in the past for clock drift. */
export function appJwt(cfg: GithubAppConfig, now: number = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 600, iss: cfg.appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${b64url(signer.sign(cfg.privateKey))}`;
}

export const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ghostaff-engine',
});

/** `owner/name`, both GitHub-safe. */
export const isRepo = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s);

export type RepoTokens = (installation: number, repo: string) => Promise<string>;

/** Installation tokens for one repo each, with contents write, cached until near expiry. */
export function repoTokens(loadConfig: () => Promise<GithubAppConfig | null>, f: Fetch = fetch, now = () => Date.now()): RepoTokens {
  const cache = new Map<string, { token: string; expires: number }>();
  return async (installation, repo) => {
    const key = `${installation}:${repo}`;
    const hit = cache.get(key);
    if (hit && hit.expires - 5 * 60_000 > now()) return hit.token;
    const cfg = await loadConfig();
    if (!cfg) throw new Error('the GitHub record connector is not configured (GITHUB_APP_ID and its key)');
    const res = await f(`${GITHUB_API}/app/installations/${installation}/access_tokens`, {
      method: 'POST',
      headers: { ...githubHeaders(appJwt(cfg, now())), 'Content-Type': 'application/json' },
      body: JSON.stringify({ repositories: [repo.split('/')[1]], permissions: { contents: 'write', metadata: 'read' } }),
    });
    if (!res.ok) throw new Error(`GitHub refused an installation token for ${repo}: ${res.status}`);
    const body = (await res.json()) as { token: string; expires_at: string };
    cache.set(key, { token: body.token, expires: Date.parse(body.expires_at) });
    return body.token;
  };
}
