import type { Decision } from '@ghostaff/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { MicButton } from '@/components/chat/MicButton';
import { DecisionCard } from '@/components/DecisionCard';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { Button, Loading, Notice } from '@/components/ui';
import { useInbox } from '@/lib/hooks/useDecisions';
import { hello, waitingSentence } from '@/lib/hoy';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useProfile } from '@/lib/profile/ProfileContext';
import { TAB_SCREEN_TOP } from '@/lib/tabs';

// Hoy (app-design.md): Secretaría on top with one sentence, a soft halo behind
// her (decision 21); under it only what waits for you, then what you answered
// and the agent hasn't picked up yet (decision 8: you can still take it back).
// The organisation's name opens the switcher (decision 3); the mic beside it
// talks to Secretaría (decisions 1 and 2).

export default function Hoy() {
  const { active } = useActiveOrg();
  const { profile } = useProfile();
  const { decisions, loading, error, reload } = useInbox(active?.id ?? null);
  const [focused, setFocused] = useState(true);

  // Back from a decision: show its new state. Away from Hoy: the ghost rests.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void reload();
      return () => setFocused(false);
    }, [reload]),
  );

  if (loading && decisions.length === 0) return <Loading />;
  if (error) return <Notice title="No hemos podido cargar las decisiones" body={error} action={<Button label="Reintentar" onPress={() => void reload()} />} />;

  const waiting = decisions.filter((d) => !d.answer);
  const answered = decisions.filter((d) => d.answer);
  const sections: { title: string; count?: number; data: Decision[] }[] = [];
  if (waiting.length > 0) sections.push({ title: 'Te esperan', count: waiting.length, data: waiting });
  if (answered.length > 0) sections.push({ title: 'Respondidas', data: answered });

  return (
    <SectionList
      className="flex-1 bg-surface"
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: TAB_SCREEN_TOP }}
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(d) => d.id}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
      ListHeaderComponent={
        <View className="pb-2 pt-3">
          <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${active?.name ?? ''}. Cambiar de organización`}
            onPress={() => router.push('/organizaciones')}
            hitSlop={10}
            className="flex-row items-center self-start"
          >
            <Text className="font-display text-xl text-ink">{active?.name}</Text>
            <Text className="ml-1.5 text-base text-muted">▾</Text>
          </Pressable>
          <MicButton />
          </View>
          <View className="mt-2 h-56">
            <GhostViewer ghost="secretaria" active={focused} halo zoom={1.15} />
          </View>
          <Text className="mt-1 text-base leading-6 text-muted">
            <Text className="font-semibold text-ink">{hello(profile?.fullName)}</Text> {waitingSentence(decisions)}
          </Text>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View className="mb-2 mt-5 flex-row items-center">
          <Text className="font-display text-lg text-ink">{section.title}</Text>
          {section.count ? (
            <View className="ml-2 rounded-full bg-waiting px-2 py-0.5">
              <Text className="text-xs font-semibold text-white">{section.count}</Text>
            </View>
          ) : null}
        </View>
      )}
      renderItem={({ item }) => <DecisionCard decision={item} onPress={() => router.push(`/decision/${item.id}`)} />}
    />
  );
}
