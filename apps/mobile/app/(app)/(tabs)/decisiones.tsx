import type { Decision } from '@ghostaff/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, SectionList, Text, View } from 'react-native';
import { DecisionCard } from '@/components/DecisionCard';
import { DecisionView } from '@/components/DecisionView';
import { SealCheck, WarningCircle } from '@/components/icons';
import { SpaceSwitcher } from '@/components/SpaceSwitcher';
import { Badge, Button, EmptyState, Loading, Notice, ScreenTitle } from '@/components/ui';
import { useInbox } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { DESKTOP_LIST_WIDTH, useIsDesktop } from '@/lib/layout';
import { useTabScreenTop } from '@/lib/tabs';

// Decisiones, the middle tab (three-tabs.md): what waits for you, then what
// you answered and the agent hasn't picked up yet (app-design.md, decision 8:
// you can still take it back). The list for now; one card at a time, to answer
// or leave for later, comes next (decision 7). What was decided is in Empresa,
// Registro.

export default function Decisiones() {
  const top = useTabScreenTop();
  const desktop = useIsDesktop();
  const { active } = useActiveOrg();
  const { decisions, loading, error, reload } = useInbox(active?.id ?? null);
  // On a desktop the open decision sits beside the list (desktop-web.md).
  const [picked, setPicked] = useState<string | null>(null);

  // Back from a decision: show its new state.
  useFocusEffect(useCallback(() => void reload(), [reload]));

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
      contentContainerStyle={{ paddingHorizontal: desktop ? 40 : 20, paddingBottom: 40, paddingTop: (desktop ? 16 : 12) + top }}
      contentInsetAdjustmentBehavior="automatic"
      sections={sections}
      keyExtractor={(d) => d.id}
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
      ListHeaderComponent={
        <>
          {/* Where you are, on every tab (welcome-and-spaces.md); on a desktop the sidebar shows it. */}
          <SpaceSwitcher />
          <ScreenTitle>Decisiones</ScreenTitle>
        </>
      }
      ListEmptyComponent={
        <EmptyState icon={SealCheck} title="Nada que decidir" body="Cuando un agente necesite tu OK, lo verás aquí." />
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
