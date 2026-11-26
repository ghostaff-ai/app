import type { ExternalParty } from '@ghostaff/shared';
import { listExternalParties } from '@ghostaff/shared/services';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { supabase } from '../supabase';

/**
 * Who the organisation works with outside (external-parties.md). Read again
 * whenever the screen comes back, so one added in the form or by an approved
 * card shows at once.
 */
export function useExternalParties(orgId: string | null) {
  const [items, setItems] = useState<ExternalParty[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await listExternalParties(supabase, orgId));
      setError(null);
      setLoaded(true);
    } catch {
      setError('No hemos podido leer la lista. Vuelve a intentarlo en un momento.');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { items, loading, loaded, error, reload: load };
}

