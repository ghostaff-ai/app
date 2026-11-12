import type { Decision } from '@ghostaff/shared';
import { answerDecision, getDecision, listOpenDecisions, type AnswerInput } from '@ghostaff/shared/services';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The open decisions of one organisation, with a pull-to-refresh. */
export function useInbox(orgId: string | null) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setDecisions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setDecisions(await listOpenDecisions(supabase, orgId));
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { decisions, loading, error, reload: load };
}

export function useDecision(id: string | undefined) {
  const [decision, setDecision] = useState<Decision | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    getDecision(supabase, id)
      .then((d) => alive && setDecision(d))
      .catch((e: unknown) => alive && setError(message(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const answer = useCallback(async (input: Omit<AnswerInput, 'decisionId'>) => {
    if (!id) return;
    setDecision(await answerDecision(supabase, { ...input, decisionId: id }));
  }, [id]);

  return { decision, loading, error, answer };
}
