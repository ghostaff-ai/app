import { type AccountProvider, type ChatMessage, isGuidePart } from '@ghostaff/shared';
import { approveGuide, EngineError, rejectGuide, resumeAfterGuide } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { decideErrorText } from '../guide';
import { useAccountConnect } from './useAccountConnect';
import { useEngine } from './useConnections';

// What a guide's card can do in a chat (docs/plans/ready/guided-access.md):
// open the guide, an owner's approval of what a member granted, the
// catalogue's connect once the guide handed over to it, and the agent going on
// once the guide is done, as an account's card does (useAccountAsks). The
// engine checks it all again and goes on once, whoever asks.

/** What a chat screen lets a guide's card do (GuideCard). */
export interface GuideControls {
  /** The viewer may write in this conversation: they may do the guide. */
  canTalk: boolean;
  /** The viewer is an owner: they approve a member's grant and connect accounts. */
  isOwner: boolean;
  /** The organisation's owners, for «Falta que lo apruebe Ana». */
  owners: string[];
  /** The guide is done and the agent is about to go on. */
  resuming(guideId: string): boolean;
  open(guideId: string): void;
  /** Resolves with what went wrong, if anything. */
  decide(guideId: string, decision: 'approve' | 'reject'): Promise<string | null>;
  /** The catalogue's connect, once the guide handed over to it; resolves with what went wrong, if anything. */
  connect(connector: string): Promise<string | null>;
}

/** The done guides of the agent's latest message: the agent hasn't gone on after them yet. */
export function guidesToResume(messages: readonly ChatMessage[]): Array<{ threadId: string; guideId: string }> {
  const latest = [...messages].reverse().find((m) => m.authorKind === 'agent');
  if (!latest || latest.state !== 'done') return [];
  return latest.parts
    .filter(isGuidePart)
    .filter((g) => g.status === 'done')
    .map((g) => ({ threadId: latest.threadId, guideId: g.guideId }));
}

export function useGuideCards(opts: {
  orgId: string | null;
  messages: readonly ChatMessage[];
  isOwner: boolean;
  owners: string[];
  canTalk: boolean;
  /** Where a connect's sign-in comes back to: this chat. */
  returnPath: string;
}): GuideControls {
  const { orgId, messages, isOwner, owners, canTalk, returnPath } = opts;
  const engine = useEngine();
  const { connect: connectAccount } = useAccountConnect(orgId);
  const [resuming, setResuming] = useState<ReadonlySet<string>>(new Set());
  // Guides this screen already let go on, so a render never asks twice.
  const tried = useRef(new Set<string>());

  const resume = useCallback(
    async (threadId: string, guideId: string) => {
      if (!engine || tried.current.has(guideId)) return;
      tried.current.add(guideId);
      setResuming((s) => new Set(s).add(guideId));
      try {
        await resumeAfterGuide(engine, threadId, guideId);
      } catch (e) {
        const code = e instanceof EngineError ? e.code : 'failed';
        // Worth another go when the chat next changes: the agent was answering, or the engine wasn't reached.
        if (!['already_done', 'not_allowed', 'not_yet'].includes(code)) tried.current.delete(guideId);
      } finally {
        setResuming((s) => {
          const next = new Set(s);
          next.delete(guideId);
          return next;
        });
      }
    },
    [engine],
  );

  // Whoever sees the guide done first (the owner who did it or approved it, back in the chat) lets the agent go on.
  useEffect(() => {
    if (!canTalk) return;
    for (const r of guidesToResume(messages)) if (!tried.current.has(r.guideId)) void resume(r.threadId, r.guideId);
  }, [messages, canTalk, resume]);

  const decide = useCallback(
    async (guideId: string, decision: 'approve' | 'reject'): Promise<string | null> => {
      if (!engine) return 'No hay conexión. Prueba otra vez.';
      try {
        await (decision === 'approve' ? approveGuide(engine, guideId) : rejectGuide(engine, guideId));
        // The card updates itself when the engine rewrites the message; the agent goes on from the effect above.
        return null;
      } catch (e) {
        return decideErrorText(e);
      }
    },
    [engine],
  );

  const connect = useCallback(
    async (connector: string): Promise<string | null> => {
      const note = await connectAccount(connector as AccountProvider, returnPath);
      return note && !note.ok ? note.text : null;
    },
    [connectAccount, returnPath],
  );

  return useMemo(
    () => ({
      canTalk,
      isOwner,
      owners,
      resuming: (guideId: string) => resuming.has(guideId),
      open: (guideId: string) => router.push(`/guia/${guideId}`),
      decide,
      connect,
    }),
    [canTalk, isOwner, owners, resuming, decide, connect],
  );
}
