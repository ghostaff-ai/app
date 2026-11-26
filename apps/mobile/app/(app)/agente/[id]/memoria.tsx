import type { Agent } from '@ghostaff/shared';
import { getAgent } from '@ghostaff/shared/services';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { MemoryList } from '@/components/memory/MemoryList';
import { supabase } from '@/lib/supabase';

// «Memoria de Finanzas», under the agent in Equipo (agent-context.md PR 2, decision 7): what the agent
// keeps for itself to do its job, the latest changed first. Whoever may see the agent sees it
// (row-level security); correcting and forgetting are agent-memory.md's.

export default function MemoriaDelAgente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null>(null);
  useEffect(() => {
    if (!id) return;
    getAgent(supabase, id)
      .then(setAgent)
      .catch(() => setAgent(null));
  }, [id]);
  const name = agent?.name ?? 'Este agente';
  return (
    <MemoryList
      source={id ? { agentId: id } : null}
      title={agent ? `Memoria de ${agent.name}` : 'Memoria'}
      subtitle={`Lo que ${agent?.name ?? 'el agente'} recuerda para hacer su trabajo. Lo ve quien puede verlo.`}
      empty={{ title: `${name} aún no recuerda nada`, body: 'Lo que le cuentes y deba seguir sabiendo aparecerá aquí.' }}
      onOpen={(path) => router.push(`/agente/${id}/memoria/${path}`)}
    />
  );
}
