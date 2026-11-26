import { type ActionPart, type ChatMessage, type EditableField, isAccountAskPart, isActionPart, isAudioPart, isDecisionPart, isDecisionQuotePart, isGuidePart, isVoicePart, messageText, splitMentions } from '@ghostaff/shared';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { AccountAskCard } from '@/components/chat/AccountAskCard';
import { DecisionInChat, DecisionQuote } from '@/components/chat/DecisionInChat';
import { GuideCard } from '@/components/chat/GuideCard';
import { Markdown } from '@/components/chat/Markdown';
import { VoiceNote } from '@/components/chat/VoiceNote';
import { AgentAudio } from '@/components/chat/AgentAudio';
import { Clock, Icon } from '@/components/icons';
import { Field } from '@/components/ui';
import type { AskControls } from '@/lib/hooks/useAccountAsks';
import type { GuideControls } from '@/lib/hooks/useGuideCards';
import { GHOSTS, type GhostId } from '@/lib/team';
import { usePalette } from '@/lib/theme';

// One message of a thread (team-chat.md, decision 3): people in bubbles (yours
// on the right in ink, colleagues on the left with their initials), agents
// flat and full width in ink with their small ghost (app-design.md #18, changed
// 2026-11-22), their replies' markdown rendered. Consecutive messages from the same
// author drop the name. A voice note of yours is drawn as its audio with the
// transcript under it (voice.md).
// An agent's reply carries one status line (decision 4): what it is doing
// while it writes, then «Hecho · 3 s», which unfolds into its steps. One a
// routine started says so above it, «Rutina · Resumen de ventas» (agent-routines.md).

const AVATAR_COLOURS = ['#5B6CB8', '#3E8A8A', '#8A5B9E', '#B0703A', '#4F7D3E', '#A0506A'];

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

function colourFor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length] ?? AVATAR_COLOURS[0]!;
}

export function Avatar({ name, id, size = 28 }: { name: string; id: string; size?: number }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colourFor(id) }}
      className="items-center justify-center"
    >
      <Text style={{ fontSize: size * 0.4 }} className="font-semibold text-white">
        {initials(name)}
      </Text>
    </View>
  );
}

/** Why the agent spoke without being written to: one of the viewer's routines, or the team's. */
function RoutineLine({ title }: { title: string | null }) {
  const c = usePalette();
  return (
    <View className="mb-1 flex-row items-center" accessibilityLabel={title ? `Rutina: ${title}` : 'Rutina'}>
      <Icon icon={Clock} size={14} color={c.muted} weight="regular" />
      <Text className="ml-1 text-caption text-muted" numberOfLines={1}>
        {title ? `Rutina · ${title}` : 'Rutina'}
      </Text>
    </View>
  );
}

/** The text with @mentions in bold. */
function Body({ text, names, className }: { text: string; names: string[]; className: string }) {
  return (
    <Text className={className} selectable>
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

export function MessageView({
  message,
  mine,
  ghost,
  showAuthor,
  names,
  canDecide = false,
  onDecide,
  onRetryTranscript,
  asks,
  routineTitle,
  me,
  guides,
}: {
  message: ChatMessage;
  mine: boolean;
  /** The ghost of the agent who wrote it, when an agent did. */
  ghost?: GhostId;
  /** False for a message right after another from the same author. */
  showAuthor: boolean;
  /** Names that can be @mentioned, to highlight them. */
  names: string[];
  /** Whether the viewer may approve the agent's proposed actions (owners). */
  canDecide?: boolean;
  onDecide?: (actionId: string, decision: 'approve' | 'reject', edits?: Record<string, string>) => Promise<void>;
  /** Asks again for a voice note's transcript. */
  onRetryTranscript?: (messageId: string) => Promise<void>;
  /** What an agent's cards asking for an account can do here (connector-in-chat.md). */
  asks?: AskControls;
  /** The title of the routine that started this answer, when the viewer sees it. */
  routineTitle?: string | null;
  /** The viewer: their own «Solo para mí» routine's card is theirs to decide, owner or not. */
  me?: string;
  /** What an agent's guide cards can do here (guided-access.md). */
  guides?: GuideControls;
}) {
  const text = messageText(message.parts);
  const actions = message.parts.filter(isActionPart);
  const accountAsks = message.parts.filter(isAccountAskPart);
  const guideParts = message.parts.filter(isGuidePart);
  const decisions = message.parts.filter(isDecisionPart);
  const quote = message.parts.find(isDecisionQuotePart);
  const audio = message.parts.filter(isAudioPart);

  if (message.authorKind === 'agent') {
    const said = text || audio.map((a) => `audio «${a.title}»`).join(', ');
    return (
      <View className={`px-4 ${showAuthor ? 'pt-4' : 'pt-1.5'}`} accessibilityLabel={`${message.authorName}: ${said}`}>
        {showAuthor ? (
          <View className="mb-1 flex-row items-center">
            <Image source={GHOSTS[ghost ?? 'base'].picture} style={{ width: 22, height: 22 }} resizeMode="contain" />
            <Text className="ml-1.5 text-footnote font-semibold text-ink">{message.authorName}</Text>
          </View>
        ) : null}
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
            canDecide={(a.decider === 'requester' ? !!me && a.requestedBy === me : canDecide) && message.state !== 'working'}
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
      </View>
    );
  }

  if (mine) {
    const voice = message.parts.find(isVoicePart);
    return (
      <View className={`flex-row justify-end px-4 ${showAuthor ? 'pt-4' : 'pt-1'}`}>
        <View className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2">
          {quote ? <DecisionQuote part={quote} onAccent /> : null}
          {voice ? (
            <VoiceNote
              part={voice}
              transcript={text}
              createdAt={message.createdAt}
              onRetry={onRetryTranscript ? () => onRetryTranscript(message.id) : undefined}
            />
          ) : (
            <Body text={text} names={names} className="text-base leading-6 text-on-accent" />
          )}
        </View>
      </View>
    );
  }

  return (
    <View className={`flex-row items-end px-4 ${showAuthor ? 'pt-4' : 'pt-1'}`}>
      <View style={{ width: 28 }}>{showAuthor ? <Avatar name={message.authorName} id={message.authorUserId ?? message.authorName} /> : null}</View>
      <View className="ml-2 max-w-[78%]">
        {showAuthor ? <Text className="mb-0.5 ml-1 text-caption font-semibold text-muted">{message.authorName}</Text> : null}
        <View className="rounded-2xl rounded-bl-md border border-line bg-card px-3.5 py-2">
          {quote ? <DecisionQuote part={quote} /> : null}
          <Body text={text} names={names} className="text-base leading-6 text-ink" />
        </View>
      </View>
    </View>
  );
}
