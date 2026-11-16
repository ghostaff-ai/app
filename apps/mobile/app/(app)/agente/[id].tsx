import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { Notice } from '@/components/ui';
import { GHOSTS, isGhostId } from '@/lib/team';

// One agent, live in 3D: drag to spin it, tap to make it hop.

export default function Agente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  if (!id || !isGhostId(id)) return <Notice title="No encontramos este agente" />;
  const g = GHOSTS[id];
  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen options={{ title: g.label }} />
      <View className="flex-1">
        <GhostViewer ghost={id} active={focused} />
      </View>
      <View className="px-6 pb-10 pt-4">
        <Text className="text-center text-base text-ink">{g.job}</Text>
        <Text className="mt-3 text-center text-sm text-muted">Arrástralo para girarlo. Tócalo para que salte.</Text>
      </View>
    </View>
  );
}
