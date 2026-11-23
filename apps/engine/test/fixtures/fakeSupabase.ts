import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A Supabase client for tests: every query on a table answers with its rows
 * (filters are not applied), and every rpc is recorded and succeeds.
 */
export function fakeSupabase(tables: Record<string, unknown[]>, rpcResult: unknown = null) {
  const rpcs: Array<{ name: string; args: unknown }> = [];
  const answer = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit', 'neq', 'gte']) q[m] = () => q;
    q.returns = () => answer(rows);
    q.maybeSingle = () => answer(rows[0] ?? null);
    q.single = () => answer(rows[0] ?? null);
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => answer(rows).then(ok, ko);
    return q;
  };
  const client = {
    from: (table: string) => query(tables[table] ?? []),
    rpc: (name: string, args: unknown) => {
      rpcs.push({ name, args });
      const done = answer(rpcResult);
      return Object.assign(done, { single: () => done });
    },
  } as unknown as SupabaseClient;
  return { client, rpcs };
}
