import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { whoopRecords } from '@ghostaff/shared/health';
import { describe, expect, it } from 'vitest';
import { importHealth, readWhoopDump } from '../src/healthImport';

const FILES = ['profile', 'body_measurement', 'cycles', 'recoveries', 'sleeps', 'workouts', 'summary'] as const;

function cycle(id: number) {
  const start = new Date(Date.UTC(2024, 0, 1) + id * 86_400_000).toISOString();
  const end = new Date(Date.parse(start) + 20 * 3_600_000).toISOString();
  return { id, user_id: 42, start, end, timezone_offset: '+01:00', score_state: 'SCORED', score: { strain: 10 }, updated_at: end };
}

function exportDir(over: Partial<Record<(typeof FILES)[number], unknown>> = {}, skip: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'whoop-'));
  const content: Record<string, unknown> = {
    profile: { user_id: 42, email: 'a@b.c' },
    body_measurement: { weight_kilogram: 78.4 },
    cycles: [cycle(1), cycle(2)],
    recoveries: [{ cycle_id: 1, score_state: 'SCORED', score: { hrv_rmssd_milli: 50 } }],
    sleeps: [],
    workouts: [],
    summary: { exported_at: '2026-11-23T101010Z', counts: {} },
    ...over,
  };
  for (const name of FILES) {
    if (!skip.includes(name)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(content[name]));
  }
  return dir;
}

interface Call {
  schema: string;
  table: string;
  op: string;
  rows?: unknown[];
  options?: Record<string, unknown>;
}

/**
 * Just enough of supabase-js for the import: records every write, and answers
 * the read-back of the source's records with what upserts stored plus `stored`
 * (records an earlier import left that this folder no longer has).
 */
function fakeDb(org: { id: string; kind: string } | null, stored: object[] = []) {
  const calls: Call[] = [];
  const client = (schema: string) => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ schema, table: fn, op: 'rpc', rows: args.rows as unknown[], options: { target_source: args.target_source } });
      return { data: null, error: null };
    },
    from(table: string) {
      let range: [number, number] | null = null;
      const result = () => {
        if (table === 'organizations') return { data: org, error: null };
        if (table === 'sources') return { data: { id: 'src-1' }, error: null };
        if (table === 'records' && range) {
          const all = [...stored, ...calls.filter((c) => c.table === 'records' && c.op === 'upsert').flatMap((c) => c.rows ?? [])];
          return { data: all.slice(range[0], range[1] + 1), error: null };
        }
        return { data: null, error: null };
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range: (from: number, to: number) => {
          range = [from, to];
          return builder;
        },
        maybeSingle: async () => result(),
        single: async () => result(),
        upsert: (rows: unknown, options?: Record<string, unknown>) => {
          calls.push({ schema, table, op: 'upsert', rows: Array.isArray(rows) ? rows : [rows], options });
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) => resolve(result()),
      };
      return builder;
    },
  });
  const db = { ...client('public'), schema: (name: string) => client(name) } as unknown as SupabaseClient;
  return { db, calls };
}

describe('readWhoopDump', () => {
  it("reads the export script's folder", () => {
    const dump = readWhoopDump(exportDir());
    expect(dump.exportedAt).toBe('2026-11-23T10:10:10Z');
    expect(whoopRecords(dump).map((r) => r.kind)).toEqual(['body', 'cycle', 'cycle', 'recovery']);
  });

  it('names a missing file', () => {
    expect(() => readWhoopDump(exportDir({}, ['sleeps']))).toThrow(/sleeps\.json/);
  });
});

describe('importHealth', () => {
  it('refuses a company space', async () => {
    const { db, calls } = fakeDb({ id: 'org-1', kind: 'company' });
    await expect(importHealth(db, { org: 'panaderia', provider: 'whoop', dir: exportDir() })).rejects.toThrow(/personal space/);
    expect(calls).toEqual([]);
  });

  it('import is idempotent', async () => {
    const { db, calls } = fakeDb({ id: 'org-1', kind: 'personal' });
    const counts = await importHealth(db, { org: 'personal', provider: 'whoop', dir: exportDir() });
    const source = calls.find((c) => c.table === 'sources');
    expect(source).toMatchObject({ schema: 'health', options: { onConflict: 'org_id,provider,external_user_id', ignoreDuplicates: true } });
    expect(source?.rows?.[0]).toMatchObject({ org_id: 'org-1', provider: 'whoop', external_user_id: '42', connection_id: null, consent_version: 'import-v1' });
    const records = calls.filter((c) => c.table === 'records');
    expect(records.every((c) => c.schema === 'health' && c.options?.onConflict === 'source_id,kind,external_id')).toBe(true);
    expect(records[0]?.rows?.[0]).toMatchObject({ org_id: 'org-1', source_id: 'src-1', provider: 'whoop', kind: 'body', external_id: 'body:2026-11-23' });
    expect(calls.some((c) => c.table === 'metrics')).toBe(false);
    const replaced = calls.filter((c) => c.op === 'rpc');
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ schema: 'health', table: 'replace_metrics', options: { target_source: 'src-1' } });
    expect(replaced[0]?.rows).toContainEqual({ day: '2024-01-02', metric: 'strain', value: 10, unit: 'score' });
    expect(counts).toEqual({ records: 4, metrics: 4 });
  });

  it('metrics come from every stored record, not only this folder', async () => {
    const earlier = { kind: 'body', external_id: 'body:2026-10-01', starts_at: '2026-10-01T09:00:00+00:00', ends_at: null, payload: { weight_kilogram: 80.1 } };
    const { db, calls } = fakeDb({ id: 'org-1', kind: 'personal' }, [earlier]);
    const counts = await importHealth(db, { org: 'personal', provider: 'whoop', dir: exportDir() });
    const rows = calls.find((c) => c.op === 'rpc')?.rows as { day: string; metric: string; value: number }[];
    expect(rows).toContainEqual({ day: '2026-10-01', metric: 'weight_kg', value: 80.1, unit: 'kg' });
    expect(rows).toContainEqual({ day: '2026-11-23', metric: 'weight_kg', value: 78.4, unit: 'kg' });
    expect(counts.metrics).toBe(5);
  });

  it('batches of 500', async () => {
    const { db, calls } = fakeDb({ id: 'org-1', kind: 'personal' });
    const cycles = Array.from({ length: 1201 }, (_, i) => cycle(i + 1));
    await importHealth(db, { org: 'personal', provider: 'whoop', dir: exportDir({ cycles }) });
    expect(calls.filter((c) => c.table === 'records').map((c) => c.rows?.length)).toEqual([500, 500, 203]);
  });
});
