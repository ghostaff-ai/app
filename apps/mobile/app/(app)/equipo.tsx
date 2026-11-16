import { router } from 'expo-router';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { GHOSTS, TEAM } from '@/lib/team';

// The organisation's team: its departments and the agents in each, drawn as
// their ghosts. Tap one to see it live.

export default function Equipo() {
  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="p-4 pb-16">
      {TEAM.map((d) => (
        <View key={d.name} className="mb-6">
          <Text className="mb-2 text-xs uppercase tracking-wide text-muted">{d.name}</Text>
          {d.agents.map((id) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={GHOSTS[id].label}
              onPress={() => router.push(`/agente/${id}`)}
              className="mb-3 flex-row items-center rounded-2xl border border-line bg-card p-3"
            >
              <Image source={GHOSTS[id].picture} style={{ width: 80, height: 80 }} resizeMode="contain" />
              <View className="ml-3 flex-1">
                <Text className="text-base font-semibold text-ink">{GHOSTS[id].label}</Text>
                <Text className="mt-1 text-sm text-muted">{GHOSTS[id].job}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
