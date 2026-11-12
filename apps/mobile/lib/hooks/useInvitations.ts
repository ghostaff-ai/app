import type { MyInvitation, PendingInvitation } from '@ghostaff/shared';
import { listMyInvitations, listPendingInvitations } from '@ghostaff/shared/services';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useList<T>(fetch: (() => Promise<T[]>) | null) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!fetch) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setItems(await fetch());
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [fetch]);

  useEffect(() => {
    void load();
  }, [load]);

  return { items, loading, error, reload: load };
}

/** Invitations addressed to the signed-in person's email. */
export function useMyInvitations() {
  const fetch = useCallback(() => listMyInvitations(supabase), []);
  return useList<MyInvitation>(fetch);
}

/** An organisation's open invitations (owners only). */
export function usePendingInvitations(orgId: string | null) {
  const fetch = useCallback(() => (orgId ? listPendingInvitations(supabase, orgId) : Promise.resolve([])), [orgId]);
  return useList<PendingInvitation>(orgId ? fetch : null);
}
