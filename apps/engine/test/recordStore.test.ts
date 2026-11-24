import { describe, expect, it } from 'vitest';
import { agentUsername, type ForgejoAdmin } from '../src/forgejo';
import { hookAgents, provisionRecords, recordSeed } from '../src/recordProvision';
import { canReach, type RecordOrg, syncAll, syncOrg } from '../src/recordSync';
import { endRecordAccess, RECORD_STORE_TOKEN_HOURS, recordAccess, type RunnerDeps } from '../src/runner';

const ORG_ID = '6f1d2c3b-0000-4000-8000-000000000001';
const SECRETARIA = '11111111-1111-4111-8111-111111111111';
const LEGAL = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const OWN: RecordOrg = { id: ORG_ID, slug: 'panaderia', repo: `records/${ORG_ID}`, host: 'ghostaff' };
const GITHUB: RecordOrg = { id: 'org-2', slug: 'ordago', repo: 'ordago-app/business', host: 'github', installation: 7 };

/** A fake admin that records what it was asked, in order. */
function fakeAdmin(opts: { fail?: string } = {}) {
  const did: string[] = [];
  const admin = {
    async ensureOwner() {
      did.push('owner');
    },
    async ensureRecord(repo: string, seed: { path: string }[], hook: string) {
      if (opts.fail && repo.includes(opts.fail)) throw new Error('Forgejo 500 on POST /orgs/records/repos');
      did.push(`record ${repo} [${seed.map((x) => x.path).join(', ')}] hook:${hook.includes(agentUsername(LEGAL)) ? 'legal' : 'nobody'}`);
      return true;
    },
    async setHook(repo: string, hook: string) {
      did.push(`hook ${repo} ${hook.includes(`${agentUsername(SECRETARIA)}) own=secretaria; company=yes`) ? 'secretaria-keeps-empresa' : ''}`);
    },
    async ensureAgentUser(user: string, repo: string) {
      did.push(`user ${user} on ${repo}`);
    },
    async mintRunToken(user: string, run: string) {
      did.push(`token ${user} ${run}`);
      return { name: `run-${run}-1`, token: 'fj-secret' };
    },
    async revokeRunTokens(user: string, run: string) {
      did.push(`revoke ${user} ${run}`);
    },
    cloneUrl: (repo: string) => `http://10.0.0.5:3000/${repo}.git`,
  } as unknown as ForgejoAdmin;
  return { admin, did };
}

const agents = [
  { id: SECRETARIA, slug: 'secretaria', ghost: 'secretaria' },
  { id: LEGAL, slug: 'legal', ghost: 'base' },
];

describe('records for every organisation', () => {
  it('makes the missing ones, with the layout and the hook, and says what it did', async () => {
    const { admin, did } = fakeAdmin({ fail: 'bbbb' });
    const set: string[] = [];
    const out = await provisionRecords({
      store: {
        orgsWithoutRecord: async () => [
          { id: ORG_ID, slug: 'panaderia', name: 'Panadería' },
          { id: 'bbbb', slug: 'taller', name: 'Taller' },
        ],
        setOwnRecord: async (orgId, repo) => (set.push(`${orgId} ${repo}`), true),
      },
      admin,
      adminUser: 'ghostaff',
      agentsOf: async (orgId) => (orgId === ORG_ID ? agents : []),
    });
    expect(did).toEqual(['owner', `record records/${ORG_ID} [AGENTS.md, memoria/empresa/.gitkeep, por-decidir/.gitkeep] hook:legal`]);
    expect(set).toEqual([`${ORG_ID} records/${ORG_ID}`]);
    expect(out).toEqual([`panaderia: record made, records/${ORG_ID}`, 'taller: record not made: Forgejo 500 on POST /orgs/records/repos']);
  });

  it('does nothing, not even the owner, when every organisation has one', async () => {
    const { admin, did } = fakeAdmin();
    expect(await provisionRecords({ store: { orgsWithoutRecord: async () => [], setOwnRecord: async () => true }, admin, adminUser: 'ghostaff', agentsOf: async () => [] })).toEqual([]);
    expect(did).toEqual([]);
  });

  it('lets only Secretaría keep the company’s memory', () => {
    expect(hookAgents(agents)).toEqual([
      { username: agentUsername(SECRETARIA), slug: 'secretaria', writesCompany: true },
      { username: agentUsername(LEGAL), slug: 'legal', writesCompany: false },
    ]);
  });

  it('starts the record with how it is laid out, in the organisation’s name', () => {
    const agentsMd = recordSeed('Panadería Ana')[0]!;
    expect(agentsMd.path).toBe('AGENTS.md');
    expect(agentsMd.content).toContain('# Panadería Ana');
    expect(agentsMd.content).toContain('memoria/agentes/<agente>/');
  });
});

describe('which records this engine reaches', () => {
  it('a GitHub record needs the App, ours the record store', async () => {
    expect(canReach({ tokens: null, forgejo: null }, GITHUB)).toBe(false);
    expect(canReach({ tokens: async () => 't', forgejo: null }, GITHUB)).toBe(true);
    expect(canReach({ tokens: async () => 't', forgejo: null }, OWN)).toBe(false);
    expect(canReach({ tokens: null, forgejo: { url: 'http://x', adminToken: 'a', adminUser: 'ghostaff' } }, OWN)).toBe(true);
    // An engine with neither syncs nothing, and never fails for it.
    const r = await syncAll({
      tokens: null,
      forgejo: null,
      store: {
        orgsWithRecord: async () => [GITHUB, OWN],
        orgWithRecord: async () => null,
        orgsWithoutRecord: async () => [],
        setOwnRecord: async () => false,
        decisions: async () => [],
        apply: async () => {},
        markWrittenBack: async () => {},
        syncState: async () => {},
      },
    });
    expect(r).toEqual([]);
  });
});

describe('the sync on a record in our record store', () => {
  it('reads por-decidir through Forgejo’s API, as the engine’s admin', async () => {
    const yaml = 'area: seo\ntipo: titulo-web\npregunta: ¿Cambio el título?\ncontexto: Porque sí.\npropone: seo\ncreada: 2026-11-07\n';
    const seen: string[] = [];
    const f = (async (input: string | URL, init?: RequestInit) => {
      const u = new URL(String(input));
      seen.push(`${init?.method ?? 'GET'} ${u.origin}${u.pathname} ${(init?.headers as Record<string, string>).Authorization}`);
      const path = u.pathname.replace(`/api/v1/repos/${OWN.repo}`, '');
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (path === '') return json({ default_branch: 'main' });
      if (path === '/branches/main') return json({ commit: { id: 'c1' } });
      if (path === '/contents/por-decidir') return json([{ type: 'file', name: 'seo-a.yaml', sha: 'b1' }]);
      if (path === '/git/blobs/b1') return json({ encoding: 'base64', content: Buffer.from(yaml).toString('base64') });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    const applied: unknown[] = [];
    const r = await syncOrg(
      {
        tokens: null,
        forgejo: { url: 'http://10.0.0.5:3000', adminToken: 'adm', adminUser: 'ghostaff' },
        fetch: f,
        store: {
          orgsWithRecord: async () => [OWN],
          orgWithRecord: async () => OWN,
          orgsWithoutRecord: async () => [],
          setOwnRecord: async () => false,
          decisions: async () => [],
          apply: async (p) => void applied.push(p),
          markWrittenBack: async () => {},
          syncState: async () => {},
        },
      },
      OWN,
    );
    expect(r.ok).toBe(true);
    expect((applied[0] as { upserts: { record_id: string }[] }).upserts.map((u) => u.record_id)).toEqual(['seo-a']);
    expect(seen.every((x) => x.startsWith('GET http://10.0.0.5:3000/api/v1/') && x.endsWith('token adm'))).toBe(true);
  });
});

describe('a run’s way into its record', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const runnerWith = (admin: ForgejoAdmin | null, org: RecordOrg) =>
    ({
      record: async () => org,
      freshToken: async (inst: number, repo: string) => ({ token: `ghs_${inst}_${repo}`, expiresAt: '2026-11-24T11:00:00Z' }),
      recordStore: admin ? { admin, adminUser: 'ghostaff', agentsOf: async () => agents } : null,
      now: () => now,
    }) as unknown as RunnerDeps;

  it('on GitHub: a fresh installation token, cloned from github.com', async () => {
    expect(await recordAccess(runnerWith(null, GITHUB), GITHUB, LEGAL, RUN)).toEqual({
      repo: 'ordago-app/business',
      cloneUrl: 'https://github.com/ordago-app/business.git',
      username: 'x-access-token',
      token: 'ghs_7_ordago-app/business',
      expiresAt: '2026-11-24T11:00:00Z',
    });
  });

  it('in our record store: the agent’s own user, the hook as the organisation’s agents are now, a token for this run', async () => {
    const { admin, did } = fakeAdmin();
    const a = await recordAccess(runnerWith(admin, OWN), OWN, LEGAL, RUN);
    expect(a).toEqual({
      repo: OWN.repo,
      cloneUrl: `http://10.0.0.5:3000/${OWN.repo}.git`,
      username: agentUsername(LEGAL),
      token: 'fj-secret',
      expiresAt: new Date(now.getTime() + RECORD_STORE_TOKEN_HOURS * 3_600_000).toISOString(),
    });
    expect(did).toEqual([`user ${agentUsername(LEGAL)} on ${OWN.repo}`, `hook ${OWN.repo} secretaria-keeps-empresa`, `token ${agentUsername(LEGAL)} ${RUN}`]);
  });

  it('is refused where there is no record store', async () => {
    await expect(recordAccess(runnerWith(null, OWN), OWN, LEGAL, RUN)).rejects.toThrow('no record store');
  });

  it('ends when the run reports: its tokens revoked in our record store, nothing to do on GitHub', async () => {
    const { admin, did } = fakeAdmin();
    await endRecordAccess(runnerWith(admin, OWN), ORG_ID, LEGAL, RUN);
    await endRecordAccess(runnerWith(admin, GITHUB), 'org-2', LEGAL, RUN);
    expect(did).toEqual([`revoke ${agentUsername(LEGAL)} ${RUN}`]);
  });
});
