// The run's repo tokens for git (credential-helper.mjs), served by the runner on
// 127.0.0.1 only: the record's and each of the agent's other repos', each its
// own, keyed by the repo git asks for. A repo that is not the run's gets nothing.
// A token close to its end is renewed through the engine before it is handed out.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { credentialKey, tokenNearExpiry } from './lib';

/** One repo's credential for git: who to say it is, the current token, and how to get the next. */
export interface RepoCredential {
  username: string;
  token: string;
  expiresAt: string;
  /** Asks the engine for a fresh token: `{ token, expiresAt }` when it answers 200. */
  renew(): Promise<Response>;
}

export async function serveTokens(
  /** By credentialKeyOf(cloneUrl). */
  repos: Map<string, RepoCredential>,
  /** A renewed token, so the run never prints or reports it. */
  onToken: (token: string) => void,
  onError: (e: unknown) => void,
  now: () => number = Date.now,
): Promise<{ port: number; close(): void }> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const q = url.searchParams;
    const repo = url.pathname === '/token' ? repos.get(credentialKey(q.get('protocol') ?? '', q.get('host') ?? '', q.get('path') ?? '')) : undefined;
    if (!repo) return res.writeHead(404).end();
    try {
      if (tokenNearExpiry(repo.expiresAt, now())) {
        const r = await repo.renew();
        if (r.ok) {
          const fresh = (await r.json()) as { token: string; expiresAt: string };
          repo.token = fresh.token;
          repo.expiresAt = fresh.expiresAt;
          onToken(fresh.token);
        }
      }
    } catch (e) {
      onError(e);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ username: repo.username, password: repo.token }));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { port: (server.address() as AddressInfo).port, close: () => server.close() };
}
