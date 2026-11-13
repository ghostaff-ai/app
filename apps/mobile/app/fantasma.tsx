import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Agent } from '@/components/ghost/GhostScene';
import { GhostViewer } from '@/components/ghost/GhostViewer';

// Spike: a live 3D ghost, open without signing in at /fantasma.

const AGENTS: { id: Agent; label: string }[] = [
  { id: 'base', label: 'Base' },
  { id: 'secretaria', label: 'Secretaría' },
];

export default function Fantasma() {
  const [focused, setFocused] = useState(true);
  const params = useLocalSearchParams<{ agent?: string }>();
  const [agent, setAgent] = useState<Agent>(params.agent === 'secretaria' ? 'secretaria' : 'base');
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-row justify-center gap-2 pt-4">
        {AGENTS.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => setAgent(a.id)}
            className={`rounded-full border px-4 py-2 ${agent === a.id ? 'border-transparent bg-black' : 'border-gray-300'}`}
          >
            <Text className={agent === a.id ? 'text-white' : 'text-muted'}>{a.label}</Text>
          </Pressable>
        ))}
      </View>
      <View className="flex-1">
        <GhostViewer active={focused} agent={agent} />
      </View>
      <Text className="pb-6 text-center text-base text-muted">Arrástralo para girarlo. Tócalo para cambiar su cara.</Text>
    </SafeAreaView>
  );
}
