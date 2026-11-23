import type { ConversationVisibility } from '@ghostaff/shared';
import { Pressable, Text, View } from 'react-native';
import { CaretRight, Eye, Icon, LockSimple, UsersThree } from '@/components/icons';
import { audienceLine } from '@/lib/chat';
import { usePalette } from '@/lib/theme';

// The quiet line under a conversation's header saying who sees it
// (chat-permissions.md): «Solo tú y Finanzas», «La lee el equipo de Finanzas ·
// 4 personas». For whoever opened it, a tap changes it.

const ICONS = { private: LockSimple, read: Eye, write: UsersThree } as const;

export function Audience({
  visibility,
  agentName,
  readers,
  onPress,
}: {
  visibility: ConversationVisibility;
  agentName: string;
  readers: number | null;
  /** Only for the opener: opens the choice. */
  onPress?: () => void;
}) {
  const c = usePalette();
  const line = audienceLine(visibility, agentName, readers);
  const body = (
    <View className="min-h-[44px] flex-row items-center justify-center px-4">
      <Icon icon={ICONS[visibility]} size={15} color={c.muted} />
      <Text className="ml-1.5 text-footnote text-muted" numberOfLines={1}>
        {line}
      </Text>
      {onPress ? (
        <View className="ml-1">
          <Icon icon={CaretRight} size={12} color={c.muted} weight="bold" />
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return <View testID="audience">{body}</View>;
  return (
    <Pressable testID="audience" accessibilityRole="button" accessibilityLabel={line} accessibilityHint="Cambia quién ve esta conversación" onPress={onPress} className="active:opacity-60">
      {body}
    </Pressable>
  );
}
