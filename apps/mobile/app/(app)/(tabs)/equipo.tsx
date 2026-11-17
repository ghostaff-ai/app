import { DEPARTMENTS } from '@ghostaff/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Loading } from '@/components/ui';
import { useAgents } from '@/lib/hooks/useAgents';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { TAB_SCREEN_TOP } from '@/lib/tabs';
import { DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';

// The organisation's team: its three departments and the agents in each, drawn
// as their ghosts. Tap one to see it live. A department with no agents is
// «Vacante»; an owner adds agents from here.

export default function Equipo() {
  const { active } = useActiveOrg();
  const { items, loading, error, reload } = useAgents(active?.id ?? null);
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  if (!active) return null;
  if (loading && items.length === 0) return <Loading />;
  const owner = active.role === 'owner';

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerStyle={{ padding: 16, paddingBottom: 64, paddingTop: 16 + TAB_SCREEN_TOP }} contentInsetAdjustmentBehavior="automatic">
      <Text className="mb-5 font-display text-2xl text-ink">Equipo</Text>
      {DEPARTMENTS.map((d) => {
        const agents = items.filter((a) => a.department === d);
        return (
          <View key={d} className="mb-6">
            <Text className="mb-2 text-xs uppercase tracking-wide text-muted">{DEPARTMENT_NAMES[d]}</Text>
            {agents.length === 0 ? (
              <View className="rounded-2xl border border-dashed border-line p-4">
                <Text className="text-sm text-muted">Vacante</Text>
              </View>
            ) : null}
            {agents.map((a) => (
              <Pressable
                key={a.id}
                accessibilityRole="button"
                accessibilityLabel={a.name}
                onPress={() => router.push(`/agente/${a.id}`)}
                className="mb-3 flex-row items-center rounded-2xl border border-line bg-card p-3"
              >
                <Image source={GHOSTS[a.ghost].picture} style={{ width: 80, height: 80 }} resizeMode="contain" />
                <View className="ml-3 flex-1">
                  <Text className="text-base font-semibold text-ink">{a.name}</Text>
                  <Text className="mt-1 text-sm text-muted">{GHOSTS[a.ghost].job}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        );
      })}
      <ErrorText>{error}</ErrorText>
      {owner ? <Button label="Nuevo agente" onPress={() => router.push('/nuevo-agente')} /> : null}
    </ScrollView>
  );
}
