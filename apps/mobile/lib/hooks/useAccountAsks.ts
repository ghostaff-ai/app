import { type AccountAskPart, type AccountProvider, type AccountStates, type Agent, type ChatMessage, accountNeed, isAccountAskPart } from '@ghostaff/shared';
import { EngineError, listConnectorRequests, requestConnector, resumeAfterAccount, setAgentAccounts } from '@ghostaff/shared/services';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { useAccountConnect } from './useAccountConnect';
import { useConnections, useEngine } from './useConnections';

// What an agent's card asking for an account can do in a chat (docs/plans/
// ongoing/connector-in-chat.md): an owner connects it, gives it to the agent,
// or anyone asks us for an app we lack. Once the account is there the agent
// goes on: right after the press, or, when an owner connected it elsewhere,
// as soon as this chat sees it, if the card is in the agent's latest message.
// The engine checks it all again and goes on once, whoever asks.

/** What a chat screen lets an agent's card asking for an account do (AccountAskCard). */
export interface AskControls {
  /** The viewer is an owner: they connect accounts and give them to agents. */
  canConnect: boolean;
  /** The organisation's owners, for «Lo conecta quien es propietario: Ana». */
  owners: string[];
  /** The organisation already asked us for this app. */
  requested(name: string): boolean;
  /** The account is there and the agent is about to go on. */
  resuming(askId: string): boolean;
  /** Connects, gives or asks for it; resolves with what went wrong, if anything. */
  act(ask: AccountAskPart): Promise<string | null>;
}

type Where = { threadId: string; agentId: string | null };

/** The open asks of the agent's latest message whose account is now there: the agent can go on. */
export function asksToResume(messages: readonly ChatMessage[], ready: (ask: AccountAskPart, agentId: string | null) => boolean): Array<{ threadId: string; askId: string }> {
  const latest = [...messages].reverse().find((m) => m.authorKind === 'agent');
  if (!latest || latest.state !== 'done') return [];
  return latest.parts
    .filter(isAccountAskPart)
    .filter((a) => a.status === 'open' && a.need !== 'unsupported' && ready(a, latest.authorAgentId))
    .map((a) => ({ threadId: latest.threadId, askId: a.askId }));
}

export function useAccountAsks(opts: {
  orgId: string | null;
  messages: readonly ChatMessage[];
  agents: readonly Agent[];
  reloadAgents: () => Promise<void>;
  owners: string[];
  isOwner: boolean;
  /** Where the connect's sign-in comes back to: this chat. */
  returnPath: string;
}): AskControls {
  const { orgId, messages, agents, reloadAgents, owners, isOwner, returnPath } = opts;
  const engine = useEngine();
  const { items } = useConnections(orgId);
  const { connect } = useAccountConnect(orgId);
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const [resuming, setResuming] = useState<ReadonlySet<string>>(new Set());
  // Asks this screen already let go on, so a render never asks twice.
  const tried = useRef(new Set<string>());

  const states: AccountStates = useMemo(
    () => new Map(items.filter((i) => i.kind === 'account').map((i) => [i.provider, i.status === 'failing' ? 'failing' : 'ok'] as const)),
    [items],
  );
  const where = useMemo(() => {
    const m = new Map<string, Where>();
    for (const msg of messages) for (const p of msg.parts) if (isAccountAskPart(p)) m.set(p.askId, { threadId: msg.threadId, agentId: msg.authorAgentId });
    return m;
  }, [messages]);
  const ready = useCallback(
    (ask: AccountAskPart, agentId: string | null) => accountNeed(ask.connector, states, agents.find((a) => a.id === agentId)?.accounts) === 'have',
    [states, agents],
  );

  // The names the organisation asked us for, once there is a card for an app we lack.
  const asksForAppsWeLack = useMemo(() => messages.some((m) => m.parts.some((p) => isAccountAskPart(p) && p.need === 'unsupported')), [messages]);
  useEffect(() => {
    if (!orgId || !asksForAppsWeLack) return;
    let live = true;
    listConnectorRequests(supabase, orgId)
      .then((rs) => live && setRequested(new Set(rs.map((r) => r.name.toLocaleLowerCase('es')))))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [orgId, asksForAppsWeLack]);

  /** Lets the agent go on; resolves with what the person should read if it can't. */
  const resume = useCallback(
    async (askId: string): Promise<string | null> => {
      const w = where.get(askId);
      if (!engine || !w || tried.current.has(askId)) return null;
      tried.current.add(askId);
      setResuming((s) => new Set(s).add(askId));
      try {
        await resumeAfterAccount(engine, w.threadId, askId);
        return null;
      } catch (e) {
        const code = e instanceof EngineError ? e.code : 'failed';
        if (code === 'already_done') return null;
        // Worth another go later: the agent was answering, or the connection hadn't reached the engine.
        tried.current.delete(askId);
        if (code === 'busy') return 'Está contestando otra cosa. Vuelve a pulsar cuando acabe.';
        if (code === 'not_yet') return 'Todavía no le llega. Revisa en su página qué cuentas puede usar.';
        return 'No he podido seguir. Vuelve a pulsar en un momento.';
      } finally {
        setResuming((s) => {
          const next = new Set(s);
          next.delete(askId);
          return next;
        });
      }
    },
    [engine, where],
  );

  // An account connected elsewhere (Conexiones, another phone): the agent goes on when this chat sees it.
  useEffect(() => {
    for (const r of asksToResume(messages, ready)) if (!tried.current.has(r.askId)) void resume(r.askId);
  }, [messages, ready, resume]);

  const act = useCallback(
    async (ask: AccountAskPart): Promise<string | null> => {
      if (!orgId) return null;
      if (ask.need === 'unsupported') {
        await requestConnector(supabase, orgId, ask.name);
        setRequested((s) => new Set(s).add(ask.name.toLocaleLowerCase('es')));
        return null;
      }
      if (!ask.connector) return null;
      if (ask.need === 'grant') {
        const agent = agents.find((a) => a.id === where.get(ask.askId)?.agentId);
        if (!agent) return 'Este agente ya no está en el equipo.';
        // The same function as the agent's tools page: an owner gives it one more account.
        await setAgentAccounts(supabase, agent.id, agent.accounts == null ? null : [...new Set([...agent.accounts, ask.connector])]);
        await reloadAgents();
        return resume(ask.askId);
      }
      const note = await connect(ask.connector as AccountProvider, returnPath);
      if (!note) return null; // they closed the sign-in
      if (!note.ok) return note.text;
      return resume(ask.askId);
    },
    [orgId, agents, where, reloadAgents, resume, connect, returnPath],
  );

  return useMemo(
    () => ({
      canConnect: isOwner,
      owners,
      requested: (name: string) => requested.has(name.toLocaleLowerCase('es')),
      resuming: (askId: string) => resuming.has(askId),
      act,
    }),
    [isOwner, owners, requested, resuming, act],
  );
}
