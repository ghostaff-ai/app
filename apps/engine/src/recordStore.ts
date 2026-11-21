// The record sync's database side, with the service role (apps/engine only).

import type { SupabaseClient } from '@supabase/supabase-js';
import { applySync, markWrittenBack } from '@ghostaff/shared/record';
import type { DecisionRow } from '@ghostaff/shared/services';
import type { RecordOrg, RecordSyncStore } from './recordSync';

type OrgRow = { id: string; slug: string; record_repo: string; record_installation: number };

const toOrg = (r: OrgRow): RecordOrg => ({ id: r.id, slug: r.slug, repo: r.record_repo, installation: Number(r.record_installation) });

export function supabaseRecordStore(db: SupabaseClient): RecordSyncStore {
  return {
    async orgsWithRecord() {
      const { data, error } = await db
        .from('organizations')
        .select('id, slug, record_repo, record_installation')
        .not('record_repo', 'is', null)
        .not('record_installation', 'is', null)
        .returns<OrgRow[]>();
      if (error) throw error;
      return (data ?? []).map(toOrg);
    },
    async orgWithRecord(orgId) {
      const { data, error } = await db
        .from('organizations')
        .select('id, slug, record_repo, record_installation')
        .eq('id', orgId)
        .maybeSingle<OrgRow>();
      if (error) throw error;
      return data?.record_repo && data.record_installation ? toOrg(data) : null;
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
