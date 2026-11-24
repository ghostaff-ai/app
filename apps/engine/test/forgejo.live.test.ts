// Against a real Forgejo, skipped unless one is given (CI has none):
//
//   docker run -d --name forgejo-test -p 3999:3000 -e FORGEJO__security__INSTALL_LOCK=true \
//     -e FORGEJO__security__DISABLE_GIT_HOOKS=false -e FORGEJO__database__DB_TYPE=sqlite3 \
//     codeberg.org/forgejo/forgejo:15.0.12
//   docker exec -u git forgejo-test forgejo admin user create --admin --username ghostaff \
//     --password <any> --email admin@example.test --must-change-password=false
//   FORGEJO_TEST_URL=http://localhost:3999 FORGEJO_TEST_TOKEN=$(docker exec -u git forgejo-test \
//     forgejo admin user generate-access-token --username ghostaff --scopes all --raw) \
//     pnpm --filter @ghostaff/engine exec vitest run test/forgejo.live.test.ts

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentUsername, forgejoAdmin, forgejoRepo, recordRepoName } from '../src/forgejo';
import { preReceiveHook } from '../src/recordHook';

const url = process.env.FORGEJO_TEST_URL;
const token = process.env.FORGEJO_TEST_TOKEN;

describe.skipIf(!url || !token)('the record store, live', () => {
  it('a record, an agent that pushes what it may and not more, and a token that stops working', async () => {
    const cfg = { url: url!, adminToken: token!, adminUser: 'ghostaff' };
    const admin = forgejoAdmin(cfg);
    const repo = recordRepoName(randomUUID());
    const agentId = randomUUID();
    const user = agentUsername(agentId);
    const hook = preReceiveHook('ghostaff', [{ username: user, slug: 'finanzas', writesCompany: false }]);

    await admin.ensureOwner();
    expect(await admin.ensureRecord(repo, [{ path: 'AGENTS.md', content: 'La empresa\n' }, { path: 'memoria/empresa/.keep', content: '' }], hook)).toBe(true);
    expect(await admin.ensureRecord(repo, [], hook)).toBe(false);
    await admin.ensureAgentUser(user, repo);
    const run = randomUUID();
    const t = await admin.mintRunToken(user, run);

    // The run's clone and pushes, with the token as git would get it from the runner's helper.
    const dir = mkdtempSync(join(tmpdir(), 'record-live-'));
    try {
      const remote = admin.cloneUrl(repo).replace('://', `://${user}:${t.token}@`);
      const git = (args: string[]) =>
        execFileSync('git', ['-c', 'user.name=Finanzas', '-c', 'user.email=f@example.test', ...args], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
      git(['clone', '-q', remote, '.']);
      mkdirSync(join(dir, 'memoria', 'agentes', 'finanzas'), { recursive: true });
      writeFileSync(join(dir, 'memoria', 'agentes', 'finanzas', 'informe.md'), 'En tres líneas\n');
      git(['add', '-A']);
      git(['commit', '-qm', 'recuerdo']);
      git(['push', '-q', 'origin', 'main']);

      writeFileSync(join(dir, 'memoria', 'empresa', 'precios.md'), 'x\n');
      git(['add', '-A']);
      git(['commit', '-qm', 'no debería']);
      expect(() => git(['push', '-q', 'origin', 'main'])).toThrow(/la guarda Secretaría/);
      git(['reset', '-q', '--hard', 'origin/main']);

      // Main is protected: no force push.
      git(['commit', '-q', '--amend', '-m', 'reescrito']);
      expect(() => git(['push', '-q', '--force', 'origin', 'main'])).toThrow();
      git(['reset', '-q', '--hard', 'origin/main']);

      // The sync's side: read and write through the API, refused when a file moved underneath.
      const r = forgejoRepo(cfg, repo);
      const head = await r.head();
      expect(await r.file('memoria/agentes/finanzas/informe.md', head.sha)).toBe('En tres líneas\n');
      expect(await r.commit(head, [{ path: 'memoria/agentes/finanzas/informe.md', content: 'En dos líneas\n' }], 'corregido en la app')).toBe(true);
      expect(await r.commit(head, [{ path: 'memoria/agentes/finanzas/informe.md', content: 'Otra\n' }], 'tarde')).toBe(false);

      expect(await admin.agentUsers()).toContain(user);
      await admin.revokeRunTokens(user, run);
      expect(() => git(['fetch', '-q', 'origin'])).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
