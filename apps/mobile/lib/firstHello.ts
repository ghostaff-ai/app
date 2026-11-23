import type { AgentGhost, MembershipRole } from '@ghostaff/shared';

// Secretaría starts on her own (welcome-and-spaces.md): she is hired with every
// new space, and the first time an owner opens Hoy with an AI the agents can
// run on, she introduces herself in her first thread. Once per agent per app
// session; after a failure, tried again on a visit at least RETRY_AFTER_MS later
// (Hoy re-renders several times as it loads: an engine that is down isn't hit each time).

export const RETRY_AFTER_MS = 30_000;

export interface FirstHelloDeps {
  hasThreads: (agentId: string) => Promise<boolean>;
  hello: (agentId: string) => Promise<{ threadId: string }>;
  answer: (threadId: string) => void;
  /** Agents greeted, being greeted, or whose greeting failed (with when), in this app session. */
  tried: Map<string, number>;
  now: () => number;
}

export async function firstHello(
  { space, agents, aiReady }: {
    space: { id: string; role: MembershipRole } | null;
    agents: { id: string; orgId: string; ghost: AgentGhost }[];
    aiReady: boolean;
  },
  { hasThreads, hello, answer, tried, now }: FirstHelloDeps,
): Promise<void> {
  if (space?.role !== 'owner' || !aiReady) return;
  // While you switch spaces the list may still be the last space's: only this space's Secretaría.
  const her = agents.find((a) => a.ghost === 'secretaria' && a.orgId === space.id);
  if (!her) return;
  const failedAt = tried.get(her.id);
  if (failedAt !== undefined && (failedAt === Infinity || now() - failedAt < RETRY_AFTER_MS)) return;
  tried.set(her.id, Infinity);
  try {
    if (await hasThreads(her.id)) return;
    const { threadId } = await hello(her.id);
    answer(threadId);
  } catch {
    tried.set(her.id, now());
  }
}
