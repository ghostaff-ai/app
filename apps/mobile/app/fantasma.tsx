import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Agent, Eyes, Look, Surface } from '@/components/ghost/GhostScene';
import { GhostViewer } from '@/components/ghost/GhostViewer';

// Spike: a live 3D ghost, open without signing in at /fantasma.

const AGENTS: { id: Agent; label: string }[] = [
  { id: 'base', label: 'Base' },
  { id: 'secretaria', label: 'Secretaría' },
];

// Look options to compare on the phone; the URL can preset them
// (?surface=glass&eyes=hollow&hem=0.88).
const SURFACES: { id: Surface; label: string }[] = [
  { id: 'now', label: 'A' },
  { id: 'glass', label: 'B' },
  { id: 'deep', label: 'C' },
];
const EYES: { id: Eyes; label: string }[] = [
  { id: 'now', label: '1' },
  { id: 'hollow', label: '2' },
  { id: 'deep', label: '3' },
];
const HEMS: { id: number; label: string }[] = [
  { id: 1, label: 'X' },
  { id: 0.88, label: 'Y' },
  { id: 0.78, label: 'Z' },
];

function Chips<T>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View className="flex-row items-center justify-center gap-2">
      <Text className="w-20 text-right text-muted">{title}</Text>
      {options.map((o) => (
        <Pressable
          key={o.label}
          onPress={() => onChange(o.id)}
          className={`h-9 w-11 items-center justify-center rounded-full border ${value === o.id ? 'border-transparent bg-black' : 'border-gray-300'}`}
        >
          <Text className={value === o.id ? 'text-white' : 'text-muted'}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function Fantasma() {
  const [focused, setFocused] = useState(true);
  const params = useLocalSearchParams<{ agent?: string; surface?: string; eyes?: string; hem?: string }>();
  const [agent, setAgent] = useState<Agent>(params.agent === 'secretaria' ? 'secretaria' : 'base');
  const [look, setLook] = useState<Look>({
    surface: SURFACES.find((o) => o.id === params.surface)?.id ?? 'now',
    eyes: EYES.find((o) => o.id === params.eyes)?.id ?? 'now',
    hem: HEMS.find((o) => String(o.id) === params.hem)?.id ?? 1,
  });
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
        <GhostViewer active={focused} agent={agent} look={look} />
      </View>
      <View className="gap-2 pb-3">
        <Chips title="Superficie" options={SURFACES} value={look.surface} onChange={(surface) => setLook({ ...look, surface })} />
        <Chips title="Ojos" options={EYES} value={look.eyes} onChange={(eyes) => setLook({ ...look, eyes })} />
        <Chips title="Falda" options={HEMS} value={look.hem} onChange={(hem) => setLook({ ...look, hem })} />
      </View>
      <Text className="pb-6 text-center text-base text-muted">Arrástralo para girarlo. Tócalo para cambiar su cara.</Text>
    </SafeAreaView>
  );
}
