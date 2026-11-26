import type { Agent, ChatMessage, Reaction } from '@ghostaff/shared';
import { messageText } from '@ghostaff/shared';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { type ReactNode, useCallback, useMemo, useState } from 'react';
import { AgentPicker, PinnedBar, ReplyBar } from '@/components/chat/ChatBars';
import { actionsFor, type MenuAction, MessageMenu } from '@/components/chat/MessageMenu';
import type { RecordedNote } from './useVoiceNote';

// What you do with the messages of a chat, as in WhatsApp (docs/plans/ready/
// chat-like-whatsapp.md, phase 2), for General and every chat with an agent:
// hold one for its menu (reactions, reply, copy, forward to an agent, pin,
// edit, delete), swipe it to reply, tap a quote to go to it. One hook, so both
// screens behave the same.

interface Actions {
  edit: (messageId: string, body: string) => Promise<void>;
  remove: (messageId: string) => Promise<void>;
  react: (messageId: string, emoji: string | null, me: string) => Promise<void>;
  pin: (messageId: string | null) => Promise<void>;
  forward: (messageId: string, agentId: string) => Promise<string>;
}

export function useMessageActions(opts: {
  messages: ChatMessage[];
  reactions: Reaction[];
  actions: Actions;
  me?: string;
  /** The person may write here (talk). */
  canWrite: boolean;
  pinned: string | null;
  /** The agents the person may talk to: where a message can be forwarded. */
  agents: Agent[];
  send: (body: string, quoted?: string | null) => Promise<void>;
  sendVoice?: (note: RecordedNote, tagged: string[], quoted?: string | null) => Promise<void>;
  /** Scrolls the list to a message (ChatList's jumpTo). */
  jumpTo: (messageId: string) => void;
  onError: (e: string) => void;
}) {
  const { messages, reactions, actions, me, canWrite, pinned, agents, jumpTo, onError } = opts;
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);

  const byMessage = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of reactions) map.set(r.messageId, [...(map.get(r.messageId) ?? []), r]);
    return map;
  }, [reactions]);

  const fail = useCallback((e: unknown) => onError(e instanceof Error ? e.message : 'No se ha podido.'), [onError]);

  const react = useCallback(
    (m: ChatMessage, emoji: string | null) => {
      if (!me) return;
      void actions.react(m.id, emoji, me).catch(fail);
    },
    [actions, me, fail],
  );

  const itemProps = useCallback(
    (m: ChatMessage) => ({
      reactions: byMessage.get(m.id) ?? [],
      onReact: canWrite ? (emoji: string | null) => react(m, emoji) : undefined,
      onMenu: m.deletedAt ? undefined : () => setMenuFor(m),
      onReply: canWrite && !m.deletedAt && m.state !== 'working' ? () => { setEditing(null); setReplyTo(m); } : undefined,
      onQuotePress: jumpTo,
    }),
    [byMessage, canWrite, react, jumpTo],
  );

  const onAction = (a: MenuAction) => {
    const m = menuFor;
    if (!m) return;
    if (a === 'reply') {
      setEditing(null);
      setReplyTo(m);
    } else if (a === 'copy') void Clipboard.setStringAsync(messageText(m.parts));
    else if (a === 'forward') setForwarding(m);
    else if (a === 'pin') void actions.pin(m.id).catch(fail);
    else if (a === 'unpin') void actions.pin(null).catch(fail);
    else if (a === 'edit') {
      setReplyTo(null);
      setEditing(m);
    } else if (a === 'delete') void actions.remove(m.id).catch(fail);
  };

  /** The box's send: the edit of the message being edited, or a message replying to the one quoted. */
  const send = useCallback(
    async (body: string) => {
      if (editing) {
        await actions.edit(editing.id, body);
        setEditing(null);
        return;
      }
      await opts.send(body, replyTo?.id ?? null);
      setReplyTo(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editing, replyTo, actions, opts.send],
  );

  const sendVoice = useMemo(
    () =>
      opts.sendVoice
        ? async (note: RecordedNote, tagged: string[]) => {
            await opts.sendVoice!(note, tagged, replyTo?.id ?? null);
            setReplyTo(null);
          }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.sendVoice, replyTo],
  );

  const pinnedMessage = pinned ? messages.find((m) => m.id === pinned && !m.deletedAt) ?? null : null;
  const pinnedBar: ReactNode = pinnedMessage ? (
    <PinnedBar message={pinnedMessage} onPress={() => jumpTo(pinnedMessage.id)} onUnpin={canWrite ? () => void actions.pin(null).catch(fail) : undefined} />
  ) : null;

  const above: ReactNode = editing ? (
    <ReplyBar message={editing} editing onClose={() => setEditing(null)} />
  ) : replyTo ? (
    <ReplyBar message={replyTo} onClose={() => setReplyTo(null)} />
  ) : null;

  const overlays: ReactNode = (
    <>
      <MessageMenu
        message={menuFor}
        actions={menuFor ? actionsFor(menuFor, { me, canWrite, pinned: pinned === menuFor.id, canForward: agents.length > 0 }) : []}
        myReaction={menuFor && me ? (byMessage.get(menuFor.id) ?? []).find((r) => r.userId === me)?.emoji ?? null : null}
        canReact={canWrite}
        onReact={(e) => menuFor && react(menuFor, e)}
        onAction={onAction}
        onClose={() => setMenuFor(null)}
      />
      <AgentPicker
        visible={forwarding !== null}
        agents={agents}
        onClose={() => setForwarding(null)}
        onPick={(a) => {
          const m = forwarding;
          setForwarding(null);
          if (!m) return;
          void actions
            .forward(m.id, a.id)
            .then(() => router.push(`/chat/${a.id}`))
            .catch(fail);
        }}
      />
    </>
  );

  return {
    itemProps,
    overlays,
    above,
    pinnedBar,
    send,
    sendVoice,
    prefill: editing ? { key: editing.id, text: messageText(editing.parts) } : null,
  };
}
