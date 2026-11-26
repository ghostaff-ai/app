import { describe, expect, it } from 'vitest';
import { agentUsername, forgejoAdmin, forgejoRepo, recordRepoName, runTokenMadeAt, runTokenName } from '../src/forgejo';
import { preReceiveHook } from '../src/recordHook';

const CFG = { url: 'http://10.0.0.5:3000/', adminToken: 'admin-token', adminUser: 'ghostaff' };
const RUN = '0b6a4c1e-1111-4222-8333-944455556666';

type Route = (body: any, headers: Record<string, string>) => { status?: number; body?: unknown };

/** A fake Forgejo: answers by `METHOD /path` (without /api/v1 and the query), records every call. */
function fake(routes: Record<string, Route>) {
  const calls: Array<{ key: string; body: any; auth: string }> = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(url.origin).toBe('http://10.0.0.5:3000');
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace('/api/v1', '')}`;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ key, body, auth: headers.Authorization ?? '' });
    const route = routes[key];
    const out = route ? route(body, headers) : { status: 404, body: { message: 'Not Found' } };
    return new Response(out.body === undefined || out.status === 204 ? null : JSON.stringify(out.body), { status: out.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('names', () => {
  it('a record per organisation id, a user per agent inside Forgejo’s 40 characters', () => {
    expect(recordRepoName('6F1D2C3B-0000-4000-8000-000000000001')).toBe('records/6f1d2c3b-0000-4000-8000-000000000001');
    const u = agentUsername(RUN);
    expect(u).toBe('agent-0b6a4c1e111142228333944455556666');
    expect(u.length).toBeLessThanOrEqual(40);
  });

  it('a run’s token says when it was made', () => {
    const name = runTokenName(RUN, new Date('2026-11-24T10:00:00Z'));
    expect(runTokenMadeAt(name)?.toISOString()).toBe('2026-11-24T10:00:00.000Z');
    expect(runTokenMadeAt('engine')).toBeNull();
  });
});

describe('forgejoRepo', () => {
  const repo = 'records/org-1';
  const base = {
    'GET /repos/records/org-1': () => ({ body: { default_branch: 'main' } }),
    'GET /repos/records/org-1/branches/main': () => ({ body: { commit: { id: 'head1' } } }),
    'GET /repos/records/org-1/contents/por-decidir': () => ({
      body: [
        { type: 'file', name: 'a.yaml', sha: 's-a' },
        { type: 'dir', name: 'viejas', sha: 's-d' },
      ],
    }),
    'GET /repos/records/org-1/contents/por-decidir/a.yaml': () => ({ body: { type: 'file', name: 'a.yaml', sha: 's-a' } }),
    'GET /repos/records/org-1/git/blobs/s-a': () => ({ body: { encoding: 'base64', content: b64('pregunta: ¿Sí?\n') } }),
  };

  it('reads the head and the files of a folder', async () => {
    const { f, calls } = fake(base);
    const r = forgejoRepo(CFG, repo, f);
    expect(await r.head()).toEqual({ branch: 'main', sha: 'head1' });
    expect(await r.files('por-decidir', 'head1')).toEqual([{ name: 'a.yaml', content: 'pregunta: ¿Sí?\n' }]);
    expect(await r.file('nada.md', 'head1')).toBeNull();
    expect(calls.every((c) => c.auth === 'token admin-token')).toBe(true);
  });

  it('commits updates with the sha they had at the head, and new files as creations', async () => {
    let sent: any;
    const { f } = fake({ ...base, 'POST /repos/records/org-1/contents': (b) => ((sent = b), { status: 201, body: {} }) });
    const ok = await forgejoRepo(CFG, repo, f).commit({ branch: 'main', sha: 'head1' }, [
      { path: 'por-decidir/a.yaml', content: 'respuesta: si\n' },
      { path: 'agentes/historial.csv', content: 'x\n' },
    ], 'por-decidir: respuestas');
    expect(ok).toBe(true);
    expect(sent).toEqual({
      branch: 'main',
      message: 'por-decidir: respuestas',
      files: [
        { operation: 'update', path: 'por-decidir/a.yaml', sha: 's-a', content: b64('respuesta: si\n') },
        { operation: 'create', path: 'agentes/historial.csv', content: b64('x\n') },
      ],
    });
  });

  it('deletes a file with the sha it had, and skips one already gone', async () => {
    let sent: any;
    const { f } = fake({ ...base, 'POST /repos/records/org-1/contents': (b) => ((sent = b), { status: 201, body: {} }) });
    const r = forgejoRepo(CFG, repo, f);
    expect(await r.commit({ branch: 'main', sha: 'head1' }, [{ path: 'por-decidir/a.yaml', content: null }, { path: 'nada.md', content: null }], 'externos')).toBe(true);
    expect(sent.files).toEqual([{ operation: 'delete', path: 'por-decidir/a.yaml', sha: 's-a' }]);
    sent = undefined;
    expect(await r.commit({ branch: 'main', sha: 'head1' }, [{ path: 'nada.md', content: null }], 'externos')).toBe(true);
    expect(sent).toBeUndefined();
  });

  it('answers false when the record moved under a file (409)', async () => {
    const { f } = fake({ ...base, 'POST /repos/records/org-1/contents': () => ({ status: 409, body: { message: 'sha does not match' } }) });
    expect(await forgejoRepo(CFG, repo, f).commit({ branch: 'main', sha: 'head1' }, [{ path: 'por-decidir/a.yaml', content: 'x' }], 'm')).toBe(false);
  });

  it('throws on anything else', async () => {
    const { f } = fake({ ...base, 'POST /repos/records/org-1/contents': () => ({ status: 500 }) });
    await expect(forgejoRepo(CFG, repo, f).commit({ branch: 'main', sha: 'head1' }, [{ path: 'a', content: 'x' }], 'm')).rejects.toThrow('Forgejo 500');
  });
});

describe('forgejoAdmin', () => {
  const HOOK = preReceiveHook('ghostaff', []);

  it('makes a record once: repo, first commit, protection, hook', async () => {
    let exists = false;
    let seeded = false;
    let protectedMain = false;
    const { f, calls } = fake({
      'GET /repos/records/org-1': () => (exists ? { body: {} } : { status: 404 }),
      'POST /orgs/records/repos': (b) => {
        expect(b).toEqual({ name: 'org-1', private: true, auto_init: false, default_branch: 'main' });
        exists = true;
        return { status: 201, body: {} };
      },
      'GET /repos/records/org-1/branches/main': () => (seeded ? { body: { commit: { id: 'c1' } } } : { status: 404 }),
      'POST /repos/records/org-1/contents': (b) => {
        expect(b.files).toEqual([{ operation: 'create', path: 'AGENTS.md', content: b64('Hola\n') }]);
        seeded = true;
        return { status: 201, body: {} };
      },
      'GET /repos/records/org-1/branch_protections': () => ({ body: protectedMain ? [{ rule_name: 'main' }] : [] }),
      'POST /repos/records/org-1/branch_protections': (b) => {
        expect(b).toEqual({ rule_name: 'main', branch_name: 'main', enable_push: true });
        protectedMain = true;
        return { status: 201, body: {} };
      },
      'PATCH /repos/records/org-1/hooks/git/pre-receive': (b) => (expect(b.content).toBe(HOOK), { body: {} }),
    });
    const admin = forgejoAdmin(CFG, f);
    expect(await admin.ensureRecord('records/org-1', [{ path: 'AGENTS.md', content: 'Hola\n' }], HOOK)).toBe(true);
    const first = calls.length;
    expect(await admin.ensureRecord('records/org-1', [{ path: 'AGENTS.md', content: 'Hola\n' }], HOOK)).toBe(false);
    expect(calls.slice(first).map((c) => c.key)).toEqual([
      'GET /repos/records/org-1',
      'GET /repos/records/org-1/branches/main',
      'GET /repos/records/org-1/branch_protections',
      'PATCH /repos/records/org-1/hooks/git/pre-receive',
    ]);
  });

  it('makes the agent’s user and gives it write on its record only', async () => {
    const { f, calls } = fake({
      'GET /users/agent-0b6a4c1e111142228333944455556666': () => ({ status: 404 }),
      'POST /admin/users': (b) => {
        expect(b.username).toBe('agent-0b6a4c1e111142228333944455556666');
        expect(b.email).toBe('agent-0b6a4c1e111142228333944455556666@agents.ghostaff.invalid');
        return { status: 201, body: {} };
      },
      'PUT /repos/records/org-1/collaborators/agent-0b6a4c1e111142228333944455556666': (b) => (expect(b).toEqual({ permission: 'write' }), { status: 204 }),
    });
    await forgejoAdmin(CFG, f).ensureAgentUser(agentUsername(RUN), 'records/org-1');
    expect(calls.map((c) => c.key)).toContain('PUT /repos/records/org-1/collaborators/agent-0b6a4c1e111142228333944455556666');
    await expect(forgejoAdmin(CFG, f).ensureAgentUser('ghostaff', 'records/org-1')).rejects.toThrow('not an agent');
  });

  it('mints a run’s token with a password nobody keeps, retrying once when another run reset it', async () => {
    const user = agentUsername(RUN);
    const passwords: string[] = [];
    let posts = 0;
    const { f, calls } = fake({
      [`PATCH /admin/users/${user}`]: (b) => (passwords.push(b.password), { body: {} }),
      [`POST /users/${user}/tokens`]: (b, h) => {
        posts++;
        if (posts === 1) return { status: 401, body: { message: 'unauthorized' } };
        expect(h.Authorization).toBe(`Basic ${Buffer.from(`${user}:${passwords.at(-1)}`).toString('base64')}`);
        expect(b).toEqual({ name: runTokenName(RUN, new Date('2026-11-24T10:00:00Z')), scopes: ['write:repository'] });
        return { status: 201, body: { sha1: 'run-secret' } };
      },
    });
    const t = await forgejoAdmin(CFG, f, () => new Date('2026-11-24T10:00:00Z')).mintRunToken(user, RUN);
    expect(t.token).toBe('run-secret');
    expect(passwords).toHaveLength(2);
    expect(passwords[0]).not.toBe(passwords[1]);
    expect(calls.filter((c) => c.key.startsWith('PATCH')).every((c) => c.auth === 'token admin-token')).toBe(true);
  });

  it('revokes a run’s token, and sweeps those of runs that never reported', async () => {
    const user = agentUsername(RUN);
    const old = runTokenName(RUN, new Date('2026-11-24T06:00:00Z'));
    const fresh = runTokenName('9b6a4c1e-1111-4222-8333-944455556666', new Date('2026-11-24T09:30:00Z'));
    const deleted: string[] = [];
    const { f } = fake({
      [`GET /users/${user}/tokens`]: () => ({ body: [{ name: old }, { name: fresh }, { name: 'otra-cosa' }] }),
      [`PATCH /admin/users/${user}`]: () => ({ body: {} }),
      [`DELETE /users/${user}/tokens/${old}`]: () => (deleted.push(old), { status: 204 }),
      [`DELETE /users/${user}/tokens/${fresh}`]: () => (deleted.push(fresh), { status: 204 }),
    });
    const admin = forgejoAdmin(CFG, f);
    expect(await admin.sweepRunTokens(user, new Date('2026-11-24T07:00:00Z'))).toBe(1);
    expect(deleted).toEqual([old]);
    await admin.revokeRunTokens(user, '9b6a4c1e-1111-4222-8333-944455556666');
    await admin.revokeRunTokens(user, '00000000-0000-4000-8000-000000000000');
    expect(deleted).toEqual([old, fresh]);
  });

  it('clones from the record store’s address on the VPC', () => {
    expect(forgejoAdmin(CFG, fake({}).f).cloneUrl('records/org-1')).toBe('http://10.0.0.5:3000/records/org-1.git');
  });
});
