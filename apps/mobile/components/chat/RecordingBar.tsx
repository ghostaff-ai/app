import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { usePalette } from '@/lib/theme';

/** m:ss, as a recorder shows it. */
export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// What takes the text box's place while a voice note is recorded (a red dot,
// the time, «Cancelar») and while it is sent.
export function RecordingBar({ recording, seconds, onCancel }: { recording: boolean; seconds: number; onCancel: () => void }) {
  const c = usePalette();
  return (
    <View className="min-h-11 flex-1 flex-row items-center justify-between rounded-3xl border border-line bg-card px-4">
      {recording ? (
        <>
          <View className="flex-row items-center gap-2" accessibilityLabel={`Grabando, ${clock(seconds)}`}>
            <View className="h-2.5 w-2.5 rounded-full bg-no" />
            <Text className="text-base text-ink">{clock(seconds)}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancelar" onPress={onCancel} hitSlop={8} className="active:opacity-70">
            <Text className="text-base text-muted">Cancelar</Text>
          </Pressable>
        </>
      ) : (
        <View className="flex-row items-center gap-2">
          <ActivityIndicator color={c.muted} />
          <Text className="text-base text-muted">Enviando…</Text>
        </View>
      )}
    </View>
  );
}
