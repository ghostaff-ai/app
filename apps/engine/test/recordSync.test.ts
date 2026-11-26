import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import type { SyncPlan } from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { appJwt, freshRepoToken, repoTokens } from '../src/githubApp';
import { type InstructedAgent, openDecision, type RecordOrg, type RecordSyncStore, syncOrg } from '../src/recordSync';

const ORG: RecordOrg = { id: 'org-1', slug: 'ordago', repo: 'ordago-app/business', host: 'github', installation: 7 };

const decisionYaml = (id: string) => `area: seo
tipo: titulo-web
pregunta: ¿Cambio el título de ${id}?
contexto: Porque sí.
propone: seo
creada: 2026-11-07
`;

/** A fake GitHub holding one repo: files by path at one head, and the commits made to it. */
function fakeGithub(files: Record<string, string>, opts: { moved?: boolean } = {}) {
  const blobs = new Map<string, string>();
  let n = 0;
  const shaOf = (content: string) => {
    const sha = `blob${n++}`;
    blobs.set(sha, content);
    return sha;
  };
  const tree: Record<string, string> = Object.fromEntries(Object.entries(files).map(([p, c]) => [p, shaOf(c)]));
  const commits: Array<{ message: string; files: Record<string, string> }> = [];
  let pendingTree: Record<string, string> = {};
  let pendingMessage = '';
  const calls: string[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input).replace('https://api.github.com/repos/ordago-app/business', '');
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method === 'GET' && url === '') return json({ default_branch: 'main' });
    if (method === 'GET' && url === '/git/ref/heads/main') return json({ object: { sha: 'head1' } });
    if (method === 'GET' && url.startsWith('/contents/')) {
      const path = url.slice('/contents/'.length).split('?')[0]!;
      if (tree[path]) return json({ type: 'file', sha: tree[path], name: path.split('/').pop() });
      const inDir = Object.keys(tree).filter((p) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
      if (!inDir.length) return json({ message: 'Not Found' }, 404);
      return json(inDir.map((p) => ({ type: 'file', name: p.split('/').pop(), sha: tree[p] })));
    }
    if (method === 'GET' && url.startsWith('/git/blobs/')) {
      return json({ encoding: 'base64', content: Buffer.from(blobs.get(url.split('/').pop()!)!).toString('base64') });
    }
    if (method === 'GET' && url === '/git/commits/head1') return json({ tree: { sha: 'tree1' } });
    if (method === 'POST' && url === '/git/trees') {
      pendingTree = Object.fromEntries(body.tree.map((e: { path: string; content: string }) => [e.path, e.content]));
      return json({ sha: 'tree2' });
    }
    if (method === 'POST' && url === '/git/commits') {
      pendingMessage = body.message;
      expect(body.parents).toEqual(['head1']);
      return json({ sha: 'head2' });
    }
    if (method === 'PATCH' && url === '/git/refs/heads/main') {
      expect(body.force).toBe(false);
      if (opts.moved) return json({ message: 'Update is not a fast forward' }, 422);
      commits.push({ message: pendingMessage, files: pendingTree });
      return json({});
    }
    return json({ message: `unexpected ${method} ${url}` }, 500);
  }) as typeof fetch;
  return { f, commits, calls };
}

function store(rows: DecisionRow[] = [], agents: InstructedAgent[] = []) {
  const applied: SyncPlan[] = [];
  const instructions: Array<[string, unknown]> = [];
  const written: string[] = [];
  const states: Array<string | null> = [];
  const s: RecordSyncStore = {
    orgsWithRecord: async () => [ORG],
    orgWithRecord: async () => ORG,
    orgsWithoutRecord: async () => [],
    setOwnRecord: async () => false,
    decisions: async () => rows,
    agents: async () => [],
    pointDecision: async () => null,
    apply: async (p) => {
      applied.push(p);
    },
    markWrittenBack: async (ids) => {
      written.push(...ids);
    },
    syncState: async (_o, e) => {
      states.push(e);
    },
    instructedAgents: async () => agents,
    setInstructions: async (id, change) => {
      instructions.push([id, change]);
    },
  };
  return { s, applied, written, states, instructions };
}

const appAnswered = (recordId: string): DecisionRow =>
  ({
    id: `row-${recordId}`,
    org_id: ORG.id,
    record_id: recordId,
    answer: 'ok',
    answer_source: 'app',
    answered_by_name: 'Álvaro',
    answered_at: '2026-11-21T10:00:00Z',
    answer_note: null,
    answer_text: null,
    written_back_at: null,
    closed_at: null,
  }) as DecisionRow;

describe('syncOrg', () => {
  it('reads por-decidir from GitHub into the database, without writing when nothing is answered', async () => {
    const gh = fakeGithub({ 'por-decidir/seo-a.yaml': decisionYaml('a'), 'por-decidir/README.md': '# no' });
    const db = store();
    const r = await syncOrg({ store: db.s, tokens: async () => 'tok', forgejo: null, fetch: gh.f }, ORG);
    expect(r.ok).toBe(true);
    expect(db.applied[0]!.upserts.map((u) => u.record_id)).toEqual(['seo-a']);
    expect(db.applied[0]!.upserts[0]!.source_commit).toBe('head1');
    expect(gh.commits).toEqual([]);
    expect(db.states).toEqual([null]);
  });

  it('writes app answers back in one commit, with the history row, then marks them', async () => {
    const gh = fakeGithub({
      'por-decidir/seo-a.yaml': decisionYaml('a'),
      'por-decidir/seo-b.yaml': decisionYaml('b'),
      'agentes/historial-decisiones.csv': 'fecha,agente,tipo,decision,con_nota,dias,id\n',
    });
    const db = store([appAnswered('seo-a'), appAnswered('seo-b')]);
    const r = await syncOrg({ store: db.s, tokens: async () => 'tok', forgejo: null, fetch: gh.f }, ORG);
    expect(r.ok).toBe(true);
    expect(gh.commits).toHaveLength(1);
    expect(gh.commits[0]!.message).toBe('por-decidir: respuestas desde Ghostaff (seo-a, seo-b)');
    expect(gh.commits[0]!.files['por-decidir/seo-a.yaml']).toContain('decision: ok');
    expect(gh.commits[0]!.files['agentes/historial-decisiones.csv']!.trim().split('\n')).toHaveLength(3);
    expect(db.written).toEqual(['row-seo-a', 'row-seo-b']);
  });

  it('leaves the write-back for the next tick when someone pushed meanwhile', async () => {
    const gh = fakeGithub({ 'por-decidir/seo-a.yaml': decisionYaml('a') }, { moved: true });
    const db = store([appAnswered('seo-a')]);
    const r = await syncOrg({ store: db.s, tokens: async () => 'tok', forgejo: null, fetch: gh.f }, ORG);
    expect(r.ok).toBe(true);
    expect(r.summary).toContain('the record moved');
    expect(db.written).toEqual([]);
  });

  it('records a failure on the organisation instead of throwing', async () => {
    const db = store();
    const r = await syncOrg({ store: db.s, tokens: async () => Promise.reject(new Error('no installation')), forgejo: null, fetch: fakeGithub({}).f }, ORG);
    expect(r.ok).toBe(false);
    expect(db.states).toEqual(['no installation']);
  });

  it("reads each agent's AGENTS.md into its task, the record winning, and lets go of one whose file went", async () => {
    const gh = fakeGithub({ 'agentes/legal/AGENTS.md': '# Legal\nRevisa la ley.\n', 'agentes/seo/AGENTS.md': 'igual' });
    const agents: InstructedAgent[] = [
      { id: 'a-legal', slug: 'legal', task: 'del YAML', taskInRecord: false },
      { id: 'a-seo', slug: 'seo', task: 'igual', taskInRecord: true },
      { id: 'a-correo', slug: 'correo', task: 'antes del record', taskInRecord: true },
      { id: 'a-finanzas', slug: 'finanzas', task: 'del YAML', taskInRecord: false },
    ];
    const db = store([], agents);
    const r = await syncOrg({ store: db.s, tokens: async () => 'tok', forgejo: null, fetch: gh.f }, ORG);
    expect(r.ok).toBe(true);
    expect(db.instructions).toEqual([
      ['a-legal', { task: '# Legal\nRevisa la ley.\n', inRecord: true }],
      ['a-correo', { inRecord: false }],
    ]);
    expect(r.summary).toContain('legal: instructions from the record');
    expect(gh.commits).toEqual([]);
  });

  it('leaves out instructions too long for the row, and says so', async () => {
    const gh = fakeGithub({ 'agentes/legal/AGENTS.md': 'x'.repeat(40001) });
    const db = store([], [{ id: 'a-legal', slug: 'legal', task: 'del YAML', taskInRecord: false }]);
    const r = await syncOrg({ store: db.s, tokens: async () => 'tok', forgejo: null, fetch: gh.f }, ORG);
    expect(db.instructions).toEqual([]);
    expect(r.summary).toContain('legal: instructions over 40000 characters');
  });

  it('an empty or missing por-decidir closes nothing that is not there and syncs fine', async () => {
    const gh = fakeGithub({ 'README.md': 'x' });
    const db = store();
    const r = await syncOrg({ store: db.s, tokens: async () => 'tok', forgejo: null, fetch: gh.f }, ORG);
    expect(r.ok).toBe(true);
    expect(db.applied[0]!.upserts).toEqual([]);
  });
});

describe('openDecision', () => {
  it('commits the agent\'s decision under a free id, syncs, and points the row at the agent', async () => {
    const gh = fakeGithub({ 'por-decidir/redes-cuando.yaml': decisionYaml('x') });
    const db = store();
    const pointed: string[] = [];
    db.s.pointDecision = async (_org, recordId, agentId) => {
      pointed.push(`${recordId}:${agentId}`);
      return 'row-9';
    };
    const r = await openDecision(
      { store: db.s, tokens: async () => 'tok', forgejo: null, fetch: gh.f },
      { orgId: ORG.id, agentId: 'agent-1', base: 'redes-cuando', decision: (id) => decisionYaml(id) },
    );
    expect(r).toEqual({ decisionId: 'row-9', recordId: 'redes-cuando-2' });
    expect(Object.keys(gh.commits[0]!.files)).toEqual(['por-decidir/redes-cuando-2.yaml']);
    expect(db.applied).toHaveLength(1);
    expect(pointed).toEqual(['redes-cuando-2:agent-1']);
  });

  it('returns null for an organisation without a record it reaches', async () => {
    const db = store();
    db.s.orgWithRecord = async () => null;
    expect(await openDecision({ store: db.s, tokens: null, forgejo: null }, { orgId: 'x', agentId: 'a', base: 'b', decision: () => '' })).toBeNull();
  });
});

describe('the GitHub App', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  it('signs its JWT with its key, issued for its id', () => {
    const jwt = appJwt({ appId: '42', privateKey: pem }, 1_700_000_000_000);
    const [h, p, sig] = jwt.split('.') as [string, string, string];
    const v = createVerify('RSA-SHA256');
    v.update(`${h}.${p}`);
    expect(v.verify(createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })), Buffer.from(sig, 'base64url'))).toBe(true);
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload).toEqual({ iss: '42', iat: 1_699_999_940, exp: 1_700_000_540 });
  });

  it('asks for a token for the one repo, and reuses it until near expiry', async () => {
    const asked: unknown[] = [];
    let now = Date.parse('2026-11-21T10:00:00Z');
    const f = (async (_url: string, init?: RequestInit) => {
      asked.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ token: `t${asked.length}`, expires_at: '2026-11-21T11:00:00Z' }), { status: 201 });
    }) as typeof fetch;
    const tokens = repoTokens(async () => ({ appId: '42', privateKey: pem }), f, () => now);
    expect(await tokens(7, 'ordago-app/business')).toBe('t1');
    expect(await tokens(7, 'ordago-app/business')).toBe('t1');
    now = Date.parse('2026-11-21T10:56:00Z');
    expect(await tokens(7, 'ordago-app/business')).toBe('t2');
    expect(asked[0]).toEqual({ repositories: ['business'], permissions: { contents: 'write', metadata: 'read' } });
  });

  it('mints a new token every time for an agent run, with when it expires', async () => {
    let n = 0;
    const f = (async () => {
      n += 1;
      return new Response(JSON.stringify({ token: `t${n}`, expires_at: '2026-11-21T11:00:00Z' }), { status: 201 });
    }) as typeof fetch;
    const fresh = freshRepoToken(async () => ({ appId: '42', privateKey: pem }), f);
    expect(await fresh(7, 'ordago-app/business')).toEqual({ token: 't1', expiresAt: '2026-11-21T11:00:00Z' });
    expect((await fresh(7, 'ordago-app/business')).token).toBe('t2');
  });

  it('a token for a repo an agent only reads may read its contents and nothing more', async () => {
    const asked: unknown[] = [];
    const f = (async (_url: string, init?: RequestInit) => {
      asked.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ token: 't1', expires_at: '2026-11-21T11:00:00Z' }), { status: 201 });
    }) as typeof fetch;
    await freshRepoToken(async () => ({ appId: '42', privateKey: pem }), f)(7, 'ordago-app/ordago-apps', 'read');
    expect(asked[0]).toEqual({ repositories: ['ordago-apps'], permissions: { contents: 'read', metadata: 'read' } });
  });
});

describe('POST /cron', () => {
  const app = (ticks: string[]) =>
    createApp({
      store: {} as never,
      vault: {} as never,
      checks: {} as never,
      userFromToken: async () => null,
      chat: {} as never,
      accounts: { publicUrl: 'https://engine' } as never,
      actions: {} as never,
      cron: {
        callerFromToken: async (t, aud) => (aud === 'https://engine' && t === 'google-id' ? 'scheduler@p.iam.gserviceaccount.com' : t === 'other' ? 'x@p.iam' : null),
        audience: 'https://engine',
        callers: ['scheduler@p.iam.gserviceaccount.com'],
        tick: async () => {
          ticks.push('tick');
          return { synced: [] };
        },
      },
    });

  it('ticks for the scheduler', async () => {
    const ticks: string[] = [];
    const res = await app(ticks).request('/cron', { method: 'POST', headers: { Authorization: 'Bearer google-id' } });
    expect(res.status).toBe(200);
    expect(ticks).toEqual(['tick']);
  });

  it('refuses anyone else, and a person signed in', async () => {
    const ticks: string[] = [];
    for (const token of ['other', 'token-ana', '']) {
      const res = await app(ticks).request('/cron', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      expect(res.status).toBe(401);
    }
    expect(ticks).toEqual([]);
  });
});
