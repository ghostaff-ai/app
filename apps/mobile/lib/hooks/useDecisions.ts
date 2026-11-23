import type { Decision } from '@ghostaff/shared';
import { RULE_KIND } from '@ghostaff/shared';
import {
  answerDecision,
  countWaiting,
  getDecision,
  listDecidedDecisions,
  listMySnoozes,
  listOpenDecisions,
  okStreak,
  snoozeDecision,
  unanswerDecision,
  unsnoozeDecision,
  type AnswerInput,
} from '@ghostaff/shared/services';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { deckOf, asideCount, tomorrowMorning } from '../deck';
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

// Every list of open decisions on screen (the deck, the tab's count, the
// sidebar's) reloads when an answer is given or taken back anywhere.
const inboxListeners = new Set<() => void>();
function inboxChanged() {
  for (const f of inboxListeners) f();
}

/** The open decisions of one organisation, what waits first. */
export function useInbox(orgId: string | null) {
  const list = useDecisionList(orgId, fetchOpen);
  const { reload } = list;
  useEffect(() => {
    const f = () => void reload();
    inboxListeners.add(f);
    return () => {
      inboxListeners.delete(f);
    };
  }, [reload]);
  return list;
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
    inboxChanged();
  }, [id]);

  const takeBack = useCallback(async () => {
    if (!id) return;
    setDecision(await unanswerDecision(supabase, id));
    inboxChanged();
  }, [id]);

  return { decision, loading, error, answer, takeBack, streak };
}

/** What the person did to the last card, so it can be undone. */
export type DeckMove = { decision: Decision; kind: 'ok' | 'no' | 'later' };

/**
 * The decision deck (three-tabs.md, decision 7): the cards that wait for the
 * person, one at a time, and what they do with the top one. A card leaves at
 * once and comes back if the database says no; the last move can be undone.
 */
export function useDeck(orgId: string | null) {
  const inbox = useInbox(orgId);
  const [aside, setAside] = useState<Record<string, string>>({});
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [showAside, setShowAside] = useState(false);
  const [last, setLast] = useState<DeckMove | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { reload: reloadInbox } = inbox;

  const reload = useCallback(async () => {
    if (!orgId) return;
    const [snoozes] = await Promise.all([listMySnoozes(supabase, orgId).catch(() => ({})), reloadInbox()]);
    setAside(snoozes);
    setGone(new Set());
  }, [orgId, reloadInbox]);

  useEffect(() => {
    if (orgId) void listMySnoozes(supabase, orgId).then(setAside).catch(() => setAside({}));
  }, [orgId]);

  const cards = useMemo(() => deckOf(inbox.decisions, aside, { showAside, gone }), [inbox.decisions, aside, showAside, gone]);
  const asideTotal = useMemo(() => asideCount(inbox.decisions, aside), [inbox.decisions, aside]);

  const leave = (id: string) => setGone((g) => new Set(g).add(id));
  const stay = (id: string) =>
    setGone((g) => {
      const n = new Set(g);
      n.delete(id);
      return n;
    });

  const act = useCallback(async (decision: Decision, kind: DeckMove['kind']) => {
    setError(null);
    leave(decision.id);
    try {
      if (kind === 'later') {
        const until = tomorrowMorning();
        await snoozeDecision(supabase, decision.id, until);
        setAside((a) => ({ ...a, [decision.id]: until.toISOString() }));
      } else {
        await answerDecision(supabase, { decisionId: decision.id, answer: kind });
      }
      setLast({ decision, kind });
      if (kind !== 'later') inboxChanged();
    } catch (e) {
      stay(decision.id);
      setError(message(e));
    }
  }, []);

  const clearLast = useCallback(() => setLast(null), []);

  const undo = useCallback(async () => {
    if (!last) return;
    setError(null);
    const { decision, kind } = last;
    setLast(null);
    try {
      if (kind === 'later') {
        await unsnoozeDecision(supabase, decision.id);
        setAside((a) => {
          const n = { ...a };
          delete n[decision.id];
          return n;
        });
      } else {
        await unanswerDecision(supabase, decision.id);
        inboxChanged();
      }
      stay(decision.id);
    } catch (e) {
      setError(message(e));
    }
  }, [last]);

  return {
    cards,
    asideTotal,
    showAside,
    setShowAside,
    loading: inbox.loading,
    loadError: inbox.error,
    error,
    last,
    clearLast,
    act,
    undo,
    reload,
  };
}
