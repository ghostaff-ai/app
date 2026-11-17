import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { DecisionCard } from '@/components/DecisionCard';
import { Button, Loading, Notice } from '@/components/ui';
import { useDecided } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { TAB_SCREEN_TOP } from '@/lib/tabs';

// Registro: what the organisation has decided, newest first, each with who
// answered. The first piece of the record the app shows; the rest of it (the
// facts Incorporación gathers, what agents did alone) joins here as it exists.

export default function Registro() {
  const { active } = useActiveOrg();
  const { decisions, loading, error, reload } = useDecided(active?.id ?? null);

  useFocusEffect(useCallback(() => void reload(), [reload]));

  if (loading && decisions.length === 0) return <Loading />;
  if (error) return <Notice title="No hemos podido cargar el registro" body={error} action={<Button label="Reintentar" onPress={() => void reload()} />} />;

  return (
    <FlatList
      className="flex-1 bg-surface"
      contentContainerStyle={{ padding: 16, paddingBottom: 40, paddingTop: 16 + TAB_SCREEN_TOP }}
      contentInsetAdjustmentBehavior="automatic"
      data={decisions}
      keyExtractor={(d) => d.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
      ListHeaderComponent={
        <View className="mb-4">
          <Text className="font-display text-2xl text-ink">Registro</Text>
          <Text className="mt-1 text-base text-muted">Lo decidido, lo último primero.</Text>
        </View>
      }
      ListEmptyComponent={
        <View className="items-center py-16">
          <Text className="text-center text-base text-muted">Aquí quedará cada cosa que decidas, con quién y cuándo.</Text>
        </View>
      }
      renderItem={({ item }) => <DecisionCard decision={item} onPress={() => router.push(`/decision/${item.id}`)} />}
    />
  );
}
