import type { Agent, ConversationVisibility } from '@ghostaff/shared';
import { getAgent, setAgentChatDefault } from '@ghostaff/shared/services';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { VisibilityPicker } from '@/components/chat/VisibilityPicker';
import { ErrorText, Loading, Notice } from '@/components/ui';
import { supabase } from '@/lib/supabase';

// Who reads a new conversation with one agent unless its opener chooses
// otherwise (chat-permissions.md): owners only, from the agent's page. It
// never changes a conversation already open. A choice shows at once and is
// undone if the database refuses it.

export default function ConversacionesNuevas() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getAgent(supabase, id)
      .then(setAgent)
      .catch(() => setAgent(null));
  }, [id]);

  if (agent === undefined) return <Loading />;
  if (!agent) return <Notice title="No encontramos este agente" />;

  const change = async (v: ConversationVisibility) => {
    const before = agent.chatDefault;
    setAgent({ ...agent, chatDefault: v });
    setError(null);
    try {
      await setAgentChatDefault(supabase, agent.id, v);
    } catch {
      setAgent((a) => (a ? { ...a, chatDefault: before } : a));
      setError('No se ha guardado. Solo quien es propietario de la empresa puede cambiarlo.');
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-16">
      <Stack.Screen options={{ title: 'Conversaciones nuevas' }} />
      <VisibilityPicker
        header={`Al abrir una conversación con ${agent.name}`}
        value={agent.chatDefault}
        agentName={agent.name}
        onChange={(v) => void change(v)}
        footer="Es lo que viene marcado. Quien abre la conversación puede elegir otra cosa, y las que ya existen no cambian."
      />
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
