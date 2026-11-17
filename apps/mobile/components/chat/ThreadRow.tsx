import type { ChatThread } from '@ghostaff/shared';
import { Image, Pressable, Text, View } from 'react-native';
import { shortTime } from '@/lib/chat';
import { GHOSTS, type GhostId } from '@/lib/team';

// One thread in a list (team-chat.md, decision 2): its title, who wrote last
// and what, when, and an orange dot while someone else's message waits.

export function ThreadRow({ thread, ghost, agentName, onPress, first }: { thread: ChatThread; ghost?: GhostId; agentName?: string; onPress: () => void; first?: boolean }) {
  const preview = thread.lastText ? `${thread.lastAuthor ?? ''}: ${thread.lastText}` : '';
  // «Finanzas · Finanzas: …» says the name twice; the agent's own last word needs it once.
  const lead = agentName && agentName !== thread.lastAuthor ? `${agentName} · ` : '';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${thread.title}${thread.unread ? ', sin leer' : ''}`}
      onPress={onPress}
      className={`flex-row items-center px-4 py-3 ${first ? '' : 'border-t border-line'}`}
    >
      {ghost ? <Image source={GHOSTS[ghost].picture} style={{ width: 32, height: 32 }} resizeMode="contain" /> : null}
      <View className={`flex-1 ${ghost ? 'ml-3' : ''}`}>
        <View className="flex-row items-center">
          <Text className={`flex-1 text-base text-ink ${thread.unread ? 'font-semibold' : ''}`} numberOfLines={1}>
            {thread.title}
          </Text>
          <Text className="ml-2 text-xs text-muted">{shortTime(thread.lastMessageAt)}</Text>
        </View>
        <View className="mt-0.5 flex-row items-center">
          <Text className="flex-1 text-sm text-muted" numberOfLines={1}>
            {lead}
            {preview}
          </Text>
          {thread.unread ? <View testID="unread-dot" className="ml-2 h-2 w-2 rounded-full bg-waiting" /> : null}
        </View>
      </View>
    </Pressable>
  );
}
