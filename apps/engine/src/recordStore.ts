// The record sync's database side, with the service role (apps/engine only).

import type { SupabaseClient } from '@supabase/supabase-js';
import { applySync, markWrittenBack } from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';
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
    apply: (plan) => applySync(db, plan),
    markWrittenBack: (ids) => markWrittenBack(db, ids),
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
    .select('id, slug, ghost')
    .eq('org_id', orgId)
    .eq('runner', 'ghostaff')
    .not('slug', 'is', null)
    .returns<RecordAgent[]>();
  if (error) throw error;
  return data ?? [];
}
