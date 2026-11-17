import type { Decision } from '@ghostaff/shared';
import { RULE_KIND } from '@ghostaff/shared';
import {
  answerDecision,
  countWaiting,
  getDecision,
  listDecidedDecisions,
  listOpenDecisions,
  okStreak,
  unanswerDecision,
  type AnswerInput,
} from '@ghostaff/shared/services';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A list of one organisation's decisions, loaded by `fetch`, with a reload. */
function useDecisionList(orgId: string | null, fetch: (orgId: string) => Promise<Decision[]>) {
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
      setDecisions(await fetch(orgId));
      setError(null);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }, [orgId, fetch]);

  useEffect(() => {
    void load();
  }, [load]);

  return { decisions, loading, error, reload: load };
}

const fetchOpen = (orgId: string) => listOpenDecisions(supabase, orgId);
const fetchDecided = (orgId: string) => listDecidedDecisions(supabase, orgId);

/** The open decisions of one organisation, what waits first: Hoy. */
export function useInbox(orgId: string | null) {
  return useDecisionList(orgId, fetchOpen);
}

/** What the organisation has answered, newest first: Registro. */
export function useDecided(orgId: string | null) {
  return useDecisionList(orgId, fetchDecided);
}

/** How many decisions wait in each of the person's organisations; empty until loaded or on error. */
export function useWaitingCounts(orgIds: string[]) {
  const key = orgIds.join(',');
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    countWaiting(supabase, key ? key.split(',') : [])
      .then((c) => alive && setCounts(c))
      .catch(() => alive && setCounts({})); // the counts are a nicety; switching still works without them
    return () => {
      alive = false;
    };
  }, [key]);
  return counts;
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

  // OKs in a row for this agent and kind: shown as progress toward autonomy.
  const [streak, setStreak] = useState<number | null>(null);
  const streakKey = decision && decision.kind !== RULE_KIND ? `${decision.orgId}|${decision.proposedBy}|${decision.kind}` : null;
  useEffect(() => {
    if (!decision || !streakKey) return;
    let alive = true;
    okStreak(supabase, decision)
      .then((n) => alive && setStreak(n))
      .catch(() => alive && setStreak(null)); // progress is a nicety; the decision still works without it
    return () => {
      alive = false;
    };
    // Refetch only when the agent or kind changes, or after an answer.
  }, [streakKey, decision?.answer?.at]);

  const answer = useCallback(async (input: Omit<AnswerInput, 'decisionId'>) => {
    if (!id) return;
    setDecision(await answerDecision(supabase, { ...input, decisionId: id }));
  }, [id]);

  const takeBack = useCallback(async () => {
    if (!id) return;
    setDecision(await unanswerDecision(supabase, id));
  }, [id]);

  return { decision, loading, error, answer, takeBack, streak };
}
