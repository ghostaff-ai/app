import type { ChatThread } from '@ghostaff/shared';
import { Image, Text, View } from 'react-native';
import { ListRow } from '@/components/ui';
import { shortTime } from '@/lib/chat';
import { GHOSTS, type GhostId } from '@/lib/team';

// One thread in a list (team-chat.md, decision 2): its title, who wrote last
// and what, when, and an orange dot while someone else's message waits. A row
// of a ListSection.

export function ThreadRow({
  thread,
  ghost,
  agentName,
  tag,
  testID,
  onPress,
}: {
  thread: ChatThread;
  ghost?: GhostId;
  agentName?: string;
  /** A word before the preview: who sees it («Compartida», «Solo tú»). */
  tag?: string;
  testID?: string;
  onPress: () => void;
}) {
  const preview = thread.lastText ? `${thread.lastAuthor ?? ''}: ${thread.lastText}` : '';
  // «Finanzas, Finanzas: …» says the name twice; the agent's own last word needs it once.
  const lead = `${tag ? `${tag} · ` : ''}${agentName && agentName !== thread.lastAuthor ? `${agentName}. ` : ''}`;
  return (
    <ListRow
      testID={testID}
      title={thread.title}
      subtitle={`${lead}${preview}` || null}
      emphasis={thread.unread}
      accessibilityLabel={`${thread.title}${thread.unread ? ', sin leer' : ''}`}
      leading={ghost ? <Image source={GHOSTS[ghost].picture} style={{ width: 36, height: 36 }} resizeMode="contain" /> : undefined}
      trailing={
        <View className="items-end">
          <Text className="text-caption text-muted">{shortTime(thread.lastMessageAt)}</Text>
          {thread.unread ? <View testID="unread-dot" className="mt-1.5 h-2 w-2 rounded-full bg-waiting" /> : null}
        </View>
      }
      onPress={onPress}
    />
  );
}
