import type { AgentLevel, ChatMessage, ChatThread, OrgMember } from '@ghostaff/shared';
import {
  getThread,
  listMembers,
  listMessages,
  listThreads,
  markThreadRead,
  myAgentLevels,
  postMessage,
  subscribeToThread,
  type ThreadHead,
} from '@ghostaff/shared/services';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';

// The team chat's data for the screens (docs/plans/ongoing/team-chat.md). All
// of it goes through @ghostaff/shared/services; row-level security decides what
// each person gets.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useLoad<T>(fetch: (() => Promise<T>) | null, empty: T) {
  const [data, setData] = useState<T>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const emptyRef = useRef(empty);

  const load = useCallback(async () => {
    if (!fetch) {
      setData(emptyRef.current);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setData(await fetch());
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

  return { data, loading, error, reload: load };
}

/** Threads the person may see in the organisation, newest first; with `agentId`, that agent's. */
export function useThreads(orgId: string | null, agentId?: string) {
  const fetch = useCallback(() => listThreads(supabase, orgId!, agentId), [orgId, agentId]);
  const { data, ...rest } = useLoad<ChatThread[]>(orgId ? fetch : null, []);
  return { threads: data, ...rest };
}

/** The organisation's members, by name. */
export function useMembers(orgId: string | null) {
  const fetch = useCallback(() => listMembers(supabase, orgId!), [orgId]);
  const { data, ...rest } = useLoad<OrgMember[]>(orgId ? fetch : null, []);
  return { members: data, ...rest };
}

/** The person's level on each agent they may see, by agent id. */
export function useMyLevels(orgId: string | null) {
  const fetch = useCallback(() => myAgentLevels(supabase, orgId!), [orgId]);
  const { data, ...rest } = useLoad<Record<string, AgentLevel>>(orgId ? fetch : null, {});
  return { levels: data, ...rest };
}

/** Appends a message unless it is already there (it arrives both from post_message and from Realtime). */
export function addMessage(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  if (list.some((x) => x.id === m.id)) return list;
  const next = [...list, m];
  // Realtime may deliver out of order; keep them in the order they were written.
  return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * One thread, live: its messages, new ones as anyone writes them, marked read
 * while it is open. `send` writes as the signed-in person.
 */
export function useThread(threadId: string | null) {
  const [head, setHead] = useState<ThreadHead | null | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    // Subscribe first, so nothing written while the history loads is lost.
    const stop = subscribeToThread(supabase, threadId, (m) => {
      if (!alive) return;
      setMessages((list) => addMessage(list, m));
      void markThreadRead(supabase, threadId).catch(() => {});
    });
    Promise.all([getThread(supabase, threadId), listMessages(supabase, threadId)])
      .then(([h, ms]) => {
        if (!alive) return;
        setHead(h);
        setMessages((live) => ms.reduce(addMessage, live));
        if (h) void markThreadRead(supabase, threadId).catch(() => {});
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(message(e));
        setHead(null);
      });
    return () => {
      alive = false;
      stop();
    };
  }, [threadId]);

  const send = useCallback(
    async (body: string) => {
      if (!threadId) return;
      const m = await postMessage(supabase, threadId, body);
      setMessages((list) => addMessage(list, m));
    },
    [threadId],
  );

  return { head, messages, error, send };
}
