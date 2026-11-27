// The record sync's database side, with the service role (apps/engine only).

import type { SupabaseClient } from '@supabase/supabase-js';
import { applySync, type ExternalSyncRow, markWrittenBack, type SyncAgent } from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';
import type { MemoryPlace, MemoryStore } from './memory';
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
    async photoShas(orgId) {
      const { data, error } = await db.from('agent_photos').select('agent_id, sha').eq('org_id', orgId).returns<Array<{ agent_id: string; sha: string }>>();
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.agent_id, r.sha]));
    },
    async setPhoto(p) {
      const { error } = await db.from('agent_photos').upsert({
        agent_id: p.agentId,
        org_id: p.orgId,
        blocks: p.blocks,
        skipped: p.skipped,
        sha: p.sha,
        error: null,
        updated_at: p.updatedAt,
      });
      if (error) throw error;
    },
    async failPhoto(orgId, agentId, sha, why) {
      // The last good blocks stay; a first file that can't be read leaves an empty photo with why.
      const { data, error } = await db.from('agent_photos').update({ sha, error: why }).eq('agent_id', agentId).select('agent_id');
      if (error) throw error;
      if (data?.length) return;
      const { error: e2 } = await db.from('agent_photos').insert({ agent_id: agentId, org_id: orgId, sha, error: why });
      if (e2) throw e2;
    },
    async removePhoto(agentId) {
      const { error } = await db.from('agent_photos').delete().eq('agent_id', agentId);
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

/** Each store of the organisation's memory as the projection keeps it (`memories`, memory.ts), with the service role. */
export function supabaseMemoryStore(db: SupabaseClient): MemoryStore {
  /** The rows of one store: Empresa's (whose rows name no agent, `memories_store_agent`), or one agent's own. */
  const keyOf = (orgId: string, place: MemoryPlace): Record<string, string> =>
    place.agentId === null ? { org_id: orgId, store: 'empresa' } : { org_id: orgId, store: 'agente', agent_id: place.agentId };
  const fileOf = (r: MemoryRow) => ({ path: r.path, content: r.content, sha: r.sha, updatedAt: r.updated_at, updatedBy: r.updated_by });
  return {
    async memoryIndex(orgId, place) {
      const { data, error } = await db.from('memories').select('path, sha, updated_at').match(keyOf(orgId, place))
        .order('path')
        .limit(5000)
        .returns<Array<{ path: string; sha: string; updated_at: string }>>();
      if (error) throw error;
      return (data ?? []).map((r) => ({ path: r.path, sha: r.sha, updatedAt: r.updated_at }));
    },
    async memory(orgId, place, path) {
      const { data, error } = await db.from('memories').select('path, content, sha, updated_at, updated_by').match(keyOf(orgId, place)).eq('path', path).maybeSingle<MemoryRow>();
      if (error) throw error;
      return data ? fileOf(data) : null;
    },
    async latestMemory(orgId, place, max) {
      const { data, error } = await db.from('memories').select('path, content, sha, updated_at, updated_by').match(keyOf(orgId, place))
        .order('updated_at', { ascending: false })
        .order('path')
        .limit(max)
        .returns<MemoryRow[]>();
      if (error) throw error;
      return (data ?? []).map(fileOf);
    },
    async searchMemory(orgId, place, words, max) {
      const { data, error } =
        place.agentId === null
          ? await db.rpc('search_memories', { target_org: orgId, target_store: 'empresa', words, max })
          : await db.rpc('search_agent_memories', { target_agent: place.agentId, words, max });
      if (error) throw error;
      return ((data ?? []) as Array<{ path: string; content: string; updated_at: string }>).map((r) => ({ path: r.path, content: r.content, updatedAt: r.updated_at }));
    },
    async saveMemory(orgId, place, files) {
      if (!files.length) return;
      const now = new Date().toISOString();
      const store = place.agentId === null ? 'empresa' : 'agente';
      const { error } = await db.from('memories').upsert(
        files.map((f) => ({ org_id: orgId, store, agent_id: place.agentId, path: f.path, content: f.content, sha: f.sha, updated_by: f.updatedBy, updated_at: now })),
        { onConflict: 'org_id,store,agent_id,path' },
      );
      if (error) throw error;
    },
    async forgetMemory(orgId, place, paths) {
      if (!paths.length) return;
      const { error } = await db.from('memories').delete().match(keyOf(orgId, place)).in('path', paths);
      if (error) throw error;
    },
  };
}
