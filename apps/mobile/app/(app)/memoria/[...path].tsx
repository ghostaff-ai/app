import { memoryPath, memoryTitle } from '@ghostaff/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Markdown } from '@/components/chat/Markdown';
import { Brain, WarningCircle } from '@/components/icons';
import { Button, Loading, Notice } from '@/components/ui';
import { memoryDay, useMemory } from '@/lib/hooks/useMemory';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// One file of the organisation's memory (business-brain.md): what a reply links to when it says
// where it filed something or where a fact comes from, and what «Memoria de la empresa» opens.
// Read-only here; correcting and forgetting are agent-memory.md's.

export default function Recuerdo() {
  const { path: raw } = useLocalSearchParams<{ path: string | string[] }>();
  const path = memoryPath(Array.isArray(raw) ? raw.join('/') : (raw ?? ''));
  const { active } = useActiveOrg();
  const desktop = useIsDesktop();
  const { note, loading, error, reload } = useMemory(active?.id ?? null, path);
  const toMemory = <Button label="Ver la memoria" variant="secondary" onPress={() => router.replace('/empresa/memoria')} />;

  if (!path) return <Notice icon={WarningCircle} title="Este enlace no lleva a la memoria" action={toMemory} />;
  if (loading && !note) return <Loading />;
  if (error) return <Notice icon={WarningCircle} title="No hemos podido abrirlo" body={error} action={<Button label="Reintentar" variant="secondary" onPress={() => void reload()} />} />;
  if (!note) return <Notice icon={Brain} title="Ya no está en la memoria" body="Puede que lo hayan movido o juntado con otro." action={toMemory} />;

  const heading = /^#\s/.test(note.content.trimStart());
  const folder = note.path.includes('/') ? memoryTitle(note.path.slice(0, note.path.lastIndexOf('/'))) : '';
  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ paddingHorizontal: desktop ? 40 : 20, paddingTop: desktop ? 40 : 16, paddingBottom: 48, maxWidth: DESKTOP_CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' }}
      contentInsetAdjustmentBehavior="automatic"
    >
      {/* A note usually opens with its own heading; one that doesn't gets its name as the title. */}
      {heading ? null : (
        <Text accessibilityRole="header" className="font-display text-title text-ink">
          {memoryTitle(note.path)}
        </Text>
      )}
      <Text className={heading ? 'text-sm text-muted' : 'mt-1 text-sm text-muted'}>
        {[folder, memoryDay(note.updatedAt), note.updatedBy].filter(Boolean).join(' · ')}
      </Text>
      <View className={heading ? 'mt-3' : 'mt-5'}>
        <Markdown text={note.content} names={[]} />
      </View>
    </ScrollView>
  );
}
