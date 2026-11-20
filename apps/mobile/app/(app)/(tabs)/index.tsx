import type { Decision } from '@ghostaff/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { MicButton } from '@/components/chat/MicButton';
import { DecisionCard } from '@/components/DecisionCard';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { CaretDown, Icon, WarningCircle } from '@/components/icons';
import { Badge, Button, Loading, Notice } from '@/components/ui';
import { useInbox } from '@/lib/hooks/useDecisions';
import { hello, waitingSentence } from '@/lib/hoy';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useProfile } from '@/lib/profile/ProfileContext';
import { useTabScreenTop } from '@/lib/tabs';
import { usePalette } from '@/lib/theme';

// Hoy (app-design.md): Secretaría on top with one sentence, a soft halo behind
// her (decision 21); under it only what waits for you, then what you answered
// and the agent hasn't picked up yet (decision 8: you can still take it back).
// The organisation's name opens the switcher (decision 3); the mic beside it
// talks to Secretaría (decisions 1 and 2).

export default function Hoy() {
  const top = useTabScreenTop();
  const c = usePalette();
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
  if (error) return <Notice icon={WarningCircle} title="No hemos podido cargar las decisiones" body={error} action={<Button label="Reintentar" variant="secondary" onPress={() => void reload()} />} />;

  const waiting = decisions.filter((d) => !d.answer);
  const answered = decisions.filter((d) => d.answer);
  const sections: { title: string; count?: number; data: Decision[] }[] = [];
  if (waiting.length > 0) sections.push({ title: 'Te esperan', count: waiting.length, data: waiting });
  if (answered.length > 0) sections.push({ title: 'Respondidas', data: answered });

  return (
    <SectionList
      className="flex-1 bg-surface"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: top }}
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(d) => d.id}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
      ListHeaderComponent={
        <View className="pb-2 pt-3">
          <View className="min-h-11 flex-row items-center justify-between">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${active?.name ?? ''}. Cambiar de organización`}
              onPress={() => router.push('/organizaciones')}
              hitSlop={10}
              className="flex-1 flex-row items-center self-start pr-3 active:opacity-60"
            >
              <Text className="shrink font-display text-title2 text-ink" numberOfLines={1}>
                {active?.name}
              </Text>
              <View className="ml-1.5 mt-0.5">
                <Icon icon={CaretDown} size={16} color={c.muted} weight="bold" />
              </View>
            </Pressable>
            <MicButton />
          </View>
          <View className="mt-2 h-56">
            <GhostViewer ghost="secretaria" active={focused} halo zoom={1.15} />
          </View>
          <Text className="mt-1 text-[17px] leading-6 text-muted">
            <Text className="font-semibold text-ink">{hello(profile?.fullName)}</Text> {waitingSentence(decisions)}
          </Text>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View className="mb-2.5 mt-6 flex-row items-center">
          <Text accessibilityRole="header" className="font-display text-title3 text-ink">
            {section.title}
          </Text>
          {section.count ? (
            <View className="ml-2">
              <Badge count={section.count} />
            </View>
          ) : null}
        </View>
      )}
      renderItem={({ item }) => <DecisionCard decision={item} onPress={() => router.push(`/decision/${item.id}`)} />}
    />
  );
}
