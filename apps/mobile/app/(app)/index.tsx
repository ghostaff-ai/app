import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { DecisionCard } from '@/components/DecisionCard';
import { Button, Loading, Notice } from '@/components/ui';
import { useInbox } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// The decision inbox: what the organisation's agents are waiting on a person
// for, with what is still waiting first.

export default function Inbox() {
  const { active } = useActiveOrg();
  const { decisions, loading, error, reload } = useInbox(active?.id ?? null);

  // Back from a decision: show its new state.
  useFocusEffect(useCallback(() => void reload(), [reload]));

  if (loading && decisions.length === 0) return <Loading />;
  if (error) return <Notice title="No hemos podido cargar las decisiones" body={error} action={<Button label="Reintentar" onPress={() => void reload()} />} />;

  const waiting = decisions.filter((d) => !d.answer).length;

  return (
    <FlatList
      className="flex-1 bg-surface"
      contentContainerClassName="p-4"
      data={decisions}
      keyExtractor={(d) => d.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
      ListHeaderComponent={
        <Text className="mb-4 text-base text-muted">
          {waiting === 0 ? 'Nada te espera.' : waiting === 1 ? 'Una decisión te espera.' : `${waiting} decisiones te esperan.`}
        </Text>
      }
      ListEmptyComponent={
        <View className="items-center py-16">
          <Text className="text-center text-base text-muted">Cuando un agente necesite tu OK, aparecerá aquí.</Text>
        </View>
      }
      renderItem={({ item }) => <DecisionCard decision={item} onPress={() => router.push(`/decision/${item.id}`)} />}
    />
  );
}
