// The organisation's keys and passwords (docs/plans/ongoing/secrets-from-the-app.md): what an agent on
// our runner gets as a variable (agents.secrets), stored from the app instead of a terminal.
//
// The value goes app → engine → vault and nowhere else: it is never written to the database, logged or
// sent back. The row (org_secrets) keeps only what a person reads about it. An owner's value is live at
// once, under the name runs read (`org-<org>-secret-<name>`); a member's waits for an owner under a name
// no run reads (`org-<org>-pending-<name>`), as a guide's does (guided-access.md). Only owners decide a
// member's value and remove a key. `org set-secret` (apps/sync) writes the same row and the same secret.

import { cleanSecretValue, secretNameFromLabel, secretValueProblem } from '@ghostaff/shared';
import { isSecretName } from '@ghostaff/shared/record';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type Membership, Refusal, requireMember, requireOwner } from './connections';
import { agentSecretName, pendingSecretName, type Vault } from './vault';

/** An org_secrets row as the engine reads and writes it (service role). */
export interface OrgSecretRecord {
  id: string;
  org_id: string;
  name: string;
  label: string;
  maker: string | null;
  stored_by: string | null;
  stored_by_name: string | null;
  stored_at: string | null;
  last_used_at: string | null;
  status: 'ok' | 'missing';
  pending_by: string | null;
  pending_by_name: string | null;
  pending_at: string | null;
  created_at: string;
  updated_at: string;
}

export type NewOrgSecret = Omit<OrgSecretRecord, 'id' | 'last_used_at' | 'status' | 'created_at'>;
type Patch = Partial<Omit<OrgSecretRecord, 'id' | 'org_id' | 'name' | 'created_at'>>;

/** The database as the keys need it (service role). */
export interface OrgSecretStore {
  membership(orgId: string, userId: string): Promise<Membership | null>;
  find(orgId: string, name: string): Promise<OrgSecretRecord | null>;
  /** Writes a new row; null when the organisation already has one by that name. */
  insert(row: NewOrgSecret): Promise<OrgSecretRecord | null>;
  /** Changes the row; only while its `pending_at` is still `expect.pendingAt`, when given. The row, or null when it did not change. */
  update(orgId: string, name: string, patch: Patch, expect?: { pendingAt: string | null }): Promise<OrgSecretRecord | null>;
  remove(orgId: string, name: string): Promise<void>;
}

export interface OrgSecretDeps {
  store: OrgSecretStore;
  vault: Vault;
  now?: () => Date;
}

/** What the app gets back: the row without who is behind the names. */
export type OrgSecretView = Pick<
  OrgSecretRecord,
  'id' | 'org_id' | 'name' | 'label' | 'maker' | 'stored_by_name' | 'stored_at' | 'last_used_at' | 'status' | 'pending_by_name' | 'pending_at'
>;

const view = (r: OrgSecretRecord): OrgSecretView => ({
  id: r.id,
  org_id: r.org_id,
  name: r.name,
  label: r.label,
  maker: r.maker,
  stored_by_name: r.stored_by_name,
  stored_at: r.stored_at,
  last_used_at: r.last_used_at,
  status: r.status,
  pending_by_name: r.pending_by_name,
  pending_at: r.pending_at,
});

const LIVE = { kind: 'agent-secret' };
const WAITING = { kind: 'agent-secret-pending' };

/** The value from the body, as the vault will keep it; refused before anything is written. */
function valueOf(body: unknown): string {
  const raw = (body as { value?: unknown } | null)?.value;
  if (typeof raw !== 'string') throw new Refusal(400, 'bad_request', 'value must be a string');
  const value = cleanSecretValue(raw);
  const problem = secretValueProblem(value);
  if (problem === 'too_short') throw new Refusal(400, 'value_too_short', 'the value is shorter than 8 characters');
  if (problem === 'too_long') throw new Refusal(400, 'value_too_long', 'the value is longer than 64 KB');
  if (problem === 'nul') throw new Refusal(400, 'value_nul', 'the value has a NUL character');
  return value;
}

function nameOf(raw: unknown): string {
  if (typeof raw !== 'string' || !isSecretName(raw)) throw new Refusal(400, 'bad_name', 'not a key name');
  return raw;
}

const stamp = (deps: OrgSecretDeps) => (deps.now ?? (() => new Date()))().toISOString();

async function existing(deps: OrgSecretDeps, orgId: string, name: string): Promise<OrgSecretRecord> {
  const row = await deps.store.find(orgId, name);
  if (!row) throw new Refusal(404, 'not_found', 'no such key');
  return row;
}

/**
 * A new key. The row is written first, claiming the name, and removed again if the vault fails: writing
 * the vault first could replace a value someone else had just stored under the same name.
 */
export async function storeSecret(deps: OrgSecretDeps, userId: string, orgId: unknown, body: unknown): Promise<OrgSecretView> {
  const member = await requireMember(deps.store, orgId, userId);
  const org = orgId as string;
  const input = (body ?? {}) as { label?: unknown; name?: unknown; maker?: unknown };
  const value = valueOf(body);
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  if (label.length < 1 || label.length > 80) throw new Refusal(400, 'bad_label', 'a label of 1 to 80 characters');
  const name = nameOf(input.name === undefined || input.name === null ? secretNameFromLabel(label) : input.name);
  const maker = input.maker ?? null;
  if (maker !== null && (typeof maker !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(maker))) throw new Refusal(400, 'bad_request', 'not a maker id');

  const now = stamp(deps);
  const owner = member.role === 'owner';
  const who = { id: userId, name: member.displayName };
  const row = await deps.store.insert({
    org_id: org,
    name,
    label,
    maker,
    stored_by: owner ? who.id : null,
    stored_by_name: owner ? who.name : null,
    stored_at: owner ? now : null,
    pending_by: owner ? null : who.id,
    pending_by_name: owner ? null : who.name,
    pending_at: owner ? null : now,
    updated_at: now,
  });
  if (!row) throw new Refusal(409, 'exists', 'the organisation already has a key by that name');
  try {
    if (owner) await deps.vault.put(agentSecretName(org, name), value, { org_id: org, ...LIVE });
    else await deps.vault.put(pendingSecretName(org, name), value, { org_id: org, ...WAITING });
  } catch (e) {
    await deps.store.remove(org, name).catch(() => {});
    throw e;
  }
  return view(row);
}

/**
 * A new value for a key there is a row for. An owner's goes live (the vault first: if it fails, the row
 * still tells the truth); a member's waits, replacing any value of theirs or another member's that waited.
 */
export async function replaceSecret(deps: OrgSecretDeps, userId: string, orgId: unknown, rawName: unknown, body: unknown): Promise<OrgSecretView> {
  const member = await requireMember(deps.store, orgId, userId);
  const org = orgId as string;
  const name = nameOf(rawName);
  const value = valueOf(body);
  const before = await existing(deps, org, name);
  const now = stamp(deps);
  if (member.role === 'owner') {
    await deps.vault.put(agentSecretName(org, name), value, { org_id: org, ...LIVE });
    const row = await deps.store.update(org, name, { stored_by: userId, stored_by_name: member.displayName, stored_at: now, status: 'ok', updated_at: now });
    if (!row) throw new Refusal(404, 'not_found', 'the key was removed meanwhile');
    return view(row);
  }
  // The row first: an owner approving meanwhile then fails on it instead of taking a value they never saw.
  const row = await deps.store.update(org, name, { pending_by: userId, pending_by_name: member.displayName, pending_at: now, updated_at: now });
  if (!row) throw new Refusal(404, 'not_found', 'the key was removed meanwhile');
  try {
    await deps.vault.put(pendingSecretName(org, name), value, { org_id: org, ...WAITING });
  } catch (e) {
    const back = { pending_by: before.pending_by, pending_by_name: before.pending_by_name, pending_at: before.pending_at, updated_at: before.updated_at };
    await deps.store.update(org, name, back, { pendingAt: now }).catch(() => null);
    throw e;
  }
  return view(row);
}

async function decidable(deps: OrgSecretDeps, userId: string, orgId: unknown, rawName: unknown) {
  await requireOwner(deps.store, orgId, userId);
  const org = orgId as string;
  const name = nameOf(rawName);
  const row = await existing(deps, org, name);
  if (!row.pending_at) throw new Refusal(409, 'nothing_pending', 'no value waits for approval');
  return { org, name, row };
}

/**
 * An owner lets a member's value be used: it moves to the name runs read, and the row says the member
 * stored it. Only the value the owner saw waiting: one sent meanwhile is refused, to be decided on its own.
 */
export async function approveSecret(deps: OrgSecretDeps, userId: string, orgId: unknown, rawName: unknown): Promise<{ status: 'approved' }> {
  const { org, name, row } = await decidable(deps, userId, orgId, rawName);
  const waiting = pendingSecretName(org, name);
  const value = await deps.vault.get(waiting);
  const now = stamp(deps);
  const clear = { pending_by: null, pending_by_name: null, pending_at: null };
  if (!value) {
    await deps.store.update(org, name, { ...clear, updated_at: now }, { pendingAt: row.pending_at });
    if (!row.stored_at) await deps.store.remove(org, name);
    throw new Refusal(409, 'gone', 'the waiting value is no longer kept; it has to be stored again');
  }
  const claimed = await deps.store.update(
    org,
    name,
    { stored_by: row.pending_by, stored_by_name: row.pending_by_name, stored_at: now, status: 'ok', ...clear, updated_at: now },
    { pendingAt: row.pending_at },
  );
  if (!claimed) throw new Refusal(409, 'conflict', 'a newer value arrived meanwhile; look again');
  try {
    await deps.vault.put(agentSecretName(org, name), value, { org_id: org, ...LIVE });
  } catch (e) {
    // Back to waiting, so the owner can approve again.
    const back = {
      stored_by: row.stored_by,
      stored_by_name: row.stored_by_name,
      stored_at: row.stored_at,
      status: row.status,
      pending_by: row.pending_by,
      pending_by_name: row.pending_by_name,
      pending_at: row.pending_at,
      updated_at: row.updated_at,
    };
    await deps.store.update(org, name, back, { pendingAt: null }).catch(() => null);
    throw e;
  }
  // Approved either way: a waiting copy left behind is logged, never used by a run.
  await deps.vault.remove(waiting).catch((e: unknown) => console.error('approved key, waiting copy not removed', e instanceof Error ? e.name : typeof e));
  return { status: 'approved' };
}

/** An owner turns a member's value down: it leaves the vault; a key that was only that value goes with it. */
export async function rejectSecret(deps: OrgSecretDeps, userId: string, orgId: unknown, rawName: unknown): Promise<{ status: 'rejected' }> {
  const { org, name, row } = await decidable(deps, userId, orgId, rawName);
  await deps.vault.remove(pendingSecretName(org, name));
  if (!row.stored_at) await deps.store.remove(org, name);
  else await deps.store.update(org, name, { pending_by: null, pending_by_name: null, pending_at: null, updated_at: stamp(deps) }, { pendingAt: row.pending_at });
  return { status: 'rejected' };
}

/** An owner removes a key: its value and any waiting one leave the vault first, then the row (kept if that fails, to retry). */
export async function removeSecret(deps: OrgSecretDeps, userId: string, orgId: unknown, rawName: unknown): Promise<{ ok: true }> {
  await requireOwner(deps.store, orgId, userId);
  const org = orgId as string;
  const name = nameOf(rawName);
  await existing(deps, org, name);
  await deps.vault.remove(agentSecretName(org, name));
  await deps.vault.remove(pendingSecretName(org, name));
  await deps.store.remove(org, name);
  return { ok: true };
}

/** The store over Supabase with the service role, which bypasses row-level security. */
export function supabaseOrgSecretStore(admin: SupabaseClient): OrgSecretStore {
  return {
    async membership(orgId, userId) {
      const { data, error } = await admin
        .from('memberships')
        .select('role, display_name')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle<{ role: Membership['role']; display_name: string }>();
      if (error) throw error;
      return data ? { role: data.role, displayName: data.display_name } : null;
    },
    async find(orgId, name) {
      const { data, error } = await admin.from('org_secrets').select('*').eq('org_id', orgId).eq('name', name).maybeSingle<OrgSecretRecord>();
      if (error) throw error;
      return data;
    },
    async insert(row) {
      const { data, error } = await admin.from('org_secrets').insert(row).select('*').single<OrgSecretRecord>();
      if (error?.code === '23505') return null;
      if (error) throw error;
      return data;
    },
    async update(orgId, name, patch, expect) {
      let q = admin.from('org_secrets').update(patch).eq('org_id', orgId).eq('name', name);
      if (expect) q = expect.pendingAt === null ? q.is('pending_at', null) : q.eq('pending_at', expect.pendingAt);
      const { data, error } = await q.select('*').maybeSingle<OrgSecretRecord>();
      if (error) throw error;
      return data;
    },
    async remove(orgId, name) {
      const { error } = await admin.from('org_secrets').delete().eq('org_id', orgId).eq('name', name);
      if (error) throw error;
    },
  };
}
