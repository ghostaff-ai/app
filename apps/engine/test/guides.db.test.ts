// The guides' and guided accesses' stores against a real Postgres, skipped
// unless one is given (CI has none). Every move of a guide is a conditional
// update; this checks the database takes each condition as the memory stores in
// guides.test.ts assume. Against the local Supabase (`pnpm db:start`):
//
//   eval "$(npx supabase status -o env | grep -E '^(API_URL|SERVICE_ROLE_KEY)=')"
//   SUPABASE_TEST_URL=$API_URL SUPABASE_TEST_SERVICE_KEY=$SERVICE_ROLE_KEY \
//     pnpm --filter @ghostaff/engine exec vitest run test/guides.db.test.ts
//
// It makes its own organisation, people, agent, thread and message, and removes them after.

import { randomUUID } from 'node:crypto';
import type { GuideLanding, GuidePart, MessagePart } from '@ghostaff/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { supabaseGuidedStore } from '../src/guidedAccounts';
import { supabaseGuideStore } from '../src/guides';

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_SERVICE_KEY;

const landing: GuideLanding = { auth: 'basic', suffix: '/wp-json', check: { path: '/wp/v2/users/me' } };

describe.skipIf(!url || !key)('guides and guided accesses, on Postgres', () => {
  let admin: SupabaseClient;
  const orgId = randomUUID();
  const agentId = randomUUID();
  const threadId = randomUUID();
  const messageId = randomUUID();
  const users: { owner: string; member: string } = { owner: '', member: '' };

  const check = <T>(r: { data: T; error: unknown }): T => {
    if (r.error) throw r.error;
    return r.data;
  };

  beforeAll(async () => {
    admin = createClient(url!, key!, { auth: { persistSession: false } });
    for (const who of ['owner', 'member'] as const) {
      const { data, error } = await admin.auth.admin.createUser({ email: `${who}-${orgId}@example.test`, email_confirm: true });
      if (error) throw error;
      users[who] = data.user.id;
    }
    check(await admin.from('organizations').insert({ id: orgId, slug: `t${orgId.slice(0, 8)}`, name: 'Prueba' }));
    check(
      await admin.from('memberships').insert([
        { org_id: orgId, user_id: users.owner, role: 'owner', display_name: 'Ana' },
        { org_id: orgId, user_id: users.member, role: 'member', display_name: 'Luis' },
      ]),
    );
    check(await admin.from('agents').insert({ id: agentId, org_id: orgId, name: 'Redes', ghost: 'redes', department: 'marketing' }));
    check(await admin.from('threads').insert({ id: threadId, org_id: orgId, agent_id: agentId, title: 'Web', visibility: 'write' }));
    const card: GuidePart = { type: 'guide', guideId: 'pending', app: 'WordPress', why: 'Para publicar', status: 'open' };
    check(
      await admin.from('messages').insert({
        id: messageId,
        thread_id: threadId,
        org_id: orgId,
        author_kind: 'agent',
        author_agent: agentId,
        author_name: 'Redes',
        parts: [{ type: 'text', text: 'Necesito acceso.' }, card],
        state: 'done',
      }),
    );
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.from('organizations').delete().eq('id', orgId);
    for (const id of Object.values(users)) if (id) await admin.auth.admin.deleteUser(id);
  });

  it('a guide moves only while it is what the move expects: on its status, its last change, and not gone on', async () => {
    const store = supabaseGuideStore(admin);
    const id = await store.create({ orgId, threadId, messageId, agentId, app: 'WordPress', goal: 'Publicar en tu web', why: 'Para publicar', landing, startedBy: users.member });
    const fresh = await store.guide(id);
    expect(fresh).toMatchObject({ id, status: 'open', messageState: 'done', resumedAt: null, landing });

    // On status.
    expect(await store.update(id, { status: 'checked' }, { undo: 'x' })).toBe(false);
    // On updated_at: the value as read moves it once; the same stale value no longer does.
    expect(await store.update(id, { status: 'open', updatedAt: fresh!.updatedAt }, { history: [{ type: 'photo' }] })).toBe(true);
    expect(await store.update(id, { status: 'open', updatedAt: fresh!.updatedAt }, { history: [] })).toBe(false);
    const stepped = await store.guide(id);
    expect(stepped?.history).toEqual([{ type: 'photo' }]);
    expect(stepped?.updatedAt).not.toBe(fresh?.updatedAt);

    // A member's check, then pending for owners with who did it and when.
    const at = new Date().toISOString();
    expect(
      await store.update(
        id,
        { status: 'open', updatedAt: stepped!.updatedAt },
        { status: 'checked', completedBy: users.member, history: [{ type: 'photo' }, { type: 'checked', base: 'https://miweb.com/wp-json', at }] },
      ),
    ).toBe(true);
    expect(await store.pending(orgId)).toEqual([{ id, app: 'WordPress', agentId, agentName: 'Redes', completedByName: 'Luis', checkedAt: at }]);

    // Approved: no longer pending.
    expect(await store.update(id, { status: 'checked' }, { status: 'done', decidedBy: users.owner })).toBe(true);
    expect(await store.pending(orgId)).toEqual([]);
    const done = await store.guide(id);

    // The resume claim: once, and without touching updated_at (R23).
    expect(await store.claimResume(id)).toBe(true);
    expect(await store.claimResume(id)).toBe(false);
    const claimed = await store.guide(id);
    expect(claimed?.resumedAt).toEqual(expect.any(String));
    expect(claimed?.updatedAt).toBe(done?.updatedAt);
    // A move on condition of not gone on is refused now.
    expect(await store.update(id, { status: 'done', notResumed: true }, { status: 'checked' })).toBe(false);
    // The closing step, saved on the updated_at read before the claim, still goes in.
    expect(await store.update(id, { status: 'done', updatedAt: done!.updatedAt }, { undo: 'Quita el usuario redes en WordPress.' })).toBe(true);
    // Released, it can be claimed again.
    await store.releaseResume(id);
    expect((await store.guide(id))?.resumedAt).toBeNull();
    expect(await store.claimResume(id)).toBe(true);
  });

  it('the card changes in its message, and a handover adds the account\'s card after it in the same write', async () => {
    const store = supabaseGuideStore(admin);
    const ask: MessagePart = { type: 'account_ask', askId: randomUUID(), name: 'WordPress.com', why: 'Para publicar', need: 'connect', status: 'open', connector: 'wordpress' };
    await store.updateCard(messageId, 'pending', { status: 'handed_over', connector: 'wordpress' }, ask);
    const parts = (check(await admin.from('messages').select('parts').eq('id', messageId).single()) as { parts: MessagePart[] }).parts;
    expect(parts).toEqual([
      { type: 'text', text: 'Necesito acceso.' },
      { type: 'guide', guideId: 'pending', app: 'WordPress', why: 'Para publicar', status: 'handed_over', connector: 'wordpress' },
      ask,
    ]);
  });

  it('a guided access is inserted, replaced for the same agent and app (naming the guide it replaced), found and deleted', async () => {
    const accesses = supabaseGuidedStore(admin);
    const [first, second] = [randomUUID(), randomUUID()];
    const access = (guideId: string, hint: string) => ({
      orgId,
      agentId,
      provider: 'xwordpress',
      hint,
      settings: { base: 'https://miweb.com/wp-json', auth: 'basic' as const, app: 'WordPress', guideId },
      connectedBy: users.member,
      connectedByName: 'Luis',
    });

    const made = await accesses.createAccess(access(first, 'redes'));
    expect(made.replacedGuideId).toBeNull();
    expect(await accesses.accesses(orgId, agentId)).toMatchObject([{ id: made.id, agentId, provider: 'xwordpress', hint: 'redes', status: 'ok' }]);

    const replaced = await accesses.createAccess(access(second, 'redes2'));
    expect(replaced).toEqual({ id: made.id, replacedGuideId: first });
    expect(await accesses.accesses(orgId, agentId)).toMatchObject([{ id: made.id, hint: 'redes2', settings: { guideId: second } }]);
    expect(await accesses.find(made.id)).toEqual({ orgId, guideId: second, app: 'WordPress' });

    await accesses.removeAccess(made.id);
    expect(await accesses.find(made.id)).toBeNull();
    expect(await accesses.accesses(orgId, agentId)).toEqual([]);
  });
});
