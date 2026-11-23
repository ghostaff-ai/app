import type { ConversationVisibility } from '@ghostaff/shared';
import { getThread, OthersHaveWrittenError, setConversationVisibility, type ThreadHead } from '@ghostaff/shared/services';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { VisibilityPicker } from '@/components/chat/VisibilityPicker';
import { Button, ErrorText, Loading, Notice } from '@/components/ui';
import { widens } from '@/lib/chat';
import { useAgents } from '@/lib/hooks/useAgents';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// Who sees a conversation, changed by whoever opened it (chat-permissions.md):
// the three choices, a warning when others will read what was said before,
// and «Guardar». Once someone else has written, it can be closed to reading
// but not made private again; the database says so and this screen explains.

export default function Visibilidad() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useActiveOrg();
  const { items: agents } = useAgents(active?.id ?? null);
  const [head, setHead] = useState<ThreadHead | null | undefined>(undefined);
  const [choice, setChoice] = useState<ConversationVisibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getThread(supabase, id)
      .then(setHead)
      .catch(() => setHead(null));
  }, [id]);

  if (head === undefined) return <Loading />;
  if (!head) return <Notice title="No encontramos esta conversación" body="Puede que ya no tengas acceso a ella." />;
  const agentName = agents.find((a) => a.id === head.agentId)?.name ?? 'el agente';
  const chosen = choice ?? head.visibility;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setConversationVisibility(supabase, head.id, chosen);
      router.back();
    } catch (e) {
      setBusy(false);
      setError(
        e instanceof OthersHaveWrittenError
          ? 'Otras personas ya han escrito aquí. Puedes dejar que solo la lean, pero no volver a hacerla privada.'
          : 'No se ha guardado. Prueba otra vez en un momento.',
      );
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-16">
      <Stack.Screen options={{ title: 'Quién la ve' }} />
      <VisibilityPicker
        value={chosen}
        agentName={agentName}
        onChange={(v) => {
          setChoice(v);
          setError(null);
        }}
        footer={widens(head.visibility, chosen) ? 'Verán toda la conversación, también lo que ya se ha dicho.' : undefined}
      />
      <ErrorText>{error}</ErrorText>
      <View className="mt-6">
        <Button testID="visibility-save" label="Guardar" busy={busy} disabled={chosen === head.visibility} onPress={() => void save()} />
      </View>
    </ScrollView>
  );
}
