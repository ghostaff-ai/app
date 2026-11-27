import { type AgentLevel, type ChatMessage, type ChatThread, isVoicePart, messageText, type OrgMember, type Reaction } from '@ghostaff/shared';
import type { Typing } from '@ghostaff/shared/services';
import {
  askAgent,
  askAboutDecision,
  chatWith,
  deleteMessage,
  editMessage,
  forwardToAgent,
  joinTyping,
  listReactions,
  pinMessage,
  reactTo,
  subscribeToReactions,
  type EngineAccess,
  getThread,
  listMembers,
  listMessages,
  listThreads,
  markThreadRead,
  myAgentLevels,
  myReadMark,
  readByAllUntil,
  postMessage,
  type OutgoingFile,
  type OutgoingNote,
  sendFileToThread,
  sendVoiceNote,
  sendVoiceNoteToThread,
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

/** The agents' chats the person may see in the organisation, newest first; with `agentId`, that agent's. */
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
  /** The person's read mark when the chat opened: where «sin leer» begins. Undefined until known. */
  const [openedAt, setOpenedAt] = useState<string | null | undefined>(undefined);
  const [markRead, onScreen] = useMarkReadWhileSeen(threadId);

  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    setOpenedAt(undefined);
    // Read once, before the chat is marked read (the first load's markRead.found()).
    let mark: Promise<string | null> | null = myReadMark(supabase, threadId).catch(() => null);
    const load = () =>
      Promise.all([getThread(supabase, threadId), listMessages(supabase, threadId), mark])
        .then(([h, ms, m]) => {
          if (!alive) return;
          if (mark) {
            setOpenedAt(m ?? null);
            mark = null;
          }
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
      (h) => alive && setHead((prev) => (prev ? { ...prev, pinnedMessage: h.pinnedMessage } : prev)),
    );
    void load();
    return () => {
      alive = false;
      stop();
    };
  }, [threadId, markRead]);

  // Reactions, live (chat-like-whatsapp.md, phase 2): one per person and message.
  const [reactions, setReactions] = useState<Reaction[]>([]);
  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    const put = (r: Reaction, removed: boolean) =>
      setReactions((list) => [...list.filter((x) => !(x.messageId === r.messageId && x.userId === r.userId)), ...(removed ? [] : [r])]);
    const stop = subscribeToReactions(supabase, threadId, (r, removed) => alive && put(r, removed));
    void listReactions(supabase, threadId)
      .then((rs) => alive && setReactions(rs))
      .catch(() => {});
    return () => {
      alive = false;
      stop();
    };
  }, [threadId]);

  const engine = useEngine();
  const send = useCallback(
    async (body: string, quoted?: string | null) => {
      if (!threadId) return;
      const m = await postMessage(supabase, threadId, body, quoted);
      setMessages((list) => addMessage(list, m));
      // The agent's reply arrives through Realtime as it is written.
      if (engine) letAgentAnswer(engine, threadId, setError);
    },
    [threadId, engine],
  );

  /** A photo or a document to this chat (files.ts); the agent answers it as a message. */
  const sendFile = useCallback(
    async (file: OutgoingFile) => {
      if (!engine || !threadId) throw new Error('not signed in');
      const m = await sendFileToThread(engine, threadId, file);
      setMessages((list) => addMessage(list, m));
    },
    [engine, threadId],
  );

  /** What a held message offers (MessageMenu): each one live for everyone through Realtime. */
  const actions = useMemo(
    () => ({
      edit: async (messageId: string, body: string) => {
        const m = await editMessage(supabase, messageId, body);
        setMessages((list) => addMessage(list, m));
      },
      remove: async (messageId: string) => {
        if (!engine) throw new Error('not signed in');
        await deleteMessage(engine, messageId);
      },
      react: async (messageId: string, emoji: string | null, me: string) => {
        // At once on screen; the database's answer comes back through Realtime.
        setReactions((list) => [...list.filter((x) => !(x.messageId === messageId && x.userId === me)), ...(emoji ? [{ messageId, userId: me, emoji }] : [])]);
        await reactTo(supabase, messageId, emoji);
      },
      pin: async (messageId: string | null) => {
        if (!threadId) return;
        await pinMessage(supabase, threadId, messageId);
        setHead((h) => (h ? { ...h, pinnedMessage: messageId } : h));
      },
      forward: async (messageId: string, agentId: string) => {
        const m = await forwardToAgent(supabase, messageId, agentId);
        if (engine) letAgentAnswer(engine, m.threadId);
        return m.threadId;
      },
    }),
    [threadId, engine],
  );

  /** Shows a message the engine wrote for the person (a voice note) without waiting for Realtime. */
  const add = useCallback((m: ChatMessage) => setMessages((list) => addMessage(list, m)), []);

  const readByAll = useReadByAll(threadId, messages.length, onScreen);

  return { head, messages, error, send, add, openedAt, readByAll, reactions, actions, sendFile };
}

/**
 * Up to when everyone else has read the chat (readByAllUntil), for the blue
 * ticks: asked when the chat opens, when a message arrives, and every 15 s
 * while it is on screen (others' read marks don't come through Realtime).
 */
function useReadByAll(threadId: string | null, count: number, focused: boolean) {
  const [until, setUntil] = useState<string | null>(null);
  useEffect(() => {
    if (!threadId || !focused) return;
    let alive = true;
    const ask = () =>
      void readByAllUntil(supabase, threadId)
        .then((u) => alive && setUntil(u))
        .catch(() => {});
    ask();
    const every = setInterval(ask, 15_000);
    return () => {
      alive = false;
      clearInterval(every);
    };
  }, [threadId, focused, count]);
  return until;
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
  /** The same, as state: what else runs only while the chat is on screen (read ticks). */
  const [onScreen, setOnScreen] = useState(false);

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
      setOnScreen(true);
      return () => {
        api.focus(false);
        setOnScreen(false);
      };
    }, [api]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') api.now();
    });
    return () => sub.remove();
  }, [api]);

  return [api, onScreen] as const;
}

/**
 * Where a link to a thread id opens (a push or a card from before one chat per
 * agent): its agent's chat, or General (general-chat.md). Undefined while
 * loading, null when the person may not read it.
 */
export function useThreadRoute(threadId: string | null) {
  const [route, setRoute] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    getThread(supabase, threadId)
      .then((h) => alive && setRoute(!h ? null : h.kind === 'general' ? '/general' : `/chat/${h.agentId}`))
      .catch(() => alive && setRoute(null));
    return () => {
      alive = false;
    };
  }, [threadId]);
  return route;
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
 * An agent's one chat, live, shared by everyone who may see the agent
 * (group-chat-per-agent.md), with what the agent did on its own in it too. The
 * first message opens the chat; `send` writes in it and asks the agent to answer.
 */
export function useAgentChat(orgId: string | null, agentId: string | null) {
  const fetch = useCallback(() => listThreads(supabase, orgId!, agentId!), [orgId, agentId]);
  const { data: threads, loading, reload } = useLoad<ChatThread[]>(orgId && agentId ? fetch : null, []);
  const [opened, setOpened] = useState<string | null>(null);
  const chatId = threads[0]?.id ?? opened;
  const chat = useThread(chatId);
  const engine = useEngine();
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (body: string, quoted?: string | null) => {
      if (chatId) return chat.send(body, quoted);
      if (!agentId) return;
      const m = await chatWith(supabase, agentId, body);
      setOpened(m.threadId);
      if (engine) letAgentAnswer(engine, m.threadId, setError);
    },
    [chatId, chat.send, agentId, engine],
  );

  /** «Preguntar» on a decision: the message quotes it, in this chat (opened if it isn't yet). */
  const askAbout = useCallback(
    async (decisionId: string, body: string) => {
      const m = await askAboutDecision(supabase, decisionId, body);
      if (chatId) chat.add(m);
      else setOpened(m.threadId);
      if (engine) letAgentAnswer(engine, m.threadId, setError);
    },
    [chatId, chat.add, engine],
  );

  /**
   * A voice note (voice.md): the engine stores it in the chat (opening it with
   * the first note) and answers at once; then it is transcribed and the agent
   * answers, both arriving live. A failed transcript shows on the note itself.
   */
  const sendVoice = useCallback(
    async (note: RecordedNote, mentions: string[] = [], quote?: string | null) => {
      if (!engine || !agentId) throw new Error('not signed in');
      const m = await sendVoiceNote(engine, agentId, { ...note, mentions, quote });
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
    chatId,
    loading: loading && threads.length === 0,
    messages: chat.messages,
    openedAt: chat.openedAt,
    readByAll: chat.readByAll,
    reactions: chat.reactions,
    actions: chat.actions,
    pinned: chat.head?.pinnedMessage ?? null,
    sendFile: chat.sendFile,
    error: error ?? chat.error,
    send,
    askAbout,
    sendVoice,
    retryTranscript,
    reload,
  };
}

/**
 * General, the people's chat (general-chat.md), live: everyone in the
 * organisation reads and writes it, mostly by voice notes. Nobody answers
 * unless a message @mentions an agent: the engine decides, as in any chat.
 * A voice note goes with the agents tagged before recording it (decision 6).
 */
export function useGeneralChat(orgId: string | null) {
  const fetch = useCallback(async () => (await listThreads(supabase, orgId!)).find((t) => t.kind === 'general') ?? null, [orgId]);
  const { data: general, loading } = useLoad<ChatThread | null>(orgId ? fetch : null, null);
  const chatId = general?.id ?? null;
  const chat = useThread(chatId);
  const engine = useEngine();

  const sendVoice = useCallback(
    async (note: RecordedNote, mentions: string[], quote?: string | null) => {
      if (!engine || !chatId) throw new Error('not signed in');
      const outgoing: OutgoingNote = { ...note, mentions, quote };
      const m = await sendVoiceNoteToThread(engine, chatId, outgoing);
      chat.add(m);
      void transcribeVoiceNote(engine, m.id).catch(() => {});
    },
    [engine, chatId, chat.add],
  );

  const retryTranscript = useCallback(
    async (messageId: string) => {
      if (!engine) throw new Error('not signed in');
      await transcribeVoiceNote(engine, messageId);
    },
    [engine],
  );

  return {
    chatId,
    loading: loading || (chatId !== null && chat.head === undefined),
    missing: !loading && general === null,
    messages: chat.messages,
    openedAt: chat.openedAt,
    readByAll: chat.readByAll,
    reactions: chat.reactions,
    actions: chat.actions,
    pinned: chat.head?.pinnedMessage ?? null,
    sendFile: chat.sendFile,
    error: chat.error,
    send: chat.send,
    sendVoice,
    retryTranscript,
  };
}

/**
 * «Está escribiendo…» (chat-like-whatsapp.md, phase 4): who else is typing or
 * recording in the chat, and `say` to tell them, at most every 2 s.
 */
export function useTyping(threadId: string | null, me: { userId: string; name: string } | null) {
  const [others, setOthers] = useState<Typing[]>([]);
  const channel = useRef<{ say: (k: Typing['kind']) => void; leave: () => void } | null>(null);
  const last = useRef(0);
  useEffect(() => {
    if (!threadId || !me) return;
    const joined = joinTyping(supabase, threadId, me, setOthers);
    channel.current = joined;
    return () => {
      joined.leave();
      channel.current = null;
      setOthers([]);
    };
  }, [threadId, me?.userId, me?.name]);
  const say = useCallback((kind: Typing['kind']) => {
    if (Date.now() - last.current < 2000) return;
    last.current = Date.now();
    channel.current?.say(kind);
  }, []);
  return { others, say };
}
