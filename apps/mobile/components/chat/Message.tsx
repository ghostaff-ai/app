import { type ActionPart, type ChatMessage, isActionPart, messageText, splitMentions } from '@ghostaff/shared';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { Markdown } from '@/components/chat/Markdown';
import { GHOSTS, type GhostId } from '@/lib/team';

// One message of a thread (team-chat.md, decision 3): people in bubbles (yours
// on the right in ink, colleagues on the left with their initials), agents
// flat and full width in ink with their small ghost (app-design.md #18, changed
// 2026-11-22), their replies' markdown rendered. Consecutive messages from the same
// author drop the name.
// An agent's reply carries one status line (decision 4): what it is doing
// while it writes, then «Hecho · 3 s», which unfolds into its steps.

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
 * src/actions.ts). Nothing happens until someone presses «Aprobar».
 */
export function ActionCard({
  action,
  canDecide,
  onDecide,
}: {
  action: ActionPart;
  canDecide: boolean;
  onDecide?: (actionId: string, decision: 'approve' | 'reject') => Promise<void>;
}) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decide = async (d: 'approve' | 'reject') => {
    if (!onDecide) return;
    setBusy(d);
    setError(null);
    try {
      await onDecide(action.actionId, d);
    } catch {
      setError('No se ha podido. Inténtalo otra vez.');
    } finally {
      setBusy(null);
    }
  };
  const link = action.status === 'done' ? linkIn(action.result) : null;
  return (
    <View className="mt-2 rounded-xl border border-line bg-card p-3" accessibilityLabel={`Propuesta: ${action.label}. ${ACTION_STATUS[action.status]}`}>
      <Text className="text-footnote font-semibold text-ink">{action.label}</Text>
      {action.preview ? (
        <Text className="mt-1 text-caption text-muted" selectable numberOfLines={8}>
          {action.preview}
        </Text>
      ) : null}
      <Text className={`mt-2 text-caption ${action.status === 'failed' ? 'text-no' : action.status === 'done' ? 'text-ok' : 'text-muted'}`}>
        {ACTION_STATUS[action.status]}
        {action.decidedBy && action.status !== 'pending' ? ` · ${action.decidedBy}` : ''}
      </Text>
      {action.status === 'failed' && action.result ? <Text className="mt-1 text-caption text-no">{action.result}</Text> : null}
      {link ? (
        <Text className="mt-1 text-caption text-accent" selectable>
          {link}
        </Text>
      ) : null}
      {action.status === 'pending' && canDecide ? (
        <View className="mt-3 flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() => void decide('approve')}
            className="flex-1 items-center rounded-full bg-accent px-3 py-2"
          >
            {busy === 'approve' ? <ActivityIndicator size="small" /> : <Text className="text-footnote font-semibold text-on-accent">Aprobar</Text>}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            onPress={() => void decide('reject')}
            className="flex-1 items-center rounded-full border border-line bg-surface px-3 py-2"
          >
            {busy === 'reject' ? <ActivityIndicator size="small" /> : <Text className="text-footnote font-semibold text-ink">Rechazar</Text>}
          </Pressable>
        </View>
      ) : null}
      {action.status === 'pending' && !canDecide ? <Text className="mt-2 text-caption text-muted">Lo aprueba quien es propietario de la empresa.</Text> : null}
      {error ? <Text className="mt-2 text-caption text-no">{error}</Text> : null}
    </View>
  );
}

export function MessageView({
  message,
  mine,
  ghost,
  showAuthor,
  names,
  canDecide = false,
  onDecide,
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
  onDecide?: (actionId: string, decision: 'approve' | 'reject') => Promise<void>;
}) {
  const text = messageText(message.parts);
  const actions = message.parts.filter(isActionPart);

  if (message.authorKind === 'agent') {
    return (
      <View className={`px-4 ${showAuthor ? 'pt-4' : 'pt-1.5'}`} accessibilityLabel={`${message.authorName}: ${text}`}>
        {showAuthor ? (
          <View className="mb-1 flex-row items-center">
            <Image source={GHOSTS[ghost ?? 'base'].picture} style={{ width: 22, height: 22 }} resizeMode="contain" />
            <Text className="ml-1.5 text-footnote font-semibold text-ink">{message.authorName}</Text>
          </View>
        ) : null}
        <StatusLine message={message} />
        {text ? <Markdown text={text} names={names} /> : null}
        {actions.map((a) => (
          // An action is decided once the agent has finished writing its message.
          <ActionCard key={a.actionId} action={a} canDecide={canDecide && message.state !== 'working'} onDecide={onDecide} />
        ))}
      </View>
    );
  }

  if (mine) {
    return (
      <View className={`flex-row justify-end px-4 ${showAuthor ? 'pt-4' : 'pt-1'}`}>
        <View className="max-w-[80%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2">
          <Body text={text} names={names} className="text-base leading-6 text-on-accent" />
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
          <Body text={text} names={names} className="text-base leading-6 text-ink" />
        </View>
      </View>
    </View>
  );
}
