import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { Checks, ConnectionRecord, Membership, Store } from '../src/connections';
import { checkAnthropicKey, checkVertexProject } from '../src/providers';
import { MemoryVault, secretName } from '../src/vault';

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
    upsert: async (r) => {
      rows.set(`${r.org_id}/${r.provider}`, r);
      return { ...r };
    },
    remove: async (o, p) => {
      rows.delete(`${o}/${p}`);
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
    chat: { chat: {} as never, writerFor: async () => async () => {} },
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
    expect(await vault.get(secretName(ORG, 'anthropic'))).toBe(ANTHROPIC_KEY);
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
    expect(rows.get(`${ORG}/vertex`)).toMatchObject({ method: 'cloud_project', hint: 'panaderia-ai', settings: { project: 'panaderia-ai', region: 'europe-west1' } });
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
