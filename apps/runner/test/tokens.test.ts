import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { credentialKeyOf } from '../src/lib';
import { type RepoCredential, serveTokens } from '../src/tokens';

const HELPER = join(__dirname, '../src/credential-helper.mjs');

/** What git's credential helper answers for a request, as git calls it: `get`, the request on stdin. */
function helper(port: number, request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HELPER, String(port), 'get'], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', () => resolve(out));
    child.stdin.end(request);
  });
}

const ask = (host: string, path: string, protocol = 'https') => `protocol=${protocol}\nhost=${host}\npath=${path}\n\n`;

function credentials(now: number) {
  const renewed: string[] = [];
  const repo = (username: string, token: string, expiresIn: number): RepoCredential => ({
    username,
    token,
    expiresAt: new Date(now + expiresIn).toISOString(),
    renew: async () => {
      renewed.push(token);
      return new Response(JSON.stringify({ token: `${token}-2`, expiresAt: new Date(now + 3_600_000).toISOString() }));
    },
  });
  const map = new Map<string, RepoCredential>([
    [credentialKeyOf('https://github.com/ordago-app/business.git'), repo('x-access-token', 'ghs_record', 3_600_000)],
    [credentialKeyOf('https://github.com/ordago-app/ordago-apps.git'), repo('x-access-token', 'ghs_apps', 60_000)],
    [credentialKeyOf('http://10.132.0.5:3000/records/org-1.git'), repo('agent-1', 'fgj_record', 3_600_000)],
  ]);
  return { map, renewed };
}

describe('the run’s repo tokens for git', () => {
  it('gives each repo its own token, as its own user, and nothing for a repo or host that is not the run’s', async () => {
    const now = Date.parse('2026-11-21T10:00:00Z');
    const { map } = credentials(now);
    const seen: string[] = [];
    const server = await serveTokens(map, (t) => seen.push(t), () => {}, () => now);
    try {
      expect(await helper(server.port, ask('github.com', 'ordago-app/business.git'))).toBe('username=x-access-token\npassword=ghs_record\n');
      expect(await helper(server.port, ask('10.132.0.5:3000', 'records/org-1.git', 'http'))).toBe('username=agent-1\npassword=fgj_record\n');
      // Another repo of the same organisation, another host, a path with no repo, no path (useHttpPath off): nothing.
      expect(await helper(server.port, ask('github.com', 'ordago-app/secreto.git'))).toBe('');
      expect(await helper(server.port, ask('evil.example', 'ordago-app/business.git'))).toBe('');
      expect(await helper(server.port, ask('github.com', 'ordago-app/business.git', 'http'))).toBe('');
      expect(await helper(server.port, 'protocol=https\nhost=github.com\n\n')).toBe('');
      expect(seen).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('renews a token close to its end through the engine before handing it out, and only that one', async () => {
    const now = Date.parse('2026-11-21T10:00:00Z');
    const { map, renewed } = credentials(now);
    const seen: string[] = [];
    const server = await serveTokens(map, (t) => seen.push(t), () => {}, () => now);
    try {
      expect(await helper(server.port, ask('github.com', 'ordago-app/ordago-apps'))).toBe('username=x-access-token\npassword=ghs_apps-2\n');
      expect(await helper(server.port, ask('github.com', 'ordago-app/ordago-apps.git'))).toBe('username=x-access-token\npassword=ghs_apps-2\n');
      expect(renewed).toEqual(['ghs_apps']);
      expect(seen).toEqual(['ghs_apps-2']);
    } finally {
      server.close();
    }
  });

  it('gives `gh` the token of a repo whose pull requests the agent handles, and of no other', async () => {
    const now = Date.parse('2026-11-21T10:00:00Z');
    const { map, renewed } = credentials(now);
    map.get(credentialKeyOf('https://github.com/ordago-app/ordago-apps.git'))!.gh = 'ordago-app/ordago-apps';
    const server = await serveTokens(map, () => {}, () => {}, () => now);
    const gh = async (repo: string) => {
      const res = await fetch(`http://127.0.0.1:${server.port}/gh?${new URLSearchParams({ repo })}`);
      return { status: res.status, body: await res.json() };
    };
    try {
      expect(await gh('Ordago-App/ordago-apps')).toEqual({ status: 200, body: { token: 'ghs_apps-2' } });
      expect(renewed).toEqual(['ghs_apps']);
      expect(await gh('ordago-app/business')).toEqual({ status: 404, body: { repos: ['ordago-app/ordago-apps'] } });
      expect(await gh('ordago-app/secreto')).toEqual({ status: 404, body: { repos: ['ordago-app/ordago-apps'] } });
    } finally {
      server.close();
    }
  });

  it('hands out the token it has when the engine does not renew it', async () => {
    const now = Date.parse('2026-11-21T10:00:00Z');
    const { map } = credentials(now);
    map.get(credentialKeyOf('https://github.com/ordago-app/ordago-apps.git'))!.renew = async () => new Response('no', { status: 403 });
    const errors: unknown[] = [];
    const server = await serveTokens(map, () => {}, (e) => errors.push(e), () => now);
    try {
      expect(await helper(server.port, ask('github.com', 'ordago-app/ordago-apps.git'))).toBe('username=x-access-token\npassword=ghs_apps\n');
    } finally {
      server.close();
    }
  });
});
