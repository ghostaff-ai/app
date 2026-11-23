import { type AgentLevel, type ChatMessage, type ChatThread, messageText, type OrgMember } from '@ghostaff/shared';
import {
  askAgent,
  chatWith,
  type EngineAccess,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { useEngine } from './useConnections';

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

/** Whether `next` is a later version of the same message than `prev` (an agent's reply changes as it is written). */
function isNewer(prev: ChatMessage, next: ChatMessage): boolean {
  if (prev.state !== 'working') return next.state !== 'working';
  if (next.state !== 'working') return true;
  return messageText(next.parts).length >= messageText(prev.parts).length;
}

/**
 * Adds a message, or its later version (it arrives from post_message, from the
 * history and from Realtime, and an agent's reply arrives many times as it grows).
 */
export function addMessage(list: ChatMessage[], m: ChatMessage): ChatMessage[] {
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) {
    const prev = list[i];
    if (!prev || !isNewer(prev, m)) return list;
    const next = list.slice();
    next[i] = m;
    return next;
  }
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
    const load = () =>
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
          setHead((h) => h ?? null);
        });
    // Live changes from the moment the subscription delivers; the history is
    // loaded now, for a quick first paint, and again then, for anything
    // written in between (an agent's reply can finish in that gap).
    const stop = subscribeToThread(
      supabase,
      threadId,
      (m) => {
        if (!alive) return;
        setMessages((list) => addMessage(list, m));
        void markThreadRead(supabase, threadId).catch(() => {});
      },
      () => void load(),
    );
    void load();
    return () => {
      alive = false;
      stop();
    };
  }, [threadId]);

  const engine = useEngine();
  const send = useCallback(
    async (body: string) => {
      if (!threadId) return;
      const m = await postMessage(supabase, threadId, body);
      setMessages((list) => addMessage(list, m));
      // The agent's reply arrives through Realtime as it is written.
      if (engine) letAgentAnswer(engine, threadId, setError);
    },
    [threadId, engine],
  );

  return { head, messages, error, send };
}

/**
 * Asks the thread's agent to answer, without waiting: the reply arrives in the
 * thread live. Only a failure to reach the engine is reported.
 */
export function letAgentAnswer(engine: EngineAccess, threadId: string, onError?: (e: string) => void) {
  askAgent(engine, threadId).catch(() => onError?.('El agente no ha podido contestar ahora. Prueba de nuevo en un momento.'));
}

/**
 * The person's one chat with an agent (three-tabs.md, decision 3): their own
 * thread with it and its «Avisos», as one conversation, live. The first
 * message opens the chat; `send` writes in it and asks the agent to answer.
 */
export function useAgentChat(orgId: string | null, agentId: string | null) {
  const fetch = useCallback(() => listThreads(supabase, orgId!, agentId!), [orgId, agentId]);
  const { data: threads, loading, reload } = useLoad<ChatThread[]>(orgId && agentId ? fetch : null, []);
  const [opened, setOpened] = useState<string | null>(null);
  const chatId = threads.find((t) => t.personal)?.id ?? opened;
  const noticesId = threads.find((t) => t.notices)?.id ?? null;
  const chat = useThread(chatId);
  const notices = useThread(noticesId);
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);

  const messages = useMemo(
    () => (noticesId ? [...chat.messages, ...notices.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : chat.messages),
    [chat.messages, notices.messages, noticesId],
  );

  const send = useCallback(
    async (body: string) => {
      if (chatId) return chat.send(body);
      if (!agentId) return;
      const m = await chatWith(supabase, agentId, body);
      setOpened(m.threadId);
      if (engine) letAgentAnswer(engine, m.threadId, setError);
    },
    [chatId, chat.send, agentId, engine],
  );

  return {
    loading: loading && threads.length === 0,
    messages,
    error: error ?? chat.error ?? notices.error,
    send,
    reload,
  };
}
