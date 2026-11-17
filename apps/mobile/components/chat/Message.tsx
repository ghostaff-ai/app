import { type ChatMessage, messageText, splitMentions } from '@ghostaff/shared';
import { Image, Text, View } from 'react-native';
import { GHOSTS, type GhostId } from '@/lib/team';

// One message of a thread (team-chat.md, decision 3): people in bubbles (yours
// on the right in ink, colleagues on the left with their initials), agents
// flat and full width in the muted agent style (app-design.md #18) with their
// small ghost. Consecutive messages from the same author drop the name.

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
        <Body text={text} names={names} className="text-base leading-6 text-muted" />
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
