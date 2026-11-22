import type { AiUsageDay, Connection } from '@ghostaff/shared';
import { type EngineAccess, listAiUsage, listConnections } from '@ghostaff/shared/services';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { engineUrl } from '../env';
import { supabase } from '../supabase';

// Every mounted copy of the hook, so that a connection made or removed on one
// screen reaches the others: the layout's AI gate lifts the moment an account
// is connected on its page.
const mounted = new Set<() => Promise<void>>();

/** An organisation's connections, read from the database as the signed-in person. */
export function useConnections(orgId: string | null) {
  const [items, setItems] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which organisation the items belong to, once a first read has finished.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await listConnections(supabase, orgId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setLoadedFor(orgId);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
    mounted.add(load);
    return () => {
      mounted.delete(load);
    };
  }, [load]);

  /** Read again, here and in every other screen showing connections. */
  const reload = useCallback(async () => {
    await Promise.all([...mounted].map((l) => l()));
  }, []);

  return { items, loading, loaded: !!orgId && loadedFor === orgId, error, reload };
}

/** How to call the engine as the signed-in person; null when not signed in. */
export function useEngine(): EngineAccess | null {
  const { session } = useAuth();
  const token = session?.access_token;
  return useMemo(() => (token ? { url: engineUrl, token } : null), [token]);
}

/** What each of the organisation's AI accounts did in the last 30 days, per agent and day. */
export function useAiUsage(orgId: string | null) {
  const [rows, setRows] = useState<AiUsageDay[]>([]);
  const load = useCallback(async () => {
    if (!orgId) return setRows([]);
    // Usage is a nicety on the cards: if it cannot be read, they go on without it.
    setRows(await listAiUsage(supabase, orgId).catch(() => []));
  }, [orgId]);
  useEffect(() => {
    void load();
  }, [load]);
  return { rows, reload: load };
}
