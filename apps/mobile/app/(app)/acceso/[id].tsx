import type { Agent, AgentAccess, AgentLevel } from '@ghostaff/shared';
import { getAgent, listAgentAccess, setAgentAccess } from '@ghostaff/shared/services';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { ErrorText, LEVEL_NAMES, LevelPicker, ListRow, ListSection, Loading, Notice } from '@/components/ui';
import { supabase } from '@/lib/supabase';

// Who may use one agent (team-chat.md, decisions 6 and 7): each member of the
// organisation with Nada · Ver · Hablar. Owners only; an owner always talks.
// A change shows at once and is undone if the database refuses it.

export default function Acceso() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [people, setPeople] = useState<AgentAccess[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [a, access] = await Promise.all([getAgent(supabase, id), listAgentAccess(supabase, id)]);
      setAgent(a);
      setPeople(access);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAgent((a) => a ?? null);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (agent === undefined) return <Loading />;
  if (!agent) return <Notice title="Solo quien es propietario de la empresa puede ver esto" body={error ?? undefined} />;

  const change = async (person: AgentAccess, level: AgentLevel) => {
    const before = people;
    setPeople((ps) => ps.map((p) => (p.userId === person.userId ? { ...p, level, isDefault: false } : p)));
        setError(null);
    try {
      await setAgentAccess(supabase, agent.id, person.userId, level);
    } catch (e) {
      setPeople(before);
      setError(`No se ha guardado lo de ${person.displayName}. ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const others = people.filter((p) => p.role !== 'owner');

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-16">
      <Stack.Screen options={{ title: 'Quién puede' }} />
      <ListSection
        footer={
          others.length === 0
            ? 'Aún no hay nadie más en la empresa. Cuando invites a alguien, eliges aquí qué puede hacer.'
            : 'Con «Ver» lee sus conversaciones y lo que ha hecho. Con «Hablar» además le pide trabajo. Con «Nada» no lo ve.'
        }
      >
        {people.map((p) => (
          <ListRow
            key={p.userId}
            title={p.displayName}
            subtitle={p.role === 'owner' ? 'Propietario, siempre habla' : p.isDefault ? `Lo de siempre: ${LEVEL_NAMES[agent.memberDefault]}` : null}
            trailing={p.role === 'owner' ? undefined : <LevelPicker label={`${p.displayName}, ${agent.name}`} value={p.level} onChange={(l) => void change(p, l)} />}
          />
        ))}
      </ListSection>
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
