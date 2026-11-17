import type { Agent, AgentAccess, AgentLevel } from '@ghostaff/shared';
import { getAgent, listAgentAccess, setAgentAccess } from '@ghostaff/shared/services';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { ErrorText, LEVEL_NAMES, LevelPicker, Loading, Notice } from '@/components/ui';
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
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
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
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-6 pt-2 pb-16">
      <Stack.Screen options={{ title: `Quién puede · ${agent.name}` }} />
      <Text className="text-base text-muted">
        Con «Ver» lee sus conversaciones y lo que ha hecho. Con «Hablar» además le pide trabajo. Con «Nada» no lo ve.
      </Text>

      <View className="mt-6 overflow-hidden rounded-2xl border border-line bg-card">
        {people.map((p, i) => (
          <View key={p.userId} className={`flex-row items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-line' : ''}`}>
            <View className="flex-1">
              <Text className="text-base text-ink">{p.displayName}</Text>
              {p.role === 'owner' || p.isDefault ? (
                <Text className="text-sm text-muted">
                  {p.role === 'owner' ? 'Propietario · siempre habla' : `Lo de siempre: ${LEVEL_NAMES[agent.memberDefault]}`}
                </Text>
              ) : null}
            </View>
            {p.role === 'owner' ? null : (
              <LevelPicker label={`${p.displayName}, ${agent.name}`} value={p.level} onChange={(l) => void change(p, l)} />
            )}
          </View>
        ))}
      </View>

      {others.length === 0 ? (
        <Text className="mt-4 text-sm text-muted">Aún no hay nadie más en la empresa. Cuando invites a alguien, eliges aquí qué puede hacer.</Text>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
