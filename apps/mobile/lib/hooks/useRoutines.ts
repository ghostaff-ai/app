import type { Routine } from '@ghostaff/shared';
import { listRoutines } from '@ghostaff/shared/services';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { supabase } from '../supabase';

/**
 * The routines the signed-in person sees with one agent (agent-routines.md):
 * their own and the team's. Read again whenever the screen comes back, so a
 * routine made from the list, a form or an approved card shows at once.
 */
export function useRoutines(orgId: string | null, agentId: string | null) {
  const [items, setItems] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !agentId) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      setItems(await listRoutines(supabase, orgId, agentId));
      setError(null);
    } catch {
      setError('No hemos podido leer las tareas programadas. Vuelve a intentarlo en un momento.');
    } finally {
      setLoading(false);
    }
  }, [orgId, agentId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { items, loading, error, reload: load };
}
