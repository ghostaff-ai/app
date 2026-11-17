import { type ChatMessage, messageText, splitMentions } from '@ghostaff/shared';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import { GHOSTS, type GhostId } from '@/lib/team';

// One message of a thread (team-chat.md, decision 3): people in bubbles (yours
// on the right in ink, colleagues on the left with their initials), agents
// flat and full width in the muted agent style (app-design.md #18) with their
// small ghost. Consecutive messages from the same author drop the name.
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
        <Text className="ml-2 text-sm text-muted">{now}…</Text>
      </View>
    );
  }
  if (message.state === 'failed') {
    return <Text className="mb-1 text-sm text-no">No ha podido terminar</Text>;
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
      <Text className="text-xs text-muted">
        {open ? '▾' : '▸'} Hecho{took ? ` · ${took}` : ''}
      </Text>
      {open
        ? done.map((st, i) => (
            <Text key={i} className="ml-3 text-xs text-muted">
              · {st}
            </Text>
          ))
        : null}
    </Pressable>
  );
}

export function MessageView({
  message,
  mine,
  ghost,
  showAuthor,
  names,
}: {
  message: ChatMessage;
  mine: boolean;
  /** The ghost of the agent who wrote it, when an agent did. */
  ghost?: GhostId;
  /** False for a message right after another from the same author. */
  showAuthor: boolean;
  /** Names that can be @mentioned, to highlight them. */
  names: string[];
}) {
  const text = messageText(message.parts);

  if (message.authorKind === 'agent') {
    return (
      <View className={`px-4 ${showAuthor ? 'pt-4' : 'pt-1.5'}`} accessibilityLabel={`${message.authorName}: ${text}`}>
        {showAuthor ? (
          <View className="mb-1 flex-row items-center">
            <Image source={GHOSTS[ghost ?? 'base'].picture} style={{ width: 22, height: 22 }} resizeMode="contain" />
            <Text className="ml-1.5 text-sm font-semibold text-ink">{message.authorName}</Text>
          </View>
        ) : null}
        <StatusLine message={message} />
        {text ? <Body text={text} names={names} className="text-base leading-6 text-muted" /> : null}
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
        {showAuthor ? <Text className="mb-0.5 ml-1 text-xs font-semibold text-muted">{message.authorName}</Text> : null}
        <View className="rounded-2xl rounded-bl-md border border-line bg-card px-3.5 py-2">
          <Body text={text} names={names} className="text-base leading-6 text-ink" />
        </View>
      </View>
    </View>
  );
}
