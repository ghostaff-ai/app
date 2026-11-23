import type { Agent, MyOrganization } from '@ghostaff/shared';
import { agentHasThreads, agentHello } from '@ghostaff/shared/services';
import { useEffect } from 'react';
import { firstHello } from '../firstHello';
import { supabase } from '../supabase';
import { letAgentAnswer } from './useChat';
import { useEngine } from './useConnections';

// Agents greeted in this app session, across Hoy's mounts (lib/firstHello.ts).
const tried = new Map<string, number>();

/**
 * Hoy's part in Secretaría starting on her own: her first hello, once, when the space can run her.
 * `focused`: Hoy is on screen; coming back to it is when a failed hello is tried again.
 * `onGreeted`: her thread exists now (Hoy reads its threads again).
 */
export function useFirstHello(
  space: MyOrganization | null,
  agents: Agent[],
  aiReady: boolean,
  focused: boolean,
  onGreeted?: () => void,
): void {
  const engine = useEngine();
  const key = agents.map((a) => a.id).join(',');
  useEffect(() => {
    if (!engine || !focused) return;
    void firstHello(
      { space, agents, aiReady },
      {
        hasThreads: (id) => agentHasThreads(supabase, id),
        hello: (id) => agentHello(engine, id),
        answer: (threadId) => {
          letAgentAnswer(engine, threadId);
          onGreeted?.();
        },
        tried,
        now: Date.now,
      },
    );
    // The agents' ids stand for the list: a new array with the same agents changes nothing.
  }, [engine, space?.id, space?.role, key, aiReady, focused]);
}
