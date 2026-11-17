import type { Agent } from '@ghostaff/shared';
import { listAgents } from '@ghostaff/shared/services';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

/** An organisation's agents, read from the database as the signed-in person. */
export function useAgents(orgId: string | null) {
  const [items, setItems] = useState<Agent[]>([]);
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
      setItems(await listAgents(supabase, orgId));
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
