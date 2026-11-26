// The record sync's database side, with the service role (apps/engine only).

import type { SupabaseClient } from '@supabase/supabase-js';
import { applySync, type ExternalSyncRow, markWrittenBack, type SyncAgent } from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';
import type { MemoryStore } from './memory';
import type { RecordAgent } from './recordProvision';
import type { RecordOrg, RecordSyncStore } from './recordSync';

type OrgRow = { id: string; slug: string; record_host: 'github' | 'ghostaff' | null; record_repo: string | null; record_installation: number | null };
const ORG = 'id, slug, record_host, record_repo, record_installation';

const toOrg = (r: OrgRow): RecordOrg | null => {
  if (!r.record_repo) return null;
  if (r.record_host === 'github' && r.record_installation) return { id: r.id, slug: r.slug, repo: r.record_repo, host: 'github', installation: Number(r.record_installation) };
  if (r.record_host === 'ghostaff') return { id: r.id, slug: r.slug, repo: r.record_repo, host: 'ghostaff' };
  return null;
};

export function supabaseRecordStore(db: SupabaseClient): RecordSyncStore {
  return {
    async orgsWithRecord() {
      const { data, error } = await db.from('organizations').select(ORG).not('record_repo', 'is', null).returns<OrgRow[]>();
      if (error) throw error;
      return (data ?? []).flatMap((r) => toOrg(r) ?? []);
    },
    async orgWithRecord(orgId) {
      const { data, error } = await db.from('organizations').select(ORG).eq('id', orgId).maybeSingle<OrgRow>();
      if (error) throw error;
      return data ? toOrg(data) : null;
    },
    async orgsWithoutRecord() {
      const { data, error } = await db
        .from('organizations')
        .select('id, slug, name')
        .is('record_repo', null)
        .returns<Array<{ id: string; slug: string; name: string }>>();
      if (error) throw error;
      return data ?? [];
    },
    async setOwnRecord(orgId, repo) {
      const { data, error } = await db
        .from('organizations')
        .update({ record_host: 'ghostaff', record_repo: repo, record_sync_error: null })
        .eq('id', orgId)
        .is('record_repo', null)
        .select('id');
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    async decisions(orgId) {
      const { data, error } = await db.from('decisions').select('*').eq('org_id', orgId).returns<DecisionRow[]>();
      if (error) throw error;
      return data ?? [];
    },
    async agents(orgId) {
      const { data, error } = await db.from('agents').select('id, slug, name, ghost').eq('org_id', orgId).returns<SyncAgent[]>();
      if (error) throw error;
      return data ?? [];
    },
    apply: (plan) => applySync(db, plan),
    markWrittenBack: (ids) => markWrittenBack(db, ids),
    async pointDecision(orgId, recordId, agentId) {
      const { data, error } = await db
        .from('decisions')
        .update({ agent_id: agentId })
        .eq('org_id', orgId)
        .eq('record_id', recordId)
        .select('id')
        .maybeSingle<{ id: string }>();
      if (error) throw error;
      return data?.id ?? null;
    },
    async instructedAgents(orgId) {
      const { data, error } = await db
        .from('agents')
        .select('id, slug, task, task_in_record')
        .eq('org_id', orgId)
        .not('slug', 'is', null)
        .returns<Array<{ id: string; slug: string; task: string | null; task_in_record: boolean }>>();
      if (error) throw error;
      return (data ?? []).map((r) => ({ id: r.id, slug: r.slug, task: r.task, taskInRecord: r.task_in_record }));
    },
    async setInstructions(agentId, change) {
      const { error } = await db
        .from('agents')
        .update(change.inRecord ? { task: change.task, task_in_record: true } : { task_in_record: false })
        .eq('id', agentId);
      if (error) throw error;
    },
    async externalParties(orgId) {
      const { data, error } = await db
        .from('external_parties')
        .select('id, path, kind, name, role, departments, email, phone, website, added_by_name, added_at, proposed_by_name, content_hash, pending, updated_at')
        .eq('org_id', orgId)
        .returns<ExternalSyncRow[]>();
      if (error) throw error;
      return data ?? [];
    },
    async applyExternal(orgId, plan) {
      // Every upsert carries the same columns (ExternalUpsert), so one batch writes no NULL over a column.
      if (plan.upserts.length) {
        const { error } = await db.from('external_parties').upsert(plan.upserts, { onConflict: 'org_id,path' });
        if (error) throw error;
      }
      if (plan.deletes.length) {
        const { error } = await db.from('external_parties').delete().eq('org_id', orgId).in('id', plan.deletes);
        if (error) throw error;
      }
    },
    async markExternalWritten(written) {
      for (const w of written) {
        if (w.hash === null) {
          const { error } = await db.from('external_parties').delete().eq('id', w.rowId).eq('pending', 'remove');
          if (error) throw error;
          continue;
        }
        // The file is the row's now, whatever happens next; only a row nobody changed since is done.
        const { error } = await db.from('external_parties').update({ path: w.path, content_hash: w.hash }).eq('id', w.rowId);
        if (error) throw error;
        const { error: done } = await db.from('external_parties').update({ pending: null }).eq('id', w.rowId).eq('updated_at', w.updatedAt);
        if (done) throw done;
      }
    },
    async syncState(orgId, err) {
      const { error } = await db
        .from('organizations')
        .update({ record_synced_at: new Date().toISOString(), record_sync_error: err })
        .eq('id', orgId);
      if (error) throw error;
    },
  };
}

/** The organisation's agents on our runner, for its record's hook (recordProvision.ts). */
export async function recordAgentsOf(db: SupabaseClient, orgId: string): Promise<RecordAgent[]> {
  const { data, error } = await db
    .from('agents')
    .select('id, slug, is_main')
    .eq('org_id', orgId)
    .eq('runner', 'ghostaff')
    .not('slug', 'is', null)
    .returns<{ id: string; slug: string; is_main: boolean }[]>();
  if (error) throw error;
  return (data ?? []).map((a) => ({ id: a.id, slug: a.slug, isMain: a.is_main }));
}

type MemoryRow = { path: string; content: string; sha: string; updated_at: string; updated_by: string | null };

/** The organisation's memory as the projection keeps it (`memories`, memory.ts), with the service role. Only the Empresa store today. */
export function supabaseMemoryStore(db: SupabaseClient): MemoryStore {
  const STORE = 'empresa';
  return {
    async memoryIndex(orgId) {
      const { data, error } = await db
        .from('memories')
        .select('path, sha, updated_at')
        .eq('org_id', orgId)
        .eq('store', STORE)
        .order('path')
        .limit(5000)
        .returns<Array<{ path: string; sha: string; updated_at: string }>>();
      if (error) throw error;
      return (data ?? []).map((r) => ({ path: r.path, sha: r.sha, updatedAt: r.updated_at }));
    },
    async memory(orgId, path) {
      const { data, error } = await db
        .from('memories')
        .select('path, content, sha, updated_at, updated_by')
        .eq('org_id', orgId)
        .eq('store', STORE)
        .eq('path', path)
        .maybeSingle<MemoryRow>();
      if (error) throw error;
      return data ? { path: data.path, content: data.content, sha: data.sha, updatedAt: data.updated_at, updatedBy: data.updated_by } : null;
    },
    async searchMemory(orgId, words, max) {
      const { data, error } = await db.rpc('search_memories', { target_org: orgId, target_store: STORE, words, max });
      if (error) throw error;
      return ((data ?? []) as Array<{ path: string; content: string; updated_at: string }>).map((r) => ({ path: r.path, content: r.content, updatedAt: r.updated_at }));
    },
    async saveMemory(orgId, files) {
      if (!files.length) return;
      const now = new Date().toISOString();
      const { error } = await db.from('memories').upsert(
        files.map((f) => ({ org_id: orgId, store: STORE, path: f.path, content: f.content, sha: f.sha, updated_by: f.updatedBy, updated_at: now })),
        { onConflict: 'org_id,store,path' },
      );
      if (error) throw error;
    },
    async forgetMemory(orgId, paths) {
      if (!paths.length) return;
      const { error } = await db.from('memories').delete().eq('org_id', orgId).eq('store', STORE).in('path', paths);
      if (error) throw error;
    },
  };
}
