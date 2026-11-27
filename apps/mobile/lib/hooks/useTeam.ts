import { listWorkingAgents } from '@ghostaff/shared/services';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { canRunAgents } from '@/lib/connections';
import { useAgents } from '@/lib/hooks/useAgents';
import { useMembers, useThreads } from '@/lib/hooks/useChat';
import { useConnections } from '@/lib/hooks/useConnections';
import { useInbox } from '@/lib/hooks/useDecisions';
import { useFirstHello } from '@/lib/hooks/useFirstHello';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// What Equipo shows, for the phone's board (components/team/TeamBoard.tsx)
// and the desktop's list (components/team/TeamList.tsx): the agents, their
// chats, the people, whether the team can work, and, for the board, what each
// agent is doing (team-board.md, decision 3). Everything reloads when Equipo
// comes back into view.

/** How often the board asks again who is at work while it is on screen. */
const WORKING_EVERY_MS = 20_000;

export function useTeam({ withStatus = false }: { withStatus?: boolean } = {}) {
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const agents = useAgents(orgId);
  const { threads, reload: reloadThreads } = useThreads(orgId);
  const { members, reload: reloadMembers } = useMembers(orgId);
  const connections = useConnections(orgId);
  const inbox = useInbox(withStatus ? orgId : null);
  const [working, setWorking] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(true);
  const { reload: reloadAgents } = agents;
  const { reload: reloadConnections } = connections;
  const { reload: reloadInbox } = inbox;

  const reloadWorking = useCallback(async () => {
    if (!withStatus || !orgId) return;
    // Who is at work is a nicety on top of the board: on an error, nobody shows as working.
    setWorking(await listWorkingAgents(supabase, orgId).catch(() => new Set<string>()));
  }, [withStatus, orgId]);

  const reload = useCallback(() => {
    void reloadAgents();
    void reloadThreads();
    void reloadConnections();
    void reloadMembers();
    if (withStatus) {
      void reloadInbox();
      void reloadWorking();
    }
  }, [reloadAgents, reloadThreads, reloadConnections, reloadMembers, reloadInbox, reloadWorking, withStatus]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      reload();
      return () => setFocused(false);
    }, [reload]),
  );

  useEffect(() => {
    if (!withStatus || !focused) return;
    const t = setInterval(() => void reloadWorking(), WORKING_EVERY_MS);
    return () => clearInterval(t);
  }, [withStatus, focused, reloadWorking]);

  // Secretaría comes hired with a new space and says hello in her chat once
  // its AI is there (welcome-and-spaces.md); her card then shows it, unread.
  const canWork = connections.loaded && !connections.error && canRunAgents(connections.items);
  useFirstHello(active, agents.items, canWork, focused, reloadThreads);

  return {
    active,
    agents,
    threads,
    members,
    decisions: inbox.decisions,
    working,
    /** An owner never gets here without an AI account (the layout's gate); a member can't connect one. */
    noAi: connections.loaded && !connections.error && !canRunAgents(connections.items),
    owner: active?.role === 'owner',
    reload,
    reloadThreads,
  };
}
