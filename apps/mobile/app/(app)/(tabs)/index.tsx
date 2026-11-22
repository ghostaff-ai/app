import type { Decision } from '@ghostaff/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { MicButton } from '@/components/chat/MicButton';
import { DecisionCard } from '@/components/DecisionCard';
import { DecisionView } from '@/components/DecisionView';
import { DoneWithoutYou } from '@/components/DoneWithoutYou';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { CaretDown, Icon, WarningCircle } from '@/components/icons';
import { Badge, Button, Loading, Notice } from '@/components/ui';
import { useAgents } from '@/lib/hooks/useAgents';
import { useInbox } from '@/lib/hooks/useDecisions';
import { useDoneWithoutYou } from '@/lib/hooks/useDoneWithoutYou';
import { hello, waitingSentence } from '@/lib/hoy';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useProfile } from '@/lib/profile/ProfileContext';
import { DESKTOP_LIST_WIDTH, useIsDesktop } from '@/lib/layout';
import { useTabScreenTop } from '@/lib/tabs';
import { usePalette } from '@/lib/theme';

// Hoy (app-design.md): Secretaría on top with one sentence, a soft halo behind
// her (decision 21); under it only what waits for you, then what you answered
// and the agent hasn't picked up yet (decision 8: you can still take it back).
// The organisation's name opens the switcher (decision 3); the mic beside it
// talks to Secretaría (decisions 1 and 2). At the end, folded, what the agents
// did on their own (decision 11).

export default function Hoy() {
  const top = useTabScreenTop();
  const c = usePalette();
  const desktop = useIsDesktop();
  const { active } = useActiveOrg();
  const { profile } = useProfile();
  const { decisions, loading, error, reload } = useInbox(active?.id ?? null);
  const done = useDoneWithoutYou(active?.id ?? null);
  const agents = useAgents(active?.id ?? null);
  const [focused, setFocused] = useState(true);
  // On a desktop the open decision sits beside the list (desktop-web.md).
  const [picked, setPicked] = useState<string | null>(null);

  // Back from a decision: show its new state. Away from Hoy: the ghost rests.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void reload();
      void done.reload();
      return () => setFocused(false);
    }, [reload, done.reload]),
  );

  if (loading && decisions.length === 0) return <Loading />;
  if (error) return <Notice icon={WarningCircle} title="No hemos podido cargar las decisiones" body={error} action={<Button label="Reintentar" variant="secondary" onPress={() => void reload()} />} />;

  const waiting = decisions.filter((d) => !d.answer);
  const answered = decisions.filter((d) => d.answer);
  const sections: { title: string; count?: number; data: Decision[] }[] = [];
  if (waiting.length > 0) sections.push({ title: 'Te esperan', count: waiting.length, data: waiting });
  if (answered.length > 0) sections.push({ title: 'Respondidas', data: answered });
  const selected = picked && decisions.some((d) => d.id === picked) ? picked : (waiting[0]?.id ?? null);
  const open = (d: Decision) => (desktop ? setPicked(d.id) : router.push(`/decision/${d.id}`));

  const list = (
    <SectionList
      className="flex-1 bg-surface"
      contentContainerStyle={{ paddingHorizontal: desktop ? 40 : 20, paddingBottom: 40, paddingTop: top }}
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(d) => d.id}
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={() => {
            void reload();
            void done.reload();
            void agents.reload();
          }}
        />
      }
      ListFooterComponent={<DoneWithoutYou runs={done.runs} agents={agents.items} />}
      ListHeaderComponent={
        <View className="pb-2 pt-3">
          {/* On a desktop the sidebar holds the organisation and the mic. */}
          {desktop ? null : (
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
          )}
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
      renderItem={({ item }) => <DecisionCard decision={item} selected={desktop && item.id === selected} onPress={() => open(item)} />}
    />
  );

  if (!desktop) return list;
  return (
    <View className="flex-1 flex-row bg-surface">
      <View style={{ width: DESKTOP_LIST_WIDTH }} className="border-r border-line">
        {list}
      </View>
      <View className="flex-1">
        {selected ? (
          <DecisionView key={selected} id={selected} onAnswered={() => void reload()} />
        ) : (
          <View className="flex-1 items-center justify-center px-10">
            <Text className="text-center text-base text-muted">Cuando algo necesite tu OK, lo verás aquí al lado.</Text>
          </View>
        )}
      </View>
    </View>
  );
}
