import type { AgentRun } from '@ghostaff/shared';
import { listDoneWithoutYou } from '@ghostaff/shared/services';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

/** «Hecho sin ti» (app-design.md #11): what the agents finished on their own in the last day. */
export function useDoneWithoutYou(orgId: string | null) {
  const [runs, setRuns] = useState<AgentRun[]>([]);

  const load = useCallback(async () => {
    if (!orgId) {
      setRuns([]);
      return;
    }
    try {
      setRuns(await listDoneWithoutYou(supabase, orgId, new Date(Date.now() - 24 * 3600_000)));
    } catch {
      // A line that cannot load stays folded and empty; Hoy still shows the decisions.
      setRuns([]);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { runs, reload: load };
}
