import type { PendingGuide } from '@ghostaff/shared';
import { approveGuide, pendingGuides, rejectGuide } from '@ghostaff/shared/services';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { decideErrorText } from '../guide';
import { useEngine } from './useConnections';

// The organisation's member guides waiting for an owner (docs/plans/ongoing/guided-access.md):
// read from the engine, which keeps guides apart from the app, and decided there.
// Only an owner reads them; for anyone else the list stays empty and is never asked for.
// It is read each time the screen comes into view, so a guide finished or decided
// elsewhere (in the guide's own screen, by another owner) shows as it is now.

export function usePendingGuides(orgId: string | null, owner: boolean) {
  const engine = useEngine();
  const [items, setItems] = useState<PendingGuide[]>([]);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!engine || !orgId || !owner) {
      setItems([]);
      return;
    }
    try {
      setItems(await pendingGuides(engine, orgId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [engine, orgId, owner]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * Approves or rejects one; resolves with what went wrong, if anything. Either way
   * the list is read again: a guide someone else already decided (409) leaves it.
   */
  const decide = useCallback(
    async (guideId: string, decision: 'approve' | 'reject'): Promise<string | null> => {
      if (!engine) return 'No hay conexión. Prueba otra vez.';
      let problem: string | null = null;
      try {
        await (decision === 'approve' ? approveGuide(engine, guideId) : rejectGuide(engine, guideId));
      } catch (e) {
        problem = decideErrorText(e);
      }
      await load();
      return problem;
    },
    [engine, load],
  );

  return { items, failed, reload: load, decide };
}
