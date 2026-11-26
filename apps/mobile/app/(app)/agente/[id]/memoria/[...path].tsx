import { memoryPath } from '@ghostaff/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { MemoryNoteView } from '@/components/memory/MemoryNoteView';

// One file of an agent's own memory (agent-context.md PR 2): what the agent's reply links to when it
// says what it kept, and what «Memoria de Finanzas» opens.

export default function RecuerdoDelAgente() {
  const { id, path: raw } = useLocalSearchParams<{ id: string; path: string | string[] }>();
  const path = memoryPath(Array.isArray(raw) ? raw.join('/') : (raw ?? ''));
  return (
    <MemoryNoteView
      source={id ? { agentId: id } : null}
      path={path}
      back={{ label: 'Ver su memoria', onPress: () => router.replace(`/agente/${id}/memoria`) }}
    />
  );
}
