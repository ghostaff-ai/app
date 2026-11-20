import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { MicButton } from '@/components/chat/MicButton';
import { DecisionCard } from '@/components/DecisionCard';
import { Tray, WarningCircle } from '@/components/icons';
import { Button, EmptyState, Loading, Notice, ScreenTitle } from '@/components/ui';
import { useDecided } from '@/lib/hooks/useDecisions';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useTabScreenTop } from '@/lib/tabs';

// Registro: what the organisation has decided, newest first, each with who
// answered. The first piece of the record the app shows; the rest of it (the
// facts Incorporación gathers, what agents did alone) joins here as it exists.

export default function Registro() {
  const { active } = useActiveOrg();
  const top = useTabScreenTop();
  const { decisions, loading, error, reload } = useDecided(active?.id ?? null);

  useFocusEffect(useCallback(() => void reload(), [reload]));

  if (loading && decisions.length === 0) return <Loading />;
  if (error) return <Notice icon={WarningCircle} title="No hemos podido cargar el registro" body={error} action={<Button label="Reintentar" variant="secondary" onPress={() => void reload()} />} />;

  return (
    <FlatList
      className="flex-1 bg-surface"
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12 + top }}
      contentInsetAdjustmentBehavior="automatic"
      data={decisions}
      keyExtractor={(d) => d.id}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
      ListHeaderComponent={
        <View className="mb-3">
          <ScreenTitle right={<MicButton />} subtitle="Lo decidido, lo último primero.">
            Registro
          </ScreenTitle>
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon={Tray}
          title="Aún no hay nada decidido"
          body="Aquí quedará cada cosa que decidas, con quién y cuándo."
          action={<Button label="Ver lo que te espera" variant="secondary" onPress={() => router.navigate('/')} />}
        />
      }
      renderItem={({ item }) => <DecisionCard decision={item} onPress={() => router.push(`/decision/${item.id}`)} />}
    />
  );
}
