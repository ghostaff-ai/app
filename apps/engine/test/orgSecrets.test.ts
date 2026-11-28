import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import type { Membership } from '../src/connections';
import type { OrgSecretRecord, OrgSecretStore } from '../src/orgSecrets';
import { NO_TOOLS } from '../src/tools';
import { agentSecretName, MemoryVault, pendingSecretName } from '../src/vault';

// The organisation's keys (docs/plans/ongoing/secrets-from-the-app.md): the value goes app → engine → vault
// and nowhere else; an owner's works at once, a member's waits for an owner; only owners remove.

const ORG = '10000000-0000-0000-0000-000000000001';
const OTHER = '10000000-0000-0000-0000-000000000002';
const ANA = 'ana'; // owner of ORG
const BEA = 'bea'; // member of ORG
const CARLA = 'carla'; // owner of OTHER
const VALUE = 'sk_eleven_aaaaaaaaaaaaaaaa1234';
const NEW_VALUE = 'sk_eleven_bbbbbbbbbbbbbbbb5678';
const NOW = '2026-11-27T10:00:00.000Z';

function memoryStore(): OrgSecretStore & { rows: Map<string, OrgSecretRecord> } {
  const members: Record<string, Membership> = {
    [`${ORG}/${ANA}`]: { role: 'owner', displayName: 'Ana' },
    [`${ORG}/${BEA}`]: { role: 'member', displayName: 'Bea' },
    [`${OTHER}/${CARLA}`]: { role: 'owner', displayName: 'Carla' },
  };
  const rows = new Map<string, OrgSecretRecord>();
  const key = (o: string, n: string) => `${o}/${n}`;
  return {
    rows,
    membership: async (o, u) => members[`${o}/${u}`] ?? null,
    find: async (o, n) => (rows.has(key(o, n)) ? { ...rows.get(key(o, n))! } : null),
    insert: async (r) => {
      if (rows.has(key(r.org_id, r.name))) return null;
      const row: OrgSecretRecord = { id: `id-${r.name}`, last_used_at: null, status: 'ok', created_at: NOW, ...r };
      rows.set(key(r.org_id, r.name), row);
      return { ...row };
    },
    update: async (o, n, patch, expect) => {
      const row = rows.get(key(o, n));
      if (!row) return null;
      if (expect && row.pending_at !== expect.pendingAt) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    remove: async (o, n) => {
      rows.delete(key(o, n));
    },
  };
}

function setup() {
  const secrets = memoryStore();
  const vault = new MemoryVault();
  const app = createApp({
    store: { membership: secrets.membership } as never,
    vault,
    checks: {} as never,
    userFromToken: async (t) => (t.startsWith('token-') ? t.slice(6) : null),
    now: () => new Date(NOW),
    chat: { chat: {} as never, writerFor: async () => async () => {}, toolsFor: async () => NO_TOOLS },
    accounts: {} as never,
    actions: {} as never,
    orgSecrets: secrets,
  });
  const call = async (user: string | null, method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method,
      headers: { ...(user ? { Authorization: `Bearer token-${user}` } : {}), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text || '{}') as Record<string, any>, cache: res.headers.get('Cache-Control') };
  };
  return { secrets, vault, call };
}

const live = (name: string) => agentSecretName(ORG, name);
const waiting = (name: string) => pendingSecretName(ORG, name);

describe('adding a key', () => {
  it('an owner adds one: the value goes to the vault under the name runs read, the row keeps who and when', async () => {
    const { secrets, vault, call } = setup();
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'Clave de ElevenLabs', name: 'elevenlabs', maker: 'elevenlabs', value: VALUE });
    expect(res.status).toBe(201);
    expect(res.json.secret).toMatchObject({ name: 'elevenlabs', label: 'Clave de ElevenLabs', maker: 'elevenlabs', stored_by_name: 'Ana', stored_at: NOW, pending_at: null });
    expect(await vault.get(live('elevenlabs'))).toBe(VALUE);
    expect(vault.secrets.get(live('elevenlabs'))?.labels).toEqual({ org_id: ORG, kind: 'agent-secret' });
    expect(res.text).not.toContain(VALUE);
    expect(JSON.stringify([...secrets.rows.values()])).not.toContain(VALUE);
    expect(res.cache).toBe('no-store');
  });

  it('names it after its label when the app gives no name', async () => {
    const { vault, call } = setup();
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'Contraseña de info@panaderia.es', value: VALUE });
    expect(res.json.secret.name).toBe('contrasena-de-info-panaderia-es');
    expect(await vault.get(live('contrasena-de-info-panaderia-es'))).toBe(VALUE);
  });

  it('keeps the value as typed, but for the newline a paste adds', async () => {
    const { vault, call } = setup();
    await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'Correo', value: ` ${VALUE} \n` });
    expect(await vault.get(live('correo'))).toBe(` ${VALUE} `);
  });

  it("a member's waits for an owner, under a name no run reads", async () => {
    const { vault, call } = setup();
    const res = await call(BEA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    expect(res.status).toBe(201);
    expect(res.json.secret).toMatchObject({ stored_at: null, stored_by_name: null, pending_by_name: 'Bea', pending_at: NOW });
    expect(await vault.get(live('elevenlabs'))).toBeNull();
    expect(await vault.get(waiting('elevenlabs'))).toBe(VALUE);
  });

  it('refuses a name that is taken, and keeps the value already there', async () => {
    const { vault, call } = setup();
    await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'Otra', name: 'elevenlabs', value: NEW_VALUE });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('exists');
    expect(await vault.get(live('elevenlabs'))).toBe(VALUE);
  });

  it('gives back the name when the vault fails, so it can be tried again', async () => {
    const { secrets, vault, call } = setup();
    vi.spyOn(vault, 'put').mockRejectedValueOnce(new Error('unavailable'));
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    expect(res.status).toBe(500);
    expect(res.text).not.toContain(VALUE);
    expect(secrets.rows.size).toBe(0);
  });

  it.each([
    [{ label: 'X', value: 'corta' }, 'value_too_short'],
    [{ label: 'X', value: 'a'.repeat(65537) }, 'value_too_long'],
    [{ label: 'X', value: 'abcdefgh\u0000' }, 'value_nul'],
    [{ label: ' ', value: VALUE }, 'bad_label'],
    [{ label: 'x'.repeat(81), value: VALUE }, 'bad_label'],
    [{ label: '—', value: VALUE }, 'bad_name'],
    [{ label: 'X', name: 'Correo Info', value: VALUE }, 'bad_name'],
    [{ label: 'X', name: 'x', maker: 'Eleven Labs', value: VALUE }, 'bad_request'],
    [{ label: 'X', value: 12345678 }, 'bad_request'],
  ])('refuses %j with %s, storing nothing', async (body, code) => {
    const { secrets, vault, call } = setup();
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets`, body);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe(code);
    expect(secrets.rows.size).toBe(0);
    expect(vault.secrets.size).toBe(0);
  });

  it("another organisation's owner gets the same answer as a stranger", async () => {
    const { vault, call } = setup();
    const res = await call(CARLA, 'POST', `/orgs/${ORG}/secrets`, { label: 'X', value: VALUE });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('not_member');
    expect((await call(null, 'POST', `/orgs/${ORG}/secrets`, { label: 'X', value: VALUE })).status).toBe(401);
    expect(vault.secrets.size).toBe(0);
  });
});

describe('replacing a key', () => {
  it("an owner's new value works at once, and the row says who and when", async () => {
    const { secrets, vault, call } = setup();
    await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    secrets.rows.get(`${ORG}/elevenlabs`)!.status = 'missing';
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets/elevenlabs`, { value: NEW_VALUE });
    expect(res.status).toBe(200);
    expect(res.json.secret).toMatchObject({ stored_by_name: 'Ana', status: 'ok' });
    expect(res.text).not.toContain(NEW_VALUE);
    expect(await vault.get(live('elevenlabs'))).toBe(NEW_VALUE);
  });

  it("a member's new value waits, and the old one keeps working", async () => {
    const { vault, call } = setup();
    await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    const res = await call(BEA, 'POST', `/orgs/${ORG}/secrets/elevenlabs`, { value: NEW_VALUE });
    expect(res.json.secret).toMatchObject({ stored_by_name: 'Ana', pending_by_name: 'Bea' });
    expect(await vault.get(live('elevenlabs'))).toBe(VALUE);
    expect(await vault.get(waiting('elevenlabs'))).toBe(NEW_VALUE);
  });

  it('answers not found for a key that is not there', async () => {
    const { call } = setup();
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets/elevenlabs`, { value: NEW_VALUE });
    expect(res.status).toBe(404);
  });
});

describe("deciding a member's value", () => {
  it('an owner approves: it moves to the name runs read, and the row says the member stored it', async () => {
    const { vault, call, secrets } = setup();
    await call(BEA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets/elevenlabs/approve`);
    expect(res.status).toBe(200);
    expect(await vault.get(live('elevenlabs'))).toBe(VALUE);
    expect(await vault.get(waiting('elevenlabs'))).toBeNull();
    expect(secrets.rows.get(`${ORG}/elevenlabs`)).toMatchObject({ stored_by: BEA, stored_by_name: 'Bea', stored_at: NOW, pending_at: null, pending_by_name: null });
  });

  it('an owner turns a first value down: it leaves the vault and the row goes', async () => {
    const { vault, call, secrets } = setup();
    await call(BEA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    expect((await call(ANA, 'POST', `/orgs/${ORG}/secrets/elevenlabs/reject`)).status).toBe(200);
    expect(vault.secrets.size).toBe(0);
    expect(secrets.rows.size).toBe(0);
  });

  it('turning a replacement down keeps the stored key as it was', async () => {
    const { vault, call, secrets } = setup();
    await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    await call(BEA, 'POST', `/orgs/${ORG}/secrets/elevenlabs`, { value: NEW_VALUE });
    await call(ANA, 'POST', `/orgs/${ORG}/secrets/elevenlabs/reject`);
    expect(await vault.get(live('elevenlabs'))).toBe(VALUE);
    expect(await vault.get(waiting('elevenlabs'))).toBeNull();
    expect(secrets.rows.get(`${ORG}/elevenlabs`)).toMatchObject({ stored_by_name: 'Ana', pending_at: null });
  });

  it('a member cannot decide, and nothing moves', async () => {
    const { vault, call } = setup();
    await call(BEA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    const res = await call(BEA, 'POST', `/orgs/${ORG}/secrets/elevenlabs/approve`);
    expect(res.status).toBe(403);
    expect(res.json.error).toBe('not_owner');
    expect(await vault.get(live('elevenlabs'))).toBeNull();
  });

  it('says so when nothing waits', async () => {
    const { call } = setup();
    await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets/elevenlabs/approve`);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('nothing_pending');
  });

  it('when the waiting value is no longer in the vault, says so and clears the wait', async () => {
    const { vault, call, secrets } = setup();
    await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    await call(BEA, 'POST', `/orgs/${ORG}/secrets/elevenlabs`, { value: NEW_VALUE });
    await vault.remove(waiting('elevenlabs'));
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets/elevenlabs/approve`);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('gone');
    expect(await vault.get(live('elevenlabs'))).toBe(VALUE);
    expect(secrets.rows.get(`${ORG}/elevenlabs`)?.pending_at).toBeNull();
  });

  it('approves only the value the owner saw: a newer one that arrived meanwhile is refused', async () => {
    const { vault, call, secrets } = setup();
    await call(BEA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    const update = secrets.update;
    // Bea sends a new value between the owner's read and the approval's write.
    secrets.update = async (o, n, patch, expect) => {
      secrets.rows.get(`${o}/${n}`)!.pending_at = '2026-11-27T10:00:01.000Z';
      return update(o, n, patch, expect);
    };
    const res = await call(ANA, 'POST', `/orgs/${ORG}/secrets/elevenlabs/approve`);
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('conflict');
    expect(await vault.get(live('elevenlabs'))).toBeNull();
  });
});

describe('removing a key', () => {
  it('an owner removes it: the value and any waiting one leave the vault, and the row goes', async () => {
    const { vault, call, secrets } = setup();
    await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    await call(BEA, 'POST', `/orgs/${ORG}/secrets/elevenlabs`, { value: NEW_VALUE });
    const res = await call(ANA, 'DELETE', `/orgs/${ORG}/secrets/elevenlabs`);
    expect(res.status).toBe(200);
    expect(vault.secrets.size).toBe(0);
    expect(secrets.rows.size).toBe(0);
  });

  it('a member cannot', async () => {
    const { vault, call } = setup();
    await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    expect((await call(BEA, 'DELETE', `/orgs/${ORG}/secrets/elevenlabs`)).status).toBe(403);
    expect(await vault.get(live('elevenlabs'))).toBe(VALUE);
  });

  it('keeps the row when the vault fails, so the owner can try again', async () => {
    const { vault, call, secrets } = setup();
    await call(ANA, 'POST', `/orgs/${ORG}/secrets`, { label: 'ElevenLabs', name: 'elevenlabs', value: VALUE });
    vi.spyOn(vault, 'remove').mockRejectedValueOnce(new Error('unavailable'));
    expect((await call(ANA, 'DELETE', `/orgs/${ORG}/secrets/elevenlabs`)).status).toBe(500);
    expect(secrets.rows.size).toBe(1);
  });
});

it('the routes answer 503 where keys are off', async () => {
  const app = createApp({
    store: { membership: async () => ({ role: 'owner', displayName: 'Ana' }) } as never,
    vault: new MemoryVault(),
    checks: {} as never,
    userFromToken: async () => ANA,
    chat: { chat: {} as never, writerFor: async () => async () => {}, toolsFor: async () => NO_TOOLS },
    accounts: {} as never,
    actions: {} as never,
  });
  const res = await app.request(`/orgs/${ORG}/secrets`, { method: 'POST', headers: { Authorization: 'Bearer x' }, body: '{}' });
  expect(res.status).toBe(503);
});
