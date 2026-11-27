import { describe, expect, it } from 'vitest';
import { type Gcloud, putSecret, registeredRow, secretValue, storedRow, vaultCreatedAt, vaultProjectFor } from '../src/secrets';

/** A fake gcloud: Secret Manager as a map of secrets to their enabled versions; every call recorded, with what came on stdin. */
function fakeGcloud(existing: Record<string, string[]> = {}, opts: { addPrints?: string } = {}) {
  const secrets = new Map(Object.entries(existing).map(([k, v]) => [k, [...v]]));
  const calls: { args: string[]; input?: string }[] = [];
  const run: Gcloud = (args, input) => {
    calls.push({ args, input });
    const id = args[0] === 'secrets' && args[1] === 'versions' ? (args[2] === 'destroy' ? args[args.indexOf('--secret') + 1]! : args[3]!) : args[2]!;
    const versions = secrets.get(id);
    if (args[1] === 'describe') {
      if (!versions) throw new Error('NOT_FOUND');
      return `projects/p/secrets/${id}\n`;
    }
    if (args[1] === 'create') {
      secrets.set(id, []);
      return '';
    }
    if (args[2] === 'add') {
      const next = String(Math.max(0, ...versions!.map(Number)) + 1);
      versions!.push(next);
      return `${opts.addPrints ?? next}\n`;
    }
    if (args[2] === 'list') return versions!.map((v) => `${v}\n`).join('');
    if (args[2] === 'destroy') {
      versions!.splice(versions!.indexOf(args[3]!), 1);
      return '';
    }
    throw new Error(`unexpected gcloud ${args.join(' ')}`);
  };
  return { run, calls, secrets };
}

const ID = 'org-10000000-0000-0000-0000-000000000001-secret-elevenlabs';
const put = (run: Gcloud) => putSecret(run, { project: 'ghostaff-beta', id: ID, value: 'sk_eleven_1234567890', labels: { org_id: '10000000-0000-0000-0000-000000000001', kind: 'agent-secret' } });

describe('org set-secret', () => {
  it('writes to the vault of the environment whose database the key opens, and never a local one', () => {
    expect(vaultProjectFor('https://rggvcvnstbitbdptiwtk.supabase.co')).toBe('ghostaff-beta');
    expect(vaultProjectFor('https://krhhndjjqmmkzjmwwazv.supabase.co')).toBe('ghostaff-prod');
    expect(() => vaultProjectFor('http://127.0.0.1:54321')).toThrow(/memory/);
    expect(() => vaultProjectFor('https://aaaaaaaaaaaaaaaaaaaa.supabase.co')).toThrow();
  });

  it('takes the value as piped, without its last newline, and refuses one the runner could not hide or hold', () => {
    expect(secretValue('abcd efgh ijkl mnop\n')).toBe('abcd efgh ijkl mnop');
    expect(secretValue('sk_eleven_1234567890\r\n')).toBe('sk_eleven_1234567890');
    expect(() => secretValue('corto\n')).toThrow(/8 characters/);
    expect(() => secretValue('sk_eleven\0_1234')).toThrow(/NUL/);
    expect(() => secretValue('x'.repeat(65537))).toThrow(/64 KB/);
  });

  it('creates a new secret in the EU, labelled with its organisation, the value only on stdin', () => {
    const g = fakeGcloud();
    put(g.run);
    expect(g.calls.find((c) => c.args[1] === 'create')?.args).toEqual([
      'secrets', 'create', ID, '--project', 'ghostaff-beta', '--replication-policy', 'user-managed', '--locations', 'europe-west1',
      '--labels', 'org_id=10000000-0000-0000-0000-000000000001,kind=agent-secret',
    ]);
    expect(g.calls.filter((c) => c.input === 'sk_eleven_1234567890')).toHaveLength(1);
    expect(g.calls.some((c) => c.args.join(' ').includes('sk_eleven'))).toBe(false);
    expect(g.secrets.get(ID)).toEqual(['1']);
  });

  it('replacing it leaves only the new version alive', () => {
    const g = fakeGcloud({ [ID]: ['1', '2'] });
    put(g.run);
    expect(g.calls.some((c) => c.args[1] === 'create')).toBe(false);
    expect(g.secrets.get(ID)).toEqual(['3']);
  });

  it('destroys nothing when gcloud does not say which version it added', () => {
    const g = fakeGcloud({ [ID]: ['1'] }, { addPrints: '' });
    expect(() => put(g.run)).toThrow(/older versions kept/);
    expect(g.secrets.get(ID)).toEqual(['1', '2']);
  });
});

describe('the key’s row, written with the value', () => {
  const ORG = '10000000-0000-0000-0000-000000000001';
  const AT = '2026-11-27T10:00:00.000Z';

  it('says Ghostaff stored it, now, and is healthy again', () => {
    expect(storedRow({ orgId: ORG, name: 'correo-info', existing: null, at: AT })).toEqual({
      org_id: ORG,
      name: 'correo-info',
      label: 'Correo info',
      maker: null,
      stored_by: null,
      stored_by_name: 'Ghostaff',
      stored_at: AT,
      status: 'ok',
      updated_at: AT,
    });
  });

  it('keeps the label and maker a person gave it, unless new ones are given', () => {
    const existing = { label: 'Contraseña de info@ordago.club', maker: 'imap', stored_at: '2026-11-20T10:00:00Z' };
    expect(storedRow({ orgId: ORG, name: 'correo-info', existing, at: AT })).toMatchObject({ label: 'Contraseña de info@ordago.club', maker: 'imap' });
    expect(storedRow({ orgId: ORG, name: 'correo-info', existing, at: AT, label: ' Info ', maker: 'gmail' })).toMatchObject({ label: 'Info', maker: 'gmail' });
  });

  it('refuses a label or maker the table would', () => {
    expect(() => storedRow({ orgId: ORG, name: 'x-y', existing: null, at: AT, label: 'x'.repeat(81) })).toThrow(/--label/);
    expect(() => storedRow({ orgId: ORG, name: 'x-y', existing: null, at: AT, maker: 'Eleven Labs' })).toThrow(/--maker/);
  });
});

describe('org register-secrets: the rows of secrets already in the vault', () => {
  const ORG = '10000000-0000-0000-0000-000000000001';
  const CREATED = '2026-11-25T18:03:11.123456Z';

  it('lists one stored before rows existed, as Ghostaff on the day the vault made it', () => {
    expect(registeredRow({ orgId: ORG, name: 'elevenlabs', existing: null, createdAt: CREATED, label: 'ElevenLabs', maker: 'elevenlabs', at: 'now' })).toEqual({
      org_id: ORG,
      name: 'elevenlabs',
      label: 'ElevenLabs',
      maker: 'elevenlabs',
      stored_by: null,
      stored_by_name: 'Ghostaff',
      stored_at: CREATED,
      updated_at: 'now',
    });
  });

  it('only relabels one already listed, never who stored it', () => {
    const existing = { label: 'Elevenlabs', maker: null, stored_at: '2026-11-26T10:00:00Z' };
    expect(registeredRow({ orgId: ORG, name: 'elevenlabs', existing, createdAt: CREATED, label: 'ElevenLabs', at: 'now' })).toEqual({
      org_id: ORG,
      name: 'elevenlabs',
      label: 'ElevenLabs',
      maker: null,
      updated_at: 'now',
    });
    expect(registeredRow({ orgId: ORG, name: 'elevenlabs', existing, createdAt: CREATED, at: 'now' })).toBeNull();
  });

  it('reads when the vault made the secret, or that it has none', () => {
    const g = fakeGcloud({ [ID]: ['1'] });
    const run: Gcloud = (args, input) => (args[1] === 'describe' && args.includes('value(createTime)') ? (g.secrets.has(args[2]!) ? `${CREATED}\n` : g.run(args, input)) : g.run(args, input));
    expect(vaultCreatedAt(run, 'ghostaff-beta', ID)).toBe(CREATED);
    expect(vaultCreatedAt(run, 'ghostaff-beta', `${ID}-none`)).toBeNull();
  });
});
