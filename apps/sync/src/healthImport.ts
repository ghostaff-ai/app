// Importing a band's export into a personal space's kept health history
// (docs/plans/ongoing/wearables.md, phase 1). Reads the folder the Whoop export
// script writes (`whoop_export.py`: one JSON per collection plus summary.json)
// and writes it with the service role into `health.*`, idempotently: running it
// twice on the same folder leaves the same rows. The records are upserted (a
// record an earlier import kept stays); the daily metrics are then recomputed
// from every record the source has and replaced as a whole, so no number
// outlives the records it came from.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type HealthRecord, type WhoopDump, whoopDailyMetrics, whoopRecords } from '@ghostaff/shared/health';

const BATCH = 500;
const PAGE = 1000;
const CONSENT_VERSION = 'import-v1';

function readJson(dir: string, name: string): unknown {
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) throw new Error(`${path} is missing: is this a folder the Whoop export script wrote?`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function list(dir: string, name: string): unknown[] {
  const value = readJson(dir, name);
  if (!Array.isArray(value)) throw new Error(`${name}.json is not a list`);
  return value;
}

/** «2026-11-23T101010Z» (the script's folder stamp) → ISO 8601. */
function stampToIso(stamp: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) throw new Error(`summary.json has an unexpected exported_at: ${stamp}`);
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`;
}

export function readWhoopDump(dir: string): WhoopDump {
  const profile = readJson(dir, 'profile') as { user_id?: number | string };
  if (profile.user_id === undefined || profile.user_id === null) throw new Error('profile.json has no user_id');
  const summary = readJson(dir, 'summary') as { exported_at?: string };
  return {
    profile: { user_id: profile.user_id },
    body_measurement: (readJson(dir, 'body_measurement') ?? {}) as Record<string, unknown>,
    cycles: list(dir, 'cycles'),
    recoveries: list(dir, 'recoveries'),
    sleeps: list(dir, 'sleeps'),
    workouts: list(dir, 'workouts'),
    exportedAt: stampToIso(summary.exported_at ?? ''),
  };
}

async function upsertInBatches(db: SupabaseClient, table: string, rows: object[], onConflict: string) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.schema('health').from(table).upsert(rows.slice(i, i + BATCH), { onConflict });
    if (error) throw error;
  }
}

interface StoredRecord {
  kind: HealthRecord['kind'];
  external_id: string;
  starts_at: string | null;
  ends_at: string | null;
  payload: Record<string, unknown>;
}

/** Every record the source has, page by page. */
async function storedRecords(db: SupabaseClient, sourceId: string): Promise<HealthRecord[]> {
  const out: HealthRecord[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .schema('health')
      .from('records')
      .select('kind, external_id, starts_at, ends_at, payload')
      .eq('source_id', sourceId)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as StoredRecord[];
    out.push(...rows.map((r) => ({ kind: r.kind, externalId: r.external_id, startsAt: r.starts_at, endsAt: r.ends_at, payload: r.payload })));
    if (rows.length < PAGE) return out;
  }
}

function countBy<T>(items: T[], key: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

export async function importHealth(
  db: SupabaseClient,
  opts: { org: string; provider: 'whoop'; dir: string },
): Promise<{ records: number; metrics: number }> {
  const dump = readWhoopDump(opts.dir);
  const records = whoopRecords(dump);

  const org = await db.from('organizations').select('id, kind').eq('slug', opts.org).maybeSingle<{ id: string; kind: string }>();
  if (org.error) throw org.error;
  if (!org.data) throw new Error(`No organisation «${opts.org}»`);
  if (org.data.kind !== 'personal') throw new Error(`«${opts.org}» is not a personal space: health data goes only into a personal space`);
  const orgId = org.data.id;
  const externalUserId = String(dump.profile.user_id);

  // The consent of a source already there is kept: ignoreDuplicates never rewrites it.
  const kept = await db.schema('health').from('sources').upsert(
    {
      org_id: orgId,
      provider: opts.provider,
      external_user_id: externalUserId,
      connection_id: null,
      consented_at: new Date().toISOString(),
      consent_version: CONSENT_VERSION,
    },
    { onConflict: 'org_id,provider,external_user_id', ignoreDuplicates: true },
  );
  if (kept.error) throw kept.error;
  const source = await db
    .schema('health')
    .from('sources')
    .select('id')
    .eq('org_id', orgId)
    .eq('provider', opts.provider)
    .eq('external_user_id', externalUserId)
    .single<{ id: string }>();
  if (source.error) throw source.error;
  const sourceId = source.data.id;

  await upsertInBatches(
    db,
    'records',
    records.map((r) => ({
      org_id: orgId,
      source_id: sourceId,
      provider: opts.provider,
      kind: r.kind,
      external_id: r.externalId,
      starts_at: r.startsAt,
      ends_at: r.endsAt,
      payload: r.payload,
      updated_at: typeof r.payload.updated_at === 'string' ? r.payload.updated_at : dump.exportedAt,
    })),
    'source_id,kind,external_id',
  );
  const metrics = whoopDailyMetrics(await storedRecords(db, sourceId));
  const replaced = await db.schema('health').rpc('replace_metrics', { target_source: sourceId, rows: metrics });
  if (replaced.error) throw replaced.error;

  console.log(`Records by kind: ${JSON.stringify(countBy(records, (r) => r.kind))}`);
  console.log(`Metrics by name: ${JSON.stringify(countBy(metrics, (m) => m.metric))}`);
  return { records: records.length, metrics: metrics.length };
}
