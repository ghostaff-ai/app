import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain node, no types: the image runs it without tsx.
import { ghRepo } from '../src/gh.mjs';
import { credentialKeyOf } from '../src/lib';
import { type RepoCredential, serveTokens } from '../src/tokens';

const WRAPPER = join(__dirname, '../src/gh.mjs');

describe('which repo a `gh` call is for', () => {
  const none = () => null;

  it('reads -R and --repo in every form gh takes', () => {
    expect(ghRepo(['pr', 'list', '-R', 'ordago-app/ordago-apps'], {}, none)).toBe('ordago-app/ordago-apps');
    expect(ghRepo(['-R', 'github.com/ordago-app/ordago-apps', 'pr', 'list'], {}, none)).toBe('ordago-app/ordago-apps');
    expect(ghRepo(['issue', 'list', '--repo', 'https://github.com/ordago-app/ordago-apps.git'], {}, none)).toBe('ordago-app/ordago-apps');
    expect(ghRepo(['issue', 'list', '--repo=ordago-app/ordago-apps'], {}, none)).toBe('ordago-app/ordago-apps');
    expect(ghRepo(['issue', 'list', '-Rordago-app/ordago-apps'], {}, none)).toBe('ordago-app/ordago-apps');
  });

  it('then GH_REPO, then the path of `gh api`, then the clone it runs in', () => {
    expect(ghRepo(['pr', 'list'], { GH_REPO: 'ordago-app/business' }, none)).toBe('ordago-app/business');
    expect(ghRepo(['api', 'repos/ordago-app/ordago-apps/pulls/3'], {}, none)).toBe('ordago-app/ordago-apps');
    expect(ghRepo(['api', '-X', 'GET', '/repos/ordago-app/ordago-apps/issues?state=open'], {}, none)).toBe('ordago-app/ordago-apps');
    expect(ghRepo(['api', 'repos/{owner}/{repo}/pulls'], {}, () => 'https://github.com/ordago-app/ordago-apps.git')).toBe('ordago-app/ordago-apps');
    expect(ghRepo(['pr', 'checks', '12'], {}, () => 'https://github.com/ordago-app/ordago-apps')).toBe('ordago-app/ordago-apps');
    expect(ghRepo(['pr', 'list'], {}, () => 'http://10.0.0.5:3000/records/x.git')).toBeNull();
    expect(ghRepo(['--version'], {}, none)).toBeNull();
  });
});

/** A stand-in for the real gh: says what it was called with and the token it got. */
function fakeGh(dir: string): string {
  const file = join(dir, 'gh');
  writeFileSync(
    file,
    `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ args: process.argv.slice(2), token: process.env.GH_TOKEN ?? null, host: process.env.GH_HOST ?? null }));\nprocess.exit(3);\n`,
  );
  chmodSync(file, 0o755);
  return file;
}

function wrapper(real: string, args: string[], env: Record<string, string>, cwd: string): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WRAPPER, real, ...args], { cwd, env: { PATH: process.env.PATH ?? '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

describe('the `gh` wrapper', () => {
  it('runs the real gh with the token of the repo it is for, asked of the runner, and passes its exit code', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gh-'));
    const real = fakeGh(dir);
    const clone = join(dir, 'ordago-apps');
    execFileSync('git', ['init', '--quiet', clone]);
    execFileSync('git', ['-C', clone, 'remote', 'add', 'origin', 'https://github.com/ordago-app/ordago-apps.git']);
    const now = Date.now();
    const cred = (token: string, gh?: string): RepoCredential => ({
      username: 'x-access-token',
      token,
      expiresAt: new Date(now + 3_600_000).toISOString(),
      renew: async () => new Response('no', { status: 500 }),
      ...(gh ? { gh } : {}),
    });
    const server = await serveTokens(
      new Map([
        [credentialKeyOf('https://github.com/ordago-app/business.git'), cred('ghs_record')],
        [credentialKeyOf('https://github.com/ordago-app/ordago-apps.git'), cred('ghs_apps', 'ordago-app/ordago-apps')],
      ]),
      () => {},
      () => {},
    );
    const env = { GHOSTAFF_TOKENS: `http://127.0.0.1:${server.port}`, GH_HOST: 'evil.example' };
    try {
      const fromClone = await wrapper(real, ['pr', 'list', '--state', 'open'], env, clone);
      expect(fromClone.code).toBe(3);
      expect(JSON.parse(fromClone.out)).toEqual({ args: ['pr', 'list', '--state', 'open'], token: 'ghs_apps', host: 'github.com' });
      const named = await wrapper(real, ['issue', 'list', '-R', 'ordago-app/ordago-apps'], env, dir);
      expect(JSON.parse(named.out).token).toBe('ghs_apps');
      // A repo whose PRs the agent does not handle, the record included: no gh, and it is told which repos have it.
      const record = await wrapper(real, ['pr', 'list', '-R', 'ordago-app/business'], env, dir);
      expect(record.code).toBe(4);
      expect(record.out).toBe('');
      expect(record.err).toContain('`ordago-app/ordago-apps`');
      // Nothing to say which repo: gh runs, with no token.
      expect(JSON.parse((await wrapper(real, ['--version'], env, dir)).out)).toEqual({ args: ['--version'], token: null, host: 'github.com' });
      // Outside a run that has repos with gh.
      const outside = await wrapper(real, ['pr', 'list', '-R', 'ordago-app/ordago-apps'], {}, dir);
      expect(outside.code).toBe(4);
      expect(outside.err).toMatch(/ningún repo/);
    } finally {
      server.close();
    }
  });
});
