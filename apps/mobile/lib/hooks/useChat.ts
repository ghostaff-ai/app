import { type AgentLevel, type ChatMessage, type ChatThread, isVoicePart, messageText, type OrgMember } from '@ghostaff/shared';
import {
  askAgent,
  chatWith,
  conversationReaders,
  type EngineAccess,
  getThread,
  listMembers,
  listMessages,
  listThreads,
  markThreadRead,
  myAgentLevels,
  postMessage,
  sendVoiceNote,
  subscribeToThread,
  type ThreadHead,
  transcribeVoiceNote,
  voiceNoteUrl,
} from '@ghostaff/shared/services';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../supabase';
import { useEngine } from './useConnections';
import type { RecordedNote } from './useVoiceNote';

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

const transcription = (m: ChatMessage) => m.parts.find(isVoicePart)?.transcription;

/** Whether `next` is a later version of the same message than `prev` (an agent's reply changes as it is written). */
function isNewer(prev: ChatMessage, next: ChatMessage): boolean {
  // A voice note's transcript, once there (or once it is known nobody spoke), is never undone by an older copy.
  const before = transcription(prev);
  if ((before === 'done' || before === 'empty') && transcription(next) === 'pending') return false;
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
 * while the person can see it. `send` writes as the signed-in person.
 */
export function useThread(threadId: string | null) {
  const [head, setHead] = useState<ThreadHead | null | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const markRead = useMarkReadWhileSeen(threadId);

  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    const load = () =>
      Promise.all([getThread(supabase, threadId), listMessages(supabase, threadId)])
        .then(([h, ms]) => {
          if (!alive) return;
          setHead(h);
          setMessages((live) => ms.reduce(addMessage, live));
          if (h) markRead.found();
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
        markRead.now();
      },
      () => void load(),
    );
    void load();
    return () => {
      alive = false;
      stop();
    };
  }, [threadId, markRead]);

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

  /** Shows a message the engine wrote for the person (a voice note) without waiting for Realtime. */
  const add = useCallback((m: ChatMessage) => setMessages((list) => addMessage(list, m)), []);

  // Who sees it may change (its opener, on another screen): read the head again.
  const reloadHead = useCallback(async () => {
    if (!threadId) return;
    try {
      setHead(await getThread(supabase, threadId));
    } catch (e) {
      setError(message(e));
    }
  }, [threadId]);

  return { head, messages, error, send, add, reloadHead };
}

/**
 * Marks a thread read only while the person can see it: the app in the
 * foreground and its screen focused. On Android the Realtime socket stays open
 * in the background, so a reply arriving then would otherwise be marked read
 * and its push closed unseen. What arrived meanwhile is marked when the app
 * comes back, or the screen is focused again. `found()` says the thread exists
 * and may be read (it loaded); `now()` marks it if it is seen.
 */
function useMarkReadWhileSeen(threadId: string | null) {
  const focused = useRef(false);
  const found = useRef(false);

  const api = useMemo(() => {
    const now = () => {
      if (!threadId || !found.current || !focused.current || AppState.currentState !== 'active') return;
      void markThreadRead(supabase, threadId).catch(() => {});
    };
    return {
      now,
      found: () => {
        found.current = true;
        now();
      },
      focus: (on: boolean) => {
        focused.current = on;
        now();
      },
    };
  }, [threadId]);

  // A new thread hasn't loaded yet.
  useEffect(() => {
    found.current = false;
  }, [threadId]);

  useFocusEffect(
    useCallback(() => {
      api.focus(true);
      return () => api.focus(false);
    }, [api]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') api.now();
    });
    return () => sub.remove();
  }, [api]);

  return api;
}

/** How many people read a conversation, once known; null while loading or if it can't be read. */
export function useReaders(threadId: string | null, visibility: string | undefined) {
  const [readers, setReaders] = useState<number | null>(null);
  const load = useCallback(async () => {
    if (!threadId || !visibility) return;
    setReaders(await conversationReaders(supabase, threadId).catch(() => null));
  }, [threadId, visibility]);
  useEffect(() => {
    void load();
  }, [load]);
  return { readers, reload: load };
}

/** A short-lived link to play a voice note. */
export const voiceNoteLink = (path: string) => voiceNoteUrl(supabase, path);

/**
 * Asks the thread's agent to answer, without waiting: the reply arrives in the
 * thread live. Only a failure to reach the engine is reported.
 */
export function letAgentAnswer(engine: EngineAccess, threadId: string, onError?: (e: string) => void) {
  askAgent(engine, threadId).catch(() => onError?.('El agente no ha podido contestar ahora. Prueba de nuevo en un momento.'));
}

/**
 * The person's one chat with an agent (three-tabs.md, decision 3), live, with
 * what the agent did on its own in it too (decision 12). The first message
 * opens the chat; `send` writes in it and asks the agent to answer.
 */
export function useAgentChat(orgId: string | null, agentId: string | null) {
  const fetch = useCallback(() => listThreads(supabase, orgId!, agentId!), [orgId, agentId]);
  const { data: threads, loading, reload } = useLoad<ChatThread[]>(orgId && agentId ? fetch : null, []);
  const [opened, setOpened] = useState<string | null>(null);
  const chatId = threads.find((t) => t.personal)?.id ?? opened;
  const chat = useThread(chatId);
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);

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

  /**
   * A voice note (voice.md): the engine stores it in the chat (opening it with
   * the first note) and answers at once; then it is transcribed and the agent
   * answers, both arriving live. A failed transcript shows on the note itself.
   */
  const sendVoice = useCallback(
    async (note: RecordedNote) => {
      if (!engine || !agentId) throw new Error('not signed in');
      const m = await sendVoiceNote(engine, agentId, note);
      if (chatId) chat.add(m);
      else setOpened(m.threadId);
      void transcribeVoiceNote(engine, m.id).catch(() => {});
    },
    [engine, agentId, chatId, chat.add],
  );

  const retryTranscript = useCallback(
    async (messageId: string) => {
      if (!engine) throw new Error('not signed in');
      await transcribeVoiceNote(engine, messageId);
    },
    [engine],
  );

  return {
    loading: loading && threads.length === 0,
    messages: chat.messages,
    error: error ?? chat.error,
    send,
    sendVoice,
    retryTranscript,
    reload,
  };
}
