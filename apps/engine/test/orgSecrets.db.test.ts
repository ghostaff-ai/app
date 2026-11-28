// The keys' store against a real Postgres, skipped unless one is given (CI has none). Approving a
// member's value is a conditional update on its `pending_at`; this checks the database takes the
// timestamp the store read back as the one to compare. Against the local Supabase (`pnpm db:start`):
//
//   eval "$(npx supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
//   SUPABASE_TEST_URL=$API_URL SUPABASE_TEST_SERVICE_KEY=$SERVICE_ROLE_KEY \
//     pnpm --filter @ghostaff/engine exec vitest run test/orgSecrets.db.test.ts
//
// It makes its own organisation and people, and removes them after.

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { approveSecret, rejectSecret, removeSecret, replaceSecret, storeSecret, supabaseOrgSecretStore } from '../src/orgSecrets';
import { supabaseRunnerStore } from '../src/jobsStore';
import { agentSecretName, MemoryVault, pendingSecretName } from '../src/vault';

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_SERVICE_KEY;

describe.skipIf(!url || !key)('the keys’ store, on Postgres', () => {
  let admin: SupabaseClient;
  const orgId = randomUUID();
  const users = { owner: '', member: '' };
  const vault = new MemoryVault();
  const deps = () => ({ store: supabaseOrgSecretStore(admin), vault });

  beforeAll(async () => {
    admin = createClient(url!, key!, { auth: { persistSession: false } });
    for (const who of ['owner', 'member'] as const) {
      const { data, error } = await admin.auth.admin.createUser({ email: `${who}-${orgId}@example.test`, email_confirm: true });
      if (error) throw error;
      users[who] = data.user.id;
    }
    const org = await admin.from('organizations').insert({ id: orgId, slug: `k-${orgId.slice(0, 8)}`, name: 'Claves' });
    if (org.error) throw org.error;
    const m = await admin.from('memberships').insert([
      { org_id: orgId, user_id: users.owner, role: 'owner', display_name: 'Ana' },
      { org_id: orgId, user_id: users.member, role: 'member', display_name: 'Bea' },
    ]);
    if (m.error) throw m.error;
  });

  afterAll(async () => {
    await admin.from('organizations').delete().eq('id', orgId);
    for (const id of Object.values(users)) if (id) await admin.auth.admin.deleteUser(id);
  });

  it('stores, waits, approves, replaces, rejects and removes, as the memory store does', async () => {
    const made = await storeSecret(deps(), users.member, orgId, { label: 'ElevenLabs', name: 'elevenlabs', value: 'sk_eleven_first_value' });
    expect(made).toMatchObject({ stored_at: null, pending_by_name: 'Bea' });
    await expect(storeSecret(deps(), users.owner, orgId, { label: 'Otra', name: 'elevenlabs', value: 'sk_eleven_other_value' })).rejects.toMatchObject({ code: 'exists' });

    expect(await approveSecret(deps(), users.owner, orgId, 'elevenlabs')).toEqual({ status: 'approved' });
    expect(await vault.get(agentSecretName(orgId, 'elevenlabs'))).toBe('sk_eleven_first_value');
    const approved = await admin.from('org_secrets').select('stored_by, stored_by_name, pending_at').eq('org_id', orgId).eq('name', 'elevenlabs').single();
    expect(approved.data).toEqual({ stored_by: users.member, stored_by_name: 'Bea', pending_at: null });

    await replaceSecret(deps(), users.member, orgId, 'elevenlabs', { value: 'sk_eleven_second_value' });
    await rejectSecret(deps(), users.owner, orgId, 'elevenlabs');
    expect(await vault.get(pendingSecretName(orgId, 'elevenlabs'))).toBeNull();
    expect(await vault.get(agentSecretName(orgId, 'elevenlabs'))).toBe('sk_eleven_first_value');

    await removeSecret(deps(), users.owner, orgId, 'elevenlabs');
    expect((await admin.from('org_secrets').select('id').eq('org_id', orgId)).data).toEqual([]);
  });

  it('refuses to approve a value newer than the one read', async () => {
    const store = supabaseOrgSecretStore(admin);
    await storeSecret(deps(), users.member, orgId, { label: 'Meta', name: 'meta-token', value: 'EAAB_first_value' });
    const read = await store.find(orgId, 'meta-token');
    expect(await store.update(orgId, 'meta-token', { label: 'Meta' }, { pendingAt: read!.pending_at })).not.toBeNull();
    expect(await store.update(orgId, 'meta-token', { label: 'Meta' }, { pendingAt: '2020-01-01T00:00:00.000Z' })).toBeNull();
    await rejectSecret(deps(), users.owner, orgId, 'meta-token');
  });

  it('a run notes what it got, and what it missed only on a stored key', async () => {
    await storeSecret(deps(), users.owner, orgId, { label: 'Correo', name: 'correo-info', value: 'password-info-1' });
    await storeSecret(deps(), users.member, orgId, { label: 'Gmail', name: 'correo-gmail', value: 'password-gmail-1' });
    await supabaseRunnerStore(admin).noteSecrets(orgId, ['correo-info'], ['correo-gmail', 'not-a-row']);
    const { data } = await admin.from('org_secrets').select('name, status, last_used_at').eq('org_id', orgId).order('name');
    expect(data).toEqual([
      { name: 'correo-gmail', status: 'ok', last_used_at: null },
      { name: 'correo-info', status: 'ok', last_used_at: expect.any(String) },
    ]);
    await supabaseRunnerStore(admin).noteSecrets(orgId, [], ['correo-info']);
    expect((await admin.from('org_secrets').select('status').eq('org_id', orgId).eq('name', 'correo-info').single()).data).toEqual({ status: 'missing' });
  });
});
