import type { ConversationVisibility } from '@ghostaff/shared';
import { startThread } from '@ghostaff/shared/services';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useMemo, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { Composer } from '@/components/chat/Composer';
import { VisibilityPicker } from '@/components/chat/VisibilityPicker';
import { Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { useAgents } from '@/lib/hooks/useAgents';
import { letAgentAnswer, useMembers } from '@/lib/hooks/useChat';
import { useEngine } from '@/lib/hooks/useConnections';
import { KeyboardColumn } from '@/lib/keyboard';
import { supabase } from '@/lib/supabase';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';

// A new titled conversation with an agent (chat-permissions.md, decision 2),
// opened from its page: who sees it, preselected to the agent's default, and
// the first message, which titles it. Sending opens it and asks the agent.

export default function NuevaConversacion() {
  const { agent: agentId } = useLocalSearchParams<{ agent: string }>();
  const { session } = useAuth();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const { items: agents, loading } = useAgents(orgId);
  const { members } = useMembers(orgId);
  const engine = useEngine();
  const headerHeight = useHeaderHeight();
  const [choice, setChoice] = useState<ConversationVisibility | null>(null);
  const me = session?.user.id;
  const agent = agents.find((a) => a.id === agentId);
  const names = useMemo(() => [...agents.map((a) => a.name), ...members.filter((m) => m.userId !== me).map((m) => m.displayName)], [agents, members, me]);

  if (!agent && loading) return <Loading />;
  if (!agent) return <Notice title="No encontramos este agente" body="Puede que ya no esté en el equipo, o que no tengas acceso." />;
  const visibility = choice ?? agent.chatDefault;

  const send = async (body: string) => {
    const id = await startThread(supabase, agent.id, body, visibility);
    if (engine) letAgentAnswer(engine, id);
    router.replace(`/conversacion/${id}`);
  };

  return (
    <KeyboardColumn offset={headerHeight}>
      <Stack.Screen options={{ title: 'Nueva conversación' }} />
      <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-8" keyboardShouldPersistTaps="handled">
        <VisibilityPicker value={visibility} agentName={agent.name} onChange={setChoice} />
        <Text className="mt-6 px-4 text-footnote text-muted">Lo primero que escribas le da título.</Text>
      </ScrollView>
      <Composer placeholder={`Escribe a ${agent.name}`} names={names} onSend={send} />
    </KeyboardColumn>
  );
}
