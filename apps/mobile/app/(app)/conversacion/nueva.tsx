import { startThread } from '@ghostaff/shared/services';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useMemo } from 'react';
import { Image, Text, View } from 'react-native';
import { Composer } from '@/components/chat/Composer';
import { Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useAgents } from '@/lib/hooks/useAgents';
import { letAgentAnswer, useMembers, useMyLevels } from '@/lib/hooks/useChat';
import { useEngine } from '@/lib/hooks/useConnections';
import { KeyboardColumn } from '@/lib/keyboard';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { GHOSTS } from '@/lib/team';

// A new thread with one agent (team-chat.md, decision 2): the agent's ghost and
// job, and a text box ready to type. The first message starts the thread and
// titles it; the screen then becomes that thread.

export default function NuevaConversacion() {
  const { agent: agentId } = useLocalSearchParams<{ agent: string }>();
  const { session } = useAuth();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const { items: agents, loading } = useAgents(orgId);
  const { levels, loading: levelsLoading } = useMyLevels(orgId);
  const { members } = useMembers(orgId);
  const headerHeight = useHeaderHeight();
  const engine = useEngine();
  const names = useMemo(
    () => [...agents.map((a) => a.name), ...members.filter((m) => m.userId !== session?.user.id).map((m) => m.displayName)],
    [agents, members, session?.user.id],
  );

  const agent = agents.find((a) => a.id === agentId);
  if ((loading || levelsLoading) && !agent) return <Loading />;
  if (!agent) return <Notice title="No encontramos este agente" />;
  if (levels[agent.id] !== 'talk') return <Notice title={`Solo puedes ver a ${agent.name}`} body="Pide a quien lleva la empresa que te deje hablar con este agente." />;
  const g = GHOSTS[agent.ghost];

  const send = async (text: string) => {
    const id = await startThread(supabase, agent.id, text);
    if (engine) letAgentAnswer(engine, id);
    router.replace(`/conversacion/${id}`);
  };

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen options={{ title: agent.name }} />
      <KeyboardColumn offset={headerHeight}>
        <View className="flex-1 items-center justify-center px-8">
          <Image source={g.picture} style={{ width: 120, height: 120 }} resizeMode="contain" />
          <Text className="mt-3 font-display text-xl text-ink">{agent.name}</Text>
          <Text className="mt-1 text-center text-base text-muted">{g.job}</Text>
          <Text className="mt-6 text-center text-sm text-muted">Lo que escribas lo verá también quien pueda ver a {agent.name}.</Text>
        </View>
        <Composer placeholder={`Escribe a ${agent.name}`} names={names} onSend={send} autoFocus />
      </KeyboardColumn>
    </View>
  );
}
