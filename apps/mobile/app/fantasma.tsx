import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Agent, DEFAULT_LOOK, type Eyes, type Look, type Surface } from '@/components/ghost/GhostScene';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import type { Tone, TripoModel } from '@/components/ghost/TripoScene';

// Spike: a live 3D ghost, open without signing in at /fantasma.

// Ours (built in Blender by design/blender/ghost.py) exist for the first three;
// Tripo's (made from Álvaro's pictures) for all five.
const AGENTS: { id: TripoModel; label: string; ours: boolean }[] = [
  { id: 'base', label: 'Base', ours: true },
  { id: 'secretaria', label: 'Secretaría', ours: true },
  { id: 'redes', label: 'Redes', ours: true },
  { id: 'incorporacion', label: 'Incorporación', ours: false },
  { id: 'finanzas', label: 'Finanzas', ours: false },
];
type Source = 'tripo' | 'ours';
const TONES: { id: Tone; label: string }[] = [
  { id: 'original', label: 'A' },
  { id: 'dark', label: 'B' },
  { id: 'darker', label: 'C' },
];
const SOURCES: { id: Source; label: string }[] = [
  { id: 'tripo', label: 'Tripo' },
  { id: 'ours', label: 'Nuestro' },
];

// Look options to compare on the phone; the URL can preset them
// (?surface=glass&eyes=hollow).
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
  const params = useLocalSearchParams<{ agent?: string; surface?: string; eyes?: string; source?: string; tone?: string }>();
  const [agent, setAgent] = useState<TripoModel>(AGENTS.find((a) => a.id === params.agent)?.id ?? 'base');
  const [source, setSource] = useState<Source>(params.source === 'ours' ? 'ours' : 'tripo');
  const [tone, setTone] = useState<Tone>(TONES.find((o) => o.id === params.tone)?.id ?? 'dark');
  const hasOurs = AGENTS.find((a) => a.id === agent)!.ours;
  const tripo = source === 'tripo' || !hasOurs ? agent : null;
  const [look, setLook] = useState<Look>({
    surface: SURFACES.find((o) => o.id === params.surface)?.id ?? DEFAULT_LOOK.surface,
    eyes: EYES.find((o) => o.id === params.eyes)?.id ?? DEFAULT_LOOK.eyes,
  });
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-row flex-wrap justify-center gap-2 px-4 pt-4">
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
        <GhostViewer active={focused} agent={agent as Agent} look={look} tripo={tripo} tone={tone} />
      </View>
      <View className="gap-2 pb-3">
        {hasOurs && (
          <View className="flex-row items-center justify-center gap-2">
            <Text className="w-20 text-right text-muted">Modelo</Text>
            {SOURCES.map((o) => (
              <Pressable
                key={o.id}
                onPress={() => setSource(o.id)}
                className={`h-9 items-center justify-center rounded-full border px-4 ${source === o.id ? 'border-transparent bg-black' : 'border-gray-300'}`}
              >
                <Text className={source === o.id ? 'text-white' : 'text-muted'}>{o.label}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {tripo && <Chips title="Tono" options={TONES} value={tone} onChange={setTone} />}
        {!tripo && (
          <>
            <Chips title="Superficie" options={SURFACES} value={look.surface} onChange={(surface) => setLook({ ...look, surface })} />
            <Chips title="Ojos" options={EYES} value={look.eyes} onChange={(eyes) => setLook({ ...look, eyes })} />
          </>
        )}
      </View>
      <Text className="pb-6 text-center text-base text-muted">{tripo ? 'Arrástralo para girarlo. Tócalo para que salte.' : 'Arrástralo para girarlo. Tócalo para cambiar su cara.'}</Text>
    </SafeAreaView>
  );
}
