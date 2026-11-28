import { type ActionPart, type ChatMessage, type EditableField, type ForwardPart, isAccountAskPart, isActionPart, isAudioPart, isDecisionPart, isDecisionQuotePart, isDocumentPart, isForwardPart, isGuidePart, isQuotePart, isVoicePart, messageText, type QuotePart, type Reaction, reactionChips, splitMentions } from '@ghostaff/shared';
import { router } from 'expo-router';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, PanResponder, Platform, Pressable, Text, View } from 'react-native';
import { AccountAskCard } from '@/components/chat/AccountAskCard';
import { Bubble, Stamp, type Ticks } from '@/components/chat/Bubble';
import { FileBubble } from '@/components/chat/FileBubble';
import { LinkCard } from '@/components/chat/LinkCard';
import { DecisionInChat, DecisionQuote } from '@/components/chat/DecisionInChat';
import { GuideCard } from '@/components/chat/GuideCard';
import { Markdown } from '@/components/chat/Markdown';
import { VoiceNote } from '@/components/chat/VoiceNote';
import { AgentAudio } from '@/components/chat/AgentAudio';
import { ArrowUUpLeft, Clock, Icon, Microphone, Prohibit, ShareFat } from '@/components/icons';
import { tap } from '@/lib/haptics';
import { Field } from '@/components/ui';
import type { AskControls } from '@/lib/hooks/useAccountAsks';
import { useAvatars, usePhotoUrl } from '@/lib/avatars';
import { emojiOnly, firstLink, personColour, timeOf } from '@/lib/chat';
import type { GuideControls } from '@/lib/hooks/useGuideCards';
import { GHOSTS, type GhostId } from '@/lib/team';
import { usePalette } from '@/lib/theme';

// One message of a chat, as in WhatsApp (chat-like-whatsapp.md): everyone in
// a bubble, yours on the right, colleagues and agents on the left with their
// face and, on the first of a run, their name in their colour; an agent's
// bubble is wider and renders its markdown (decision 3, reversing team-chat.md
// decision 3). The time and your ticks sit inside. A voice note is its audio
// (voice.md); its transcript is one tap away in an agent's chat and out of
// sight in General, and the agents it was tagged for show above it.
// An agent's reply carries one status line (decision 4): what it is doing
// while it writes, then «Hecho · 3 s», which unfolds into its steps. One a
// routine started says so above it, «Tarea programada · Resumen de ventas» (agent-routines.md).

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

/** A person's face: their profile photo, or their initials on their colour until they set one. */
export function Avatar({ name, id, size = 28, path }: { name: string; id: string; size?: number; path?: string | null }) {
  const { pathOf } = useAvatars();
  const url = usePhotoUrl(path ?? pathOf(id));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: personColour(id) }}
      className="items-center justify-center overflow-hidden"
    >
      {url ? (
        <Image source={{ uri: url }} style={{ width: size, height: size }} resizeMode="cover" />
      ) : (
        <Text style={{ fontSize: size * 0.4 }} className="font-semibold text-white">
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

/** Why the agent spoke without being written to: one of the viewer's routines, or the team's. */
function RoutineLine({ title }: { title: string | null }) {
  const c = usePalette();
  return (
    <View className="mb-1 flex-row items-center" accessibilityLabel={title ? `Tarea programada: ${title}` : 'Tarea programada'}>
      <Icon icon={Clock} size={14} color={c.muted} weight="regular" />
      <Text className="ml-1 text-caption text-muted" numberOfLines={1}>
        {title ? `Tarea programada · ${title}` : 'Tarea programada'}
      </Text>
    </View>
  );
}

/** A voice note's message: the tags written before the audio, the audio, and its transcript after it. */
function voiceOf(message: ChatMessage) {
  const at = message.parts.findIndex(isVoicePart);
  if (at < 0) return null;
  return {
    part: message.parts.find(isVoicePart)!,
    tags: messageText(message.parts.slice(0, at)),
    transcript: messageText(message.parts.slice(at + 1)),
  };
}

/** The text with @mentions in bold. */
function Body({ text, names, className }: { text: string; names: string[]; className: string }) {
  return (
    <Text className={className}>
      {splitMentions(text, names).map((s, i) =>
        s.mention ? (
          <Text key={i} className="font-semibold">
            {s.text}
          </Text>
        ) : (
          s.text
        ),
      )}
    </Text>
  );
}

/** The agent's live status line: what it is doing now, then a folded record of what it did. */
export function StatusLine({ message }: { message: ChatMessage }) {
  const [open, setOpen] = useState(false);
  const steps = message.steps;
  if (message.state === 'working') {
    const now = steps[steps.length - 1] ?? 'Pensando';
    return (
      <View className="mb-1 flex-row items-center" accessibilityLiveRegion="polite" accessibilityLabel={`${message.authorName} está trabajando: ${now}`}>
        <ActivityIndicator size="small" />
        <Text className="ml-2 text-footnote text-muted">{now}…</Text>
      </View>
    );
  }
  if (message.state === 'failed') {
    return <Text className="mb-1 text-footnote text-no">No ha podido terminar</Text>;
  }
  if (steps.length === 0) return null;
  const last = steps[steps.length - 1] ?? '';
  const took = /^\d+ s$/.test(last) ? last : null;
  const done = took ? steps.slice(0, -1) : steps;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={open ? 'Ocultar lo que ha hecho' : 'Ver lo que ha hecho'}
      onPress={() => setOpen((o) => !o)}
      className="mb-1 self-start"
    >
      <Text className="text-caption text-muted">
        {open ? '▾' : '▸'} Hecho{took ? ` · ${took}` : ''}
      </Text>
      {open
        ? done.map((st, i) => (
            <Text key={i} className="ml-3 text-caption text-muted">
              · {st}
            </Text>
          ))
        : null}
    </Pressable>
  );
}

const ACTION_STATUS: Record<ActionPart['status'], string> = {
  pending: 'Pendiente de aprobación',
  running: 'Haciéndolo…',
  done: 'Hecho',
  failed: 'No se ha podido hacer',
  rejected: 'Rechazado',
};

/** The first link in a tool's answer, to open what was done. */
function linkIn(result: string | undefined): string | null {
  return result?.match(/https:\/\/[^\s"']+/)?.[0] ?? null;
}

/**
 * What an agent wants to do outside Ghostaff, waiting for an owner (apps/engine/
 * src/actions.ts). Nothing happens until someone presses «Aprobar». When its tool
 * lets them, whoever decides may change its text first («Editar»).
 */
export function ActionCard({
  action,
  canDecide,
  onDecide,
}: {
  action: ActionPart;
  canDecide: boolean;
  onDecide?: (actionId: string, decision: 'approve' | 'reject', edits?: Record<string, string>) => Promise<void>;
}) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The texts being edited, by field; null while not editing.
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const editable = action.editable ?? [];
  const decide = async (d: 'approve' | 'reject') => {
    if (!onDecide) return;
    const edits = d === 'approve' && draft ? changedTexts(editable, draft) : undefined;
    if (edits === null) {
      setError('Ningún texto puede quedar vacío.');
      return;
    }
    setBusy(d);
    setError(null);
    try {
      if (edits && Object.keys(edits).length) await onDecide(action.actionId, d, edits);
      else await onDecide(action.actionId, d);
      setDraft(null);
    } catch {
      setError('No se ha podido. Inténtalo otra vez.');
    } finally {
      setBusy(null);
    }
  };
  const link = action.status === 'done' ? linkIn(action.result) : null;
  const pending = action.status === 'pending';
  const editing = pending && canDecide && draft !== null;
  return (
    <View className="mt-2 rounded-xl border border-line bg-card p-3" accessibilityLabel={`Propuesta: ${action.label}. ${ACTION_STATUS[action.status]}`}>
      <Text className="text-footnote font-semibold text-ink">{action.label}</Text>
      {editing ? (
        editable.map((f) => (
          <Field
            key={f.field}
            label={f.label}
            value={draft[f.field] ?? f.value}
            onChangeText={(t) => setDraft((d) => ({ ...(d ?? {}), [f.field]: t }))}
            maxLength={f.max}
            multiline={f.multiline}
            editable={busy === null}
          />
        ))
      ) : action.preview ? (
        <Text className="mt-1 text-caption text-muted" selectable numberOfLines={8}>
          {action.preview}
        </Text>
      ) : null}
      {editing ? null : (
        <Text className={`mt-2 text-caption ${action.status === 'failed' ? 'text-no' : action.status === 'done' ? 'text-ok' : 'text-muted'}`}>
          {ACTION_STATUS[action.status]}
          {action.decidedBy && !pending ? ` · ${action.decidedBy}` : ''}
          {action.edited && !pending ? ' · con cambios' : ''}
        </Text>
      )}
      {action.status === 'failed' && action.result ? <Text className="mt-1 text-caption text-no">{action.result}</Text> : null}
      {link ? (
        <Text className="mt-1 text-caption text-accent" selectable>
          {link}
        </Text>
      ) : null}
      {pending && canDecide ? (
        <View className="mt-3 flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() => void decide('approve')}
            className="flex-1 items-center rounded-full bg-accent px-3 py-2"
          >
            {busy === 'approve' ? <ActivityIndicator size="small" /> : <Text className="text-footnote font-semibold text-on-accent">Aprobar</Text>}
          </Pressable>
          {editing ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy !== null}
              onPress={() => {
                setDraft(null);
                setError(null);
              }}
              className="flex-1 items-center rounded-full border border-line bg-surface px-3 py-2"
            >
              <Text className="text-footnote font-semibold text-ink">Cancelar</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              disabled={busy !== null}
              onPress={() => void decide('reject')}
              className="flex-1 items-center rounded-full border border-line bg-surface px-3 py-2"
            >
              {busy === 'reject' ? <ActivityIndicator size="small" /> : <Text className="text-footnote font-semibold text-ink">Rechazar</Text>}
            </Pressable>
          )}
        </View>
      ) : null}
      {pending && canDecide && !editing && editable.length ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Editar el texto antes de aprobar: ${action.label}`}
          disabled={busy !== null}
          onPress={() => setDraft(Object.fromEntries(editable.map((f) => [f.field, f.value])))}
          className="mt-1 min-h-11 items-center justify-center"
        >
          <Text className="text-footnote font-semibold text-accent">Editar</Text>
        </Pressable>
      ) : null}
      {pending && !canDecide ? <Text className="mt-2 text-caption text-muted">Lo aprueba quien es propietario de la empresa.</Text> : null}
      {error ? (
        <Text className="mt-2 text-caption text-no" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The texts a person changed, by field; null when one is left empty (the engine
 * would refuse it). Only what differs from the agent's draft is sent.
 */
export function changedTexts(fields: readonly EditableField[], draft: Record<string, string>): Record<string, string> | null {
  const changed: Record<string, string> = {};
  for (const f of fields) {
    const value = draft[f.field];
    if (value === undefined || value === f.value) continue;
    if (!value.trim()) return null;
    changed[f.field] = value;
  }
  return changed;
}

/** What a reply quotes, or a forward carries: who said it and its words, with a bar in their colour. */
function QuoteBlock({ part, mine, onPress }: { part: QuotePart | ForwardPart; mine: boolean; onPress?: () => void }) {
  const c = usePalette();
  const colour = personColour(part.authorName);
  const words = part.text || (part.kind === 'voice' ? 'Nota de voz' : '');
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Responde a ${part.authorName}: ${words}`}
      className="mb-1 flex-row overflow-hidden rounded-lg"
    >
      <View style={{ width: 3, backgroundColor: colour }} />
      <View className="shrink grow px-2 py-1" style={{ backgroundColor: mine ? c.mineSunk : c.sunk }}>
        <Text className="text-caption font-semibold" style={{ color: colour }} numberOfLines={1}>
          {part.authorName}
        </Text>
        <View className="flex-row items-center">
          {part.kind === 'voice' ? <Icon icon={Microphone} size={13} color={mine ? c.mineMuted : c.muted} /> : null}
          <Text className={`text-footnote ${mine ? 'text-ink' : 'text-muted'} ${part.kind === 'voice' ? 'ml-1' : ''}`} numberOfLines={2}>
            {words}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** A message's reactions under it: each emoji with how many; yours outlined. Tapping one toggles it as yours. */
function ReactionChips({ chips, onPress }: { chips: Array<{ emoji: string; count: number; mine: boolean }>; onPress?: (emoji: string | null) => void }) {
  return (
    <View testID="reactions" className="-mt-1 mb-0.5 flex-row flex-wrap gap-1 px-1">
      {chips.map((ch) => (
        <Pressable
          key={ch.emoji}
          accessibilityRole="button"
          accessibilityLabel={`${ch.emoji} ${ch.count}${ch.mine ? ', tuya' : ''}`}
          onPress={onPress ? () => onPress(ch.mine ? null : ch.emoji) : undefined}
          className={`flex-row items-center rounded-full border bg-card px-1.5 py-0.5 ${ch.mine ? 'border-ink' : 'border-line'}`}
        >
          <Text style={{ fontSize: 14 }}>{ch.emoji}</Text>
          {ch.count > 1 ? <Text className="ml-0.5 text-caption text-muted">{ch.count}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** Swipe a message right to reply to it, as in WhatsApp: it follows the finger, an arrow shows, and past a point it replies. */
function SwipeToReply({ children, onReply }: { children: ReactNode; onReply: () => void }) {
  const c = usePalette();
  const x = useRef(new Animated.Value(0)).current;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dx > 12 && Math.abs(g.dy) < 10,
        onPanResponderMove: (_, g) => x.setValue(Math.max(0, Math.min(80, g.dx))),
        onPanResponderRelease: (_, g) => {
          if (g.dx > 60) {
            tap();
            onReply();
          }
          Animated.spring(x, { toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start();
        },
        onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: Platform.OS !== 'web' }).start(),
      }),
    [x, onReply],
  );
  return (
    <View {...pan.panHandlers}>
      <Animated.View className="absolute left-3 top-0 bottom-0 justify-center" style={{ opacity: x.interpolate({ inputRange: [0, 60], outputRange: [0, 1] }) }}>
        <View className="h-8 w-8 items-center justify-center rounded-full bg-sunk">
          <Icon icon={ArrowUUpLeft} size={16} color={c.ink} />
        </View>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: x }] }}>{children}</Animated.View>
    </View>
  );
}

/** A message of only emoji: big, with no bubble, its stamp in a small pill beside it (as WhatsApp does). */
function EmojiMessage({
  text,
  mine,
  tail,
  name,
  label,
  nameColour,
  avatar,
  stamp,
  below,
  onLongPress,
  onReply,
}: {
  text: string;
  mine: boolean;
  tail: boolean;
  name: string | null;
  /** Who wrote it, for the screen reader (the name above is shown only in groups). */
  label: string;
  nameColour: string;
  avatar: ReactNode;
  stamp: ReactNode;
  below: ReactNode;
  onLongPress?: () => void;
  onReply?: () => void;
}) {
  const body = (
    <View className={`flex-row px-3 ${mine ? 'justify-end' : 'justify-start'} ${tail ? 'mt-2' : 'mt-0.5'}`}>
      {mine ? null : <View style={{ width: 30 }}>{tail ? avatar : null}</View>}
      <View className={mine ? 'items-end' : 'ml-1 items-start'} style={{ maxWidth: '78%' }}>
        {name && tail ? (
          <Text className="mb-0.5 text-footnote font-semibold" style={{ color: nameColour }} numberOfLines={1}>
            {name}
          </Text>
        ) : null}
        <Pressable
          testID="emoji-message"
          onLongPress={onLongPress}
          delayLongPress={350}
          accessibilityLabel={`${label}: ${text}`}
          accessibilityHint={onLongPress ? 'Mantén pulsado para reaccionar, responder y más' : undefined}
          accessibilityActions={onLongPress ? [{ name: 'longpress', label: 'Opciones del mensaje' }] : undefined}
          onAccessibilityAction={onLongPress ? () => onLongPress() : undefined}
          className="flex-row items-end"
        >
          <Text className="text-ink" style={{ fontSize: 40, lineHeight: 46 }}>{text}</Text>
          <View className="mb-1 ml-1.5 rounded-[9px] bg-chip px-[7px] py-[2px]">{stamp}</View>
        </Pressable>
        {below}
      </View>
    </View>
  );
  return onReply ? <SwipeToReply onReply={onReply}>{body}</SwipeToReply> : body;
}

export function MessageView({
  message,
  mine,
  ghost,
  showAuthor,
  group = true,
  ticks,
  names,
  canDecide,
  onDecide,
  onRetryTranscript,
  asks,
  routineTitle,
  me,
  guides,
  transcript = 'tap',
  unplayed,
  reactions = [],
  onReact,
  onMenu,
  onReply,
  onQuotePress,
}: {
  message: ChatMessage;
  mine: boolean;
  /** The ghost of the agent who wrote it, when an agent did. */
  ghost?: GhostId;
  /** The first of a run by the same author: its tail, name and avatar. */
  showAuthor: boolean;
  /** Several people write here: names on others' bubbles. */
  group?: boolean;
  /** Yours: sent, or read by everyone else. */
  ticks?: Ticks | null;
  /** Names that can be @mentioned, to highlight them. */
  names: string[];
  /** Whether the viewer may approve the agent's proposed actions (owners). */
  canDecide?: boolean;
  onDecide?: (actionId: string, decision: 'approve' | 'reject') => Promise<void>;
  /** Asks again for a voice note's transcript. */
  onRetryTranscript?: (messageId: string) => Promise<void>;
  /** What an agent's cards asking for an account can do here (connector-in-chat.md). */
  asks?: AskControls;
  /** The title of the routine that started this answer, when the viewer sees it. */
  routineTitle?: string | null;
  /** The viewer: a card for a routine they asked for is theirs to decide, owner or not. */
  me?: string;
  /** What an agent's guide cards can do here (guided-access.md). */
  guides?: GuideControls;
  /** A voice note's transcript: one tap away in an agent's chat, out of sight in General (chat-like-whatsapp.md, decision 5). */
  transcript?: 'tap' | 'none';
  /** Someone else's voice note that arrived since the person last read the chat. */
  unplayed?: boolean;
  /** Its reactions (chat-like-whatsapp.md, phase 2). */
  reactions?: Reaction[];
  /** Tapping a reaction chip: yours goes, someone else's emoji becomes yours too. */
  onReact?: (emoji: string | null) => void;
  /** Holding the message: its menu. */
  onMenu?: () => void;
  /** Swiping it right: reply to it. */
  onReply?: () => void;
  /** Tapping what it quotes: go to that message. */
  onQuotePress?: (messageId: string) => void;
}) {
  const c = usePalette();
  const text = messageText(message.parts);
  const actions = message.parts.filter(isActionPart);
  const accountAsks = message.parts.filter(isAccountAskPart);
  const guideParts = message.parts.filter(isGuidePart);
  const decisions = message.parts.filter(isDecisionPart);
  const quote = message.parts.find(isDecisionQuotePart);
  const time = timeOf(message.createdAt);
  const tail = showAuthor;
  const colour = personColour(message.authorUserId ?? message.authorAgentId ?? message.authorName);
  const chips = reactionChips(reactions, me);
  const below = chips.length ? <ReactionChips chips={chips} onPress={onReact} /> : null;
  const quoteParts = message.parts.filter(isQuotePart);
  const forwards = message.parts.filter(isForwardPart);
  const quoteBlocks = (mine: boolean) => (
    <>
      {forwards.map((f) => (
        <View key={`f-${f.messageId}`}>
          <View className="mb-1 flex-row items-center">
            <Icon icon={ShareFat} size={13} color={mine ? c.mineMuted : c.muted} />
            <Text className={`ml-1 text-caption italic ${mine ? 'text-mine-muted' : 'text-muted opacity-80'}`}>Reenviado desde {f.from}</Text>
          </View>
          <QuoteBlock part={f} mine={mine} />
        </View>
      ))}
      {quoteParts.map((q) => (
        <QuoteBlock key={`q-${q.messageId}`} part={q} mine={mine} onPress={onQuotePress ? () => onQuotePress(q.messageId) : undefined} />
      ))}
    </>
  );

  if (message.deletedAt) {
    const mineDeleted = message.authorKind === 'person' && message.authorUserId === me;
    return (
      <Bubble
        mine={mineDeleted}
        tail={tail}
        name={group && !mineDeleted ? message.authorName : null}
        nameColour={colour}
        avatar={<Avatar name={message.authorName} id={message.authorUserId ?? message.authorName} />}
        stamp={<Stamp time={time} mine={mineDeleted} />}
        stampInline
      >
        <View className="flex-row items-center" accessibilityLabel="Se eliminó este mensaje">
          <Icon icon={Prohibit} size={15} color={mineDeleted ? c.mineMuted : c.muted} />
          <Text className={`ml-1.5 text-[15px] italic ${mineDeleted ? 'text-mine-muted' : 'text-muted opacity-80'}`}>
            {mineDeleted ? 'Eliminaste este mensaje' : 'Se eliminó este mensaje'}
          </Text>
        </View>
      </Bubble>
    );
  }

  const audio = message.parts.filter(isAudioPart);

  if (message.authorKind === 'agent') {
    const said = text || audio.map((a) => `audio «${a.title}»`).join(', ');
    const picture = <Image source={GHOSTS[ghost ?? 'base'].picture} style={{ width: 28, height: 28 }} resizeMode="contain" />;
    // Its ghost opens its page, from any chat (as its name on top of its own chat does).
    const agentId = message.authorAgentId;
    const face = agentId ? (
      <Pressable
        testID="message-agent-face"
        accessibilityRole="button"
        accessibilityLabel={`Ver la ficha de ${message.authorName}`}
        onPress={() => router.push(`/agente/${agentId}`)}
        hitSlop={8}
        className="active:opacity-60"
      >
        {picture}
      </Pressable>
    ) : (
      picture
    );
    return (
      <Bubble
        mine={false}
        tail={tail}
        name={message.authorName}
        nameColour={colour}
        avatar={face}
        wide
        stamp={<Stamp time={time} mine={false} />}
        accessibilityLabel={`${message.authorName}: ${said}`}
        below={below}
        onLongPress={message.state === 'working' ? undefined : onMenu}
      >
        {message.routineId ? <RoutineLine title={routineTitle ?? null} /> : null}
        <StatusLine message={message} />
        {text ? <Markdown text={text} names={names} /> : null}
        {audio.map((a) => (
          <AgentAudio key={a.path} part={a} />
        ))}
        {actions.map((a) => (
          // An action is decided once the agent has finished writing its message.
          <ActionCard
            key={a.actionId}
            action={a}
            canDecide={(a.decider === 'requester' ? !!me && a.requestedBy === me : !!canDecide) && message.state !== 'working'}
            onDecide={onDecide}
          />
        ))}
        {accountAsks.map((a) => (
          <AccountAskCard key={a.askId} ask={a} controls={asks} writing={message.state === 'working'} />
        ))}
        {guideParts.map((g) => (
          <GuideCard key={g.guideId} guide={g} controls={guides} writing={message.state === 'working'} />
        ))}
        {decisions.map((d) => (
          <DecisionInChat key={d.decisionId} part={d} writing={message.state === 'working'} />
        ))}
      </Bubble>
    );
  }

  const voice = voiceOf(message);
  const files = message.parts.filter(isDocumentPart);
  const content = voice ? (
    <>
      {voice.tags ? <Body text={voice.tags} names={names} className={`mb-1 text-footnote text-ink`} /> : null}
      <VoiceNote
        part={voice.part}
        messageId={message.id}
        transcript={transcript === 'none' ? null : voice.transcript}
        createdAt={message.createdAt}
        onRetry={mine && onRetryTranscript && (transcript === 'tap' || voice.tags) ? () => onRetryTranscript(message.id) : undefined}
        tone={mine ? 'mine' : 'theirs'}
        unplayed={unplayed}
        stamp={<Stamp time={time} ticks={mine ? ticks : null} mine={mine} edited={!!message.editedAt} />}
      />
    </>
  ) : (
    text ? <Body text={text} names={names} className={`text-base leading-[22px] text-ink`} /> : null
  );
  if (!voice && !files.length && !quote && !quoteParts.length && !forwards.length && !firstLink(text) && emojiOnly(text)) {
    return (
      <EmojiMessage
        text={text.trim()}
        mine={mine}
        tail={tail}
        name={group && !mine ? message.authorName : null}
        label={mine ? 'Tú' : message.authorName}
        nameColour={colour}
        avatar={<Avatar name={message.authorName} id={message.authorUserId ?? message.authorName} />}
        stamp={<Stamp time={time} ticks={mine ? ticks : null} mine={mine} edited={!!message.editedAt} />}
        below={below}
        onLongPress={onMenu}
        onReply={onReply}
      />
    );
  }
  const bubble = (
    <Bubble
      mine={mine}
      tail={tail}
      name={group && !mine ? message.authorName : null}
      nameColour={colour}
      avatar={<Avatar name={message.authorName} id={message.authorUserId ?? message.authorName} />}
      stamp={voice ? undefined : <Stamp time={time} ticks={mine ? ticks : null} mine={mine} edited={!!message.editedAt} />}
      stampInline={!voice && !!text}
      accessibilityLabel={`${mine ? 'Tú' : message.authorName}: ${voice ? 'nota de voz' : files.length ? `${files.map((f) => f.name).join(', ')}${text ? `. ${text}` : ''}` : text}`}
      below={below}
      onLongPress={onMenu}
    >
      {quote ? <DecisionQuote part={quote} mine={mine} /> : null}
      {quoteBlocks(mine)}
      {files.map((f) => (
        <FileBubble key={f.path} part={f} mine={mine} />
      ))}
      {!voice && firstLink(text) ? <LinkCard url={firstLink(text)!} mine={mine} /> : null}
      {content}
    </Bubble>
  );
  return onReply ? <SwipeToReply onReply={onReply}>{bubble}</SwipeToReply> : bubble;
}
