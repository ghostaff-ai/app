import { memoryPath } from '@ghostaff/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { MemoryNoteView } from '@/components/memory/MemoryNoteView';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// One file of the organisation's memory (business-brain.md): what a reply links to when it says
// where it filed something or where a fact comes from, and what «Memoria de la empresa» opens.

export default function Recuerdo() {
  const { path: raw } = useLocalSearchParams<{ path: string | string[] }>();
  const path = memoryPath(Array.isArray(raw) ? raw.join('/') : (raw ?? ''));
  const { active } = useActiveOrg();
  return (
    <MemoryNoteView
      source={active ? { orgId: active.id } : null}
      path={path}
      back={{ label: 'Ver la memoria', onPress: () => router.replace('/empresa/memoria') }}
    />
  );
}
