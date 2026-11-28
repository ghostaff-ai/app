import type { OrgSecret } from '@ghostaff/shared';
import { listOrgSecrets } from '@ghostaff/shared/services';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

// Every mounted copy of the hook, so a key stored, replaced or removed on its page reaches the list beside it.
const mounted = new Set<() => Promise<void>>();

/** The organisation's keys, without their values (docs/plans/ongoing/secrets-from-the-app.md). */
export function useOrgSecrets(orgId: string | null) {
  const [items, setItems] = useState<OrgSecret[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Which organisation the items belong to, once a first read has finished.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setItems([]);
      return;
    }
    try {
      setItems(await listOrgSecrets(supabase, orgId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
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

  /** Read again, here and in every other screen showing the keys. */
  const reload = useCallback(async () => {
    await Promise.all([...mounted].map((l) => l()));
  }, []);

  return { items, loaded: !!orgId && loadedFor === orgId, error, reload };
}
