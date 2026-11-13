import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { GhostViewer } from '@/components/ghost/GhostViewer';

// Spike: a live 3D ghost, open without signing in at /fantasma.

export default function Fantasma() {
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-1">
        <GhostViewer active={focused} />
      </View>
      <Text className="pb-6 text-center text-base text-muted">Arrástralo para girarlo. Tócalo para cambiar su cara.</Text>
    </SafeAreaView>
  );
}
