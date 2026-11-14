import type { Connection } from '@ghostaff/shared';
import { type EngineAccess, listConnections } from '@ghostaff/shared/services';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { engineUrl } from '../env';
import { supabase } from '../supabase';

/** An organisation's connections, read from the database as the signed-in person. */
export function useConnections(orgId: string | null) {
  const [items, setItems] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, loading, error, reload: load };
}

/** How to call the engine as the signed-in person; null when not signed in. */
export function useEngine(): EngineAccess | null {
  const { session } = useAuth();
  const token = session?.access_token;
  return useMemo(() => (token ? { url: engineUrl, token } : null), [token]);
}
