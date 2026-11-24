import { describeWhen, type Routine } from '@ghostaff/shared';
import { setRoutinePaused } from '@ghostaff/shared/services';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { Clock } from '@/components/icons';
import { Button, EmptyState, ErrorText, ListRow, ListSection, Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useAgents } from '@/lib/hooks/useAgents';
import { useMyLevels } from '@/lib/hooks/useChat';
import { useRoutines } from '@/lib/hooks/useRoutines';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { usePalette } from '@/lib/theme';

// An agent's routines (agent-routines.md), opened from the clock on its chat
// or the row on its page: what it does on its own, at an hour, and whose
// chat its answer reaches. The person's own first, then the team's. A switch
// pauses one; a tap opens it to change it. Only its creator changes a «Solo
// para mí» one, only an owner a team's (the database checks it too).

export default function Rutinas() {
  const { agent: agentId } = useLocalSearchParams<{ agent: string }>();
  const { session } = useAuth();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const { items: agents, loading: agentsLoading } = useAgents(orgId);
  const { levels } = useMyLevels(orgId);
  const { items, loading, error: loadError, reload } = useRoutines(orgId, agentId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const c = usePalette();

  const agent = agents.find((a) => a.id === agentId);
  if (!agent && agentsLoading) return <Loading />;
  if (!agent) return <Notice title="No encontramos este agente" body="Puede que ya no esté en el equipo, o que no tengas acceso." />;
  if (loading && items.length === 0) return <Loading />;

  const me = session?.user.id;
  const owner = active?.role === 'owner';
  const canTalk = levels[agent.id] === 'talk' && agent.runner !== 'ordago_job';
  const mine = items.filter((r) => r.audience === 'me');
  const team = items.filter((r) => r.audience === 'team');
  const mayChange = (r: Routine) => (r.audience === 'me' ? r.createdBy === me : owner);
  const add = () => router.push({ pathname: '/rutina', params: { agent: agent.id } });

  const toggle = async (r: Routine, on: boolean) => {
    setSwitching(r.id);
    setError(null);
    try {
      await setRoutinePaused(supabase, r.id, !on);
      await reload();
    } catch {
      setError(on ? `No se ha reanudado: puede que ya no puedas hablar con ${agent.name}.` : 'No se ha pausado. Vuelve a intentarlo.');
    } finally {
      setSwitching(null);
    }
  };

  const row = (r: Routine) => (
    <ListRow
      key={r.id}
      testID={`routine-${r.id}`}
      title={r.title}
      subtitle={r.paused ? (r.pausedReason === 'creator_gone' ? 'En pausa: quien la creó ya no puede usarla' : 'En pausa') : describeWhen(r)}
      chevron={mayChange(r)}
      onPress={mayChange(r) ? () => router.push({ pathname: '/rutina', params: { agent: agent.id, id: r.id } }) : undefined}
      trailing={
        mayChange(r) ? (
          <Switch
            accessibilityLabel={`${r.title}: ${r.paused ? 'en pausa' : 'activa'}`}
            value={!r.paused}
            disabled={switching === r.id}
            onValueChange={(on) => void toggle(r, on)}
            trackColor={{ true: c.accent }}
          />
        ) : undefined
      }
    />
  );

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-16" contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: 'Rutinas' }} />
      {items.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Ninguna rutina todavía"
          body={
            canTalk
              ? `${agent.name} puede hacer algo solo, a su hora, y contestarte en vuestro chat. Por ejemplo: «cada viernes a las 9, mándame el resumen de ventas».`
              : `${agent.name} no tiene rutinas que puedas ver.`
          }
          action={canTalk ? <Button testID="routine-new" label="Nueva rutina" onPress={add} /> : undefined}
        />
      ) : (
        <>
          <Text className="mt-2 px-1 text-base text-muted">
            Lo que {agent.name} hace solo, a su hora. Lo que conteste te llega a tu chat con {agent.name}.
          </Text>
          {mine.length > 0 ? <ListSection header="Tuyas">{mine.map(row)}</ListSection> : null}
          {team.length > 0 ? (
            <ListSection header="Del equipo" footer="Su respuesta llega a todas las personas que ven a este agente.">
              {team.map(row)}
            </ListSection>
          ) : null}
          {canTalk ? (
            <View className="mt-8">
              <Button testID="routine-new" label="Nueva rutina" onPress={add} />
            </View>
          ) : null}
        </>
      )}
      {agent.schedule ? (
        <Text className="mt-6 px-1 text-footnote text-muted">Además, {agent.name} trabaja solo según su propio horario, que viene de su definición.</Text>
      ) : null}
      <ErrorText>{error ?? loadError}</ErrorText>
    </ScrollView>
  );
}
