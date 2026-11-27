import { describeWhen, type Routine } from '@ghostaff/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { Clock } from '@/components/icons';
import { Button, EmptyState, ErrorText, ListRow, ListSection, Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useAgents } from '@/lib/hooks/useAgents';
import { useMyLevels } from '@/lib/hooks/useChat';
import { useRoutines } from '@/lib/hooks/useRoutines';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// An agent's routines (agent-routines.md), opened from the clock on its chat
// or the row on its page: what it does on its own, at an hour, answering in
// its chat, which everyone with access reads (group-chat-per-agent.md,
// decision 6). The person's own first, then the rest. A tap opens one to
// change, pause or delete it: its creator or an owner (the database checks it too).

export default function Routines() {
  const { agent: agentId } = useLocalSearchParams<{ agent: string }>();
  const { session } = useAuth();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const { items: agents, loading: agentsLoading } = useAgents(orgId);
  const { levels } = useMyLevels(orgId);
  const { items, loading, error } = useRoutines(orgId, agentId ?? null);

  const agent = agents.find((a) => a.id === agentId);
  if (!agent && agentsLoading) return <Loading />;
  if (!agent) return <Notice title="No encontramos este agente" body="Puede que ya no esté en el equipo, o que no tengas acceso." />;
  if (loading && items.length === 0) return <Loading />;

  const me = session?.user.id;
  const owner = active?.role === 'owner';
  const canTalk = levels[agent.id] === 'talk' && agent.runner !== 'ordago_job';
  const mine = items.filter((r) => r.createdBy === me);
  const others = items.filter((r) => r.createdBy !== me);
  const mayChange = (r: Routine) => r.createdBy === me || owner;
  const add = () => router.push({ pathname: '/tarea-programada', params: { agent: agent.id } });

  const row = (r: Routine) => (
    <ListRow
      key={r.id}
      testID={`routine-${r.id}`}
      title={r.title}
      subtitle={r.paused ? (r.pausedReason === 'creator_gone' ? 'En pausa: quien la creó ya no puede usarla' : 'En pausa') : describeWhen(r)}
      chevron={mayChange(r)}
      onPress={mayChange(r) ? () => router.push({ pathname: '/tarea-programada', params: { agent: agent.id, id: r.id } }) : undefined}
    />
  );

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-16" contentInsetAdjustmentBehavior="automatic">
      <Stack.Screen options={{ title: 'Tareas programadas' }} />
      {items.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Ninguna tarea programada todavía"
          body={
            canTalk
              ? `${agent.name} puede hacer algo solo, a su hora, y contestar en su chat. Por ejemplo: «cada viernes a las 9, mándame el resumen de ventas».`
              : `${agent.name} no tiene tareas programadas que puedas ver.`
          }
          action={canTalk ? <Button testID="routine-new" label="Nueva tarea programada" onPress={add} /> : undefined}
        />
      ) : (
        <>
          <Text className="mt-2 px-1 text-base text-muted">
            Lo que {agent.name} hace solo, a su hora. Lo que conteste queda en su chat, que lee todo el que tiene acceso.
          </Text>
          {mine.length > 0 ? <ListSection header="Tuyas">{mine.map(row)}</ListSection> : null}
          {others.length > 0 ? <ListSection header="Del resto del equipo">{others.map(row)}</ListSection> : null}
          {canTalk ? (
            <View className="mt-8">
              <Button testID="routine-new" label="Nueva tarea programada" onPress={add} />
            </View>
          ) : null}
        </>
      )}
      {agent.schedule ? (
        <Text className="mt-6 px-1 text-footnote text-muted">Además, {agent.name} trabaja solo según su propio horario, que viene de su definición.</Text>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
