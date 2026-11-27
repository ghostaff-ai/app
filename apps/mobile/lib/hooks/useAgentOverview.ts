import type { AgentRun } from '@ghostaff/shared';
import { listAgentRuns, listWorkingAgents } from '@ghostaff/shared/services';
import { useCallback, useState } from 'react';
import { useInbox } from '@/lib/hooks/useDecisions';
import { supabase } from '@/lib/supabase';

// The top of an agent's page (team-board.md, decision 4): what it is doing,
// its decisions waiting for you, and what its runs of the last week say they did.

/** How far back «Últimamente» looks. */
const RECENT_DAYS = 7;

export function useAgentOverview(orgId: string | null, agentId: string | undefined) {
  const inbox = useInbox(orgId);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [working, setWorking] = useState(false);
  const { reload: reloadInbox } = inbox;

  const reload = useCallback(async () => {
    if (!orgId || !agentId) return;
    void reloadInbox();
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
    // Both are extras on top of the page: on an error it shows without them.
    const [recent, busy] = await Promise.all([
      listAgentRuns(supabase, agentId, since).catch(() => [] as AgentRun[]),
      listWorkingAgents(supabase, orgId).catch(() => new Set<string>()),
    ]);
    setRuns(recent);
    setWorking(busy.has(agentId));
  }, [orgId, agentId, reloadInbox]);

  const waiting = inbox.decisions.filter((d) => !d.answer && d.agent?.id === agentId);
  return { waiting, runs, working, reload };
}
