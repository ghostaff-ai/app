import { memoryTitle } from '@ghostaff/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Brain, WarningCircle } from '@/components/icons';
import { Button, EmptyState, ListRow, Loading, Notice, ScreenTitle } from '@/components/ui';
import { memoryDay, useMemories } from '@/lib/hooks/useMemory';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useTabScreenTop } from '@/lib/tabs';

// «Memoria de la empresa», in Empresa (business-brain.md; agent-memory.md, The screens): what
// Secretaría filed from what people dropped in her chat, the latest changed first. Every member sees
// it; a file opens on its own screen (/memoria/[...path]), the same one a reply's link opens.

export default function MemoriaDeLaEmpresa() {
  const { active } = useActiveOrg();
  const top = useTabScreenTop();
  const desktop = useIsDesktop();
  const { notes, loading, error, reload } = useMemories(active?.id ?? null);

  useFocusEffect(useCallback(() => void reload(), [reload]));

  if (loading && notes.length === 0) return <Loading />;
  if (error)
    return <Notice icon={WarningCircle} title="No hemos podido cargar la memoria" body={error} action={<Button label="Reintentar" variant="secondary" onPress={() => void reload()} />} />;

  return (
    <FlatList
      className="flex-1 bg-surface"
      contentContainerStyle={{
        paddingHorizontal: desktop ? 40 : 20,
        paddingBottom: 40,
        paddingTop: (desktop ? 40 : 12) + top,
        maxWidth: DESKTOP_CONTENT_MAX_WIDTH,
        width: '100%',
        alignSelf: 'center',
      }}
      contentInsetAdjustmentBehavior="automatic"
      data={notes}
      keyExtractor={(n) => n.path}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void reload()} />}
      ListHeaderComponent={
        <View className="mb-3">
          <ScreenTitle subtitle="Lo que Secretaría ha guardado. Lo ve todo el equipo.">Memoria de la empresa</ScreenTitle>
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon={Brain}
          title="Aún no hay nada guardado"
          body="Cuéntale a Secretaría lo que quieras que recuerde, o pásale un enlace o una nota de voz."
        />
      }
      renderItem={({ item }) => (
        <ListRow
          title={memoryTitle(item.path)}
          subtitle={item.updatedBy ? `${memoryDay(item.updatedAt)} · ${item.updatedBy}` : memoryDay(item.updatedAt)}
          chevron
          onPress={() => router.push(`/memoria/${item.path}`)}
        />
      )}
    />
  );
}
