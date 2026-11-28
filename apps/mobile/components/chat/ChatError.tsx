import { Linking, Platform, Pressable, Text, View } from 'react-native';
import { CAMERA_DENIED } from '@/lib/hooks/useMessageActions';

/**
 * A chat's error line, above the box. A refused camera gets «Abrir ajustes»
 * beside it on a phone (Android stops asking after the second «No permitir»,
 * iOS after the first), so turning it on is one tap away.
 */
export function ChatError({ text }: { text: string | null }) {
  if (!text) return null;
  const settings = text === CAMERA_DENIED && Platform.OS !== 'web';
  return (
    <View className="flex-row flex-wrap items-center gap-x-3 px-4 pb-1">
      <Text className="text-footnote text-no">{text}</Text>
      {settings ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Abrir ajustes" onPress={() => void Linking.openSettings()} hitSlop={8} className="active:opacity-70">
          <Text className="text-footnote text-ink underline">Abrir ajustes</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
