import { memoryTitle } from '@ghostaff/shared';
import type { MemoryNote } from '@ghostaff/shared/services';
import { useFocusEffect } from 'expo-router';
import { type ReactNode, useCallback } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { Brain, WarningCircle } from '@/components/icons';
import { Button, EmptyState, ListRow, Loading, Notice, ScreenTitle } from '@/components/ui';
import { memoryDay, type MemorySource, useMemories } from '@/lib/hooks/useMemory';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';

// A store of the memory as a list, the latest changed first: the organisation's («Memoria de la
// empresa») and each agent's own («Memoria de Finanzas»). Read-only; a file opens on its own screen.

export function MemoryList(props: {
  source: MemorySource | null;
  title: string;
  subtitle: string;
  empty: { title: string; body: string };
  /** Space above the title, for a screen under the tab bar's header. */
  top?: number;
  onOpen: (path: string) => void;
}): ReactNode {
  const desktop = useIsDesktop();
  const { notes, loading, error, reload } = useMemories(props.source);

  useFocusEffect(useCallback(() => void reload(), [reload]));

  if (loading && notes.length === 0) return <Loading />;
  if (error)
    return <Notice icon={WarningCircle} title="No hemos podido cargar la memoria" body={error} action={<Button label="Reintentar" variant="secondary" onPress={() => void reload()} />} />;

  return (
    <FlatList<Omit<MemoryNote, 'content'>>
      className="flex-1 bg-surface"
      contentContainerStyle={{
        paddingHorizontal: desktop ? 40 : 20,
        paddingBottom: 40,
        paddingTop: (desktop ? 40 : 12) + (props.top ?? 0),
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
          <ScreenTitle subtitle={props.subtitle}>{props.title}</ScreenTitle>
        </View>
      }
      ListEmptyComponent={<EmptyState icon={Brain} title={props.empty.title} body={props.empty.body} />}
      renderItem={({ item }) => (
        <ListRow
          title={memoryTitle(item.path)}
          subtitle={item.updatedBy ? `${memoryDay(item.updatedAt)} · ${item.updatedBy}` : memoryDay(item.updatedAt)}
          chevron
          onPress={() => props.onOpen(item.path)}
        />
      )}
    />
  );
}
