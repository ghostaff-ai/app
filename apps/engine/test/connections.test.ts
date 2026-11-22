import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Checks, ConnectionRecord, Membership, Store } from '../src/connections';
import { checkAnthropicKey, checkVertexProject } from '../src/providers';
import { NO_TOOLS } from '../src/tools';
import { aiSecretName, legacyAiSecretName, MemoryVault } from '../src/vault';

const ORG = '10000000-0000-0000-0000-000000000001';
const OTHER = '10000000-0000-0000-0000-000000000002';
const ANA = 'ana'; // owner of ORG
const BEA = 'bea'; // member of ORG
const CARLA = 'carla'; // owner of OTHER
const ANTHROPIC_KEY = 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1234';

function setup(checks: Partial<Checks> = {}) {
  const members: Record<string, Membership> = {
    [`${ORG}/${ANA}`]: { role: 'owner', displayName: 'Ana' },
    [`${ORG}/${BEA}`]: { role: 'member', displayName: 'Bea' },
    [`${OTHER}/${CARLA}`]: { role: 'owner', displayName: 'Carla' },
  };
  const rows = new Map<string, ConnectionRecord>();
  const store: Store = {
    membership: async (o, u) => members[`${o}/${u}`] ?? null,
    insert: async (r) => {
      rows.set(r.id, r);
      return { ...r };
    },
    aiConnections: async (o) => [...rows.values()].filter((r) => r.org_id === o).map((r) => ({ id: r.id, provider: r.provider })),
    remove: async (o, id) => {
      if (rows.get(id)?.org_id === o) rows.delete(id);
    },
  };
  const vault = new MemoryVault();
  const ok = async () => ({ ok: true as const });
  const app = createApp({
    store,
    vault,
    checks: { anthropic: ok, openai: ok, vertex: ok, ...checks },
    userFromToken: async (t) => (t.startsWith('token-') ? t.slice(6) : null),
    serviceAccount: 'engine@ghostaff-prod.iam.gserviceaccount.com',
    now: () => new Date('2026-11-14T10:00:00Z'),
    chat: { chat: {} as never, writerFor: async () => async () => {}, toolsFor: async () => NO_TOOLS },
    accounts: {} as never,
    actions: {} as never,
  });
  const call = (user: string | null, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { ...(user ? { Authorization: `Bearer token-${user}` } : {}), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  return { app, rows, vault, call };
}

describe('connecting an AI key', () => {
  it('an owner connects: the key goes to the vault, the row keeps only its last 4 characters', async () => {
    const { rows, vault, call } = setup();
    const res = await call(ANA, 'POST', '/connections/ai', { orgId: ORG, provider: 'anthropic', apiKey: ` ${ANTHROPIC_KEY} ` });
    expect(res.status).toBe(201);
    const { connection } = (await res.json()) as { connection: ConnectionRecord };
    expect(connection).toMatchObject({ provider: 'anthropic', method: 'api_key', hint: '1234', connected_by_name: 'Ana' });
    expect(JSON.stringify(connection)).not.toContain(ANTHROPIC_KEY);
    expect(JSON.stringify([...rows.values()])).not.toContain(ANTHROPIC_KEY);
    expect(await vault.get(aiSecretName(ORG, connection.id))).toBe(ANTHROPIC_KEY);
  });

  it('a member who is not an owner cannot, and nothing is stored', async () => {
    const { rows, vault, call } = setup();
    const res = await call(BEA, 'POST', '/connections/ai', { orgId: ORG, provider: 'anthropic', apiKey: ANTHROPIC_KEY });
    expect(res.status).toBe(403);
    expect(rows.size).toBe(0);
    expect(vault.secrets.size).toBe(0);
  });

  it("another organisation's owner gets the same answer as a stranger", async () => {
    const { call } = setup();
    const res = await call(CARLA, 'POST', '/connections/ai', { orgId: ORG, provider: 'anthropic', apiKey: ANTHROPIC_KEY });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('not_owner');
  });

  it('without a sign-in, nothing', async () => {
    const { call } = setup();
    expect((await call(null, 'POST', '/connections/ai', { orgId: ORG, provider: 'anthropic', apiKey: ANTHROPIC_KEY })).status).toBe(401);
    expect((await call(null, 'GET', '/identity')).status).toBe(401);
  });

  it('a key the provider rejects is not stored', async () => {
    const { rows, vault, call } = setup({ anthropic: async () => ({ ok: false, reason: 'invalid', detail: 'x' }) });
    const res = await call(ANA, 'POST', '/connections/ai', { orgId: ORG, provider: 'anthropic', apiKey: ANTHROPIC_KEY });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_key');
    expect(rows.size).toBe(0);
    expect(vault.secrets.size).toBe(0);
  });

  it("a key in the wrong provider's format is refused before calling anyone", async () => {
    let called = false;
    const { call } = setup({ anthropic: async () => ((called = true), { ok: true }) });
    const res = await call(ANA, 'POST', '/connections/ai', { orgId: ORG, provider: 'anthropic', apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz' });
    expect(res.status).toBe(400);
    expect(called).toBe(false);
  });

  it('disconnecting deletes the key from the vault and the row', async () => {
    const { rows, vault, call } = setup();
    await call(ANA, 'POST', '/connections/ai', { orgId: ORG, provider: 'anthropic', apiKey: ANTHROPIC_KEY });
    expect((await call(BEA, 'DELETE', `/connections/ai/anthropic?org=${ORG}`)).status).toBe(403);
    expect((await call(ANA, 'DELETE', `/connections/ai/anthropic?org=${ORG}`)).status).toBe(200);
    expect(rows.size).toBe(0);
    expect(vault.secrets.size).toBe(0);
  });

  it('a Claude subscription cannot be pasted in, only signed into; disconnecting it deletes its token', async () => {
    const { rows, vault, call } = setup();
    const res = await call(ANA, 'POST', '/connections/ai', { orgId: ORG, provider: 'claude', apiKey: ANTHROPIC_KEY });
    expect(res.status).toBe(400);
    expect(vault.secrets.size).toBe(0);
    // Connected before several accounts were allowed: its token is under the provider's name.
    await vault.put(legacyAiSecretName(ORG, 'claude'), 'sk-ant-oat01-x', {});
    rows.set('old', { id: 'old', org_id: ORG, provider: 'claude' } as ConnectionRecord);
    expect((await call(BEA, 'DELETE', `/connections/ai/claude?org=${ORG}`)).status).toBe(403);
    expect((await call(ANA, 'DELETE', `/connections/ai/claude?org=${ORG}`)).status).toBe(200);
    expect(rows.size).toBe(0);
    expect(vault.secrets.size).toBe(0);
  });

  it('a second key of the same provider is another account, with its own secret; each is removed by its id', async () => {
    const { rows, vault, call } = setup();
    const second = ANTHROPIC_KEY.replace('1234', '5678');
    const a = (await (await call(ANA, 'POST', '/connections/ai', { orgId: ORG, provider: 'anthropic', apiKey: ANTHROPIC_KEY })).json()) as {
      connection: ConnectionRecord;
    };
    const b = (await (await call(ANA, 'POST', '/connections/ai', { orgId: ORG, provider: 'anthropic', apiKey: second })).json()) as {
      connection: ConnectionRecord;
    };
    expect(a.connection.id).not.toBe(b.connection.id);
    expect(rows.size).toBe(2);
    expect(await vault.get(aiSecretName(ORG, a.connection.id))).toBe(ANTHROPIC_KEY);
    expect(await vault.get(aiSecretName(ORG, b.connection.id))).toBe(second);
    // Naming the provider no longer says which one.
    expect((await call(ANA, 'DELETE', `/connections/ai/anthropic?org=${ORG}`)).status).toBe(409);
    expect((await call(CARLA, 'DELETE', `/connections/ai/${a.connection.id}?org=${ORG}`)).status).toBe(403);
    expect((await call(ANA, 'DELETE', `/connections/ai/${a.connection.id}?org=${OTHER}`)).status).toBe(403);
    expect((await call(ANA, 'DELETE', `/connections/ai/${a.connection.id}?org=${ORG}`)).status).toBe(200);
    expect([...rows.keys()]).toEqual([b.connection.id]);
    expect(await vault.get(aiSecretName(ORG, a.connection.id))).toBeNull();
    expect(await vault.get(aiSecretName(ORG, b.connection.id))).toBe(second);
    expect((await call(ANA, 'DELETE', `/connections/ai/${a.connection.id}?org=${ORG}`)).status).toBe(404);
  });

  it('removing a new account keeps the old one’s secret, named after its provider', async () => {
    const { rows, vault, call } = setup();
    await vault.put(legacyAiSecretName(ORG, 'anthropic'), 'old-key', {});
    rows.set('old', { id: 'old', org_id: ORG, provider: 'anthropic' } as ConnectionRecord);
    const b = (await (await call(ANA, 'POST', '/connections/ai', { orgId: ORG, provider: 'anthropic', apiKey: ANTHROPIC_KEY })).json()) as {
      connection: ConnectionRecord;
    };
    expect((await call(ANA, 'DELETE', `/connections/ai/${b.connection.id}?org=${ORG}`)).status).toBe(200);
    expect(await vault.get(legacyAiSecretName(ORG, 'anthropic'))).toBe('old-key');
  });

  it('an unexpected failure never echoes the request', async () => {
    const { app } = setup({
      anthropic: async () => {
        throw new Error(`boom ${ANTHROPIC_KEY}`);
      },
    });
    const res = await app.request('/connections/ai', {
      method: 'POST',
      headers: { Authorization: `Bearer token-${ANA}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: ORG, provider: 'anthropic', apiKey: ANTHROPIC_KEY }),
    });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(ANTHROPIC_KEY);
  });
});

describe('connecting a Google Cloud project', () => {
  it('stores the project and region, and nothing in the vault', async () => {
    const { rows, vault, call } = setup();
    const res = await call(ANA, 'POST', '/connections/ai', { orgId: ORG, provider: 'vertex', project: 'panaderia-ai', region: 'europe-west1' });
    expect(res.status).toBe(201);
    expect([...rows.values()].find((r) => r.provider === 'vertex')).toMatchObject({ method: 'cloud_project', hint: 'panaderia-ai', settings: { project: 'panaderia-ai', region: 'europe-west1' } });
    expect(vault.secrets.size).toBe(0);
  });

  it('refuses a region outside the EU', async () => {
    const { call } = setup();
    const res = await call(ANA, 'POST', '/connections/ai', { orgId: ORG, provider: 'vertex', project: 'panaderia-ai', region: 'us-east5' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('bad_region');
  });

  it('shows the service account to grant access to', async () => {
    const { call } = setup();
    expect(await (await call(ANA, 'GET', '/identity')).json()).toEqual({ serviceAccount: 'engine@ghostaff-prod.iam.gserviceaccount.com' });
  });
});

describe('provider checks', () => {
  it('reads 401 as a wrong key and 403 as no access', async () => {
    const answer = (status: number) => (async () => new Response('', { status })) as unknown as typeof fetch;
    expect(await checkAnthropicKey(ANTHROPIC_KEY, answer(200))).toEqual({ ok: true });
    expect(await checkAnthropicKey(ANTHROPIC_KEY, answer(401))).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await checkAnthropicKey(ANTHROPIC_KEY, answer(403))).toMatchObject({ ok: false, reason: 'no_access' });
    expect(await checkAnthropicKey(ANTHROPIC_KEY, answer(529))).toMatchObject({ ok: false, reason: 'unavailable' });
  });

  it('a project only passes when Google says we hold the permission', async () => {
    expect(await checkVertexProject('p-ai-123', async () => ({ status: 200, data: { permissions: ['aiplatform.endpoints.predict'] } }))).toEqual({ ok: true });
    expect(await checkVertexProject('p-ai-123', async () => ({ status: 200, data: {} }))).toMatchObject({ ok: false, reason: 'no_access' });
    expect(await checkVertexProject('p-ai-123', async () => ({ status: 403, data: {} }))).toMatchObject({ ok: false, reason: 'no_access' });
  });
});
