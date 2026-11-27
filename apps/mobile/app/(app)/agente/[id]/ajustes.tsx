import type { Agent } from '@ghostaff/shared';
import { deleteAgent, getAgent } from '@ghostaff/shared/services';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Brain, Clock, Eye, LinkSimple, Prohibit } from '@/components/icons';
import { Button, ErrorText, LEVEL_NAMES, ListRow, ListSection, Loading, Notice, RowIcon } from '@/components/ui';
import { useMyLevels } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';

// An agent's settings, behind the gear on top of its page (Jaime, 2026-11-27:
// what is set once shouldn't sit under what it does every day). «Rutinas» for
// whoever may talk to it and its «Memoria» for whoever may see it. Its chat is
// the one everyone with access shares (group-chat-per-agent.md): who reads and
// who writes there is «Quién puede». An owner sets that and which connected
// accounts it uses, and can remove it (two taps, so not by accident).

export default function AjustesDelAgente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const { levels, reload: reloadLevels } = useMyLevels(orgId);
  useFocusEffect(
    useCallback(() => {
      void reloadLevels();
    }, [reloadLevels]),
  );
  useEffect(() => {
    if (!id) return;
    getAgent(supabase, id)
      .then(setAgent)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setAgent(null);
      });
  }, [id]);

  if (agent === undefined) return <Loading />;
  if (!agent) return <Notice title="No encontramos este agente" body={error ?? undefined} />;
  const owner = active?.role === 'owner' && active.id === agent.orgId;
  const level = levels[agent.id];

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAgent(supabase, agent.id);
      // Its page and chat are gone too: back to Equipo, not to them.
      router.dismissTo('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-12">
      <Stack.Screen options={{ title: `Ajustes de ${agent.name}` }} />
      {level === 'talk' && agent.runner !== 'ordago_job' ? (
        <ListSection>
          <ListRow
            testID="agent-routines"
            leading={<RowIcon icon={Clock} />}
            title="Rutinas"
            subtitle={`Lo que ${agent.name} hace solo, a su hora`}
            chevron
            onPress={() => router.push(`/rutinas/${agent.id}`)}
          />
        </ListSection>
      ) : null}
      {agent.runner === 'chat' ? (
        <ListSection>
          {/* What it keeps for itself, for whoever may see it (agent-context.md PR 2, decision 7). */}
          <ListRow
            testID="agent-memory"
            leading={<RowIcon icon={Brain} />}
            title="Memoria"
            subtitle={`Lo que ${agent.name} recuerda para hacer su trabajo`}
            chevron
            onPress={() => router.push(`/agente/${agent.id}/memoria`)}
          />
        </ListSection>
      ) : null}
      {level && level !== 'talk' ? <Text className="mt-6 text-center text-footnote text-muted">Puedes {LEVEL_NAMES[level].toLowerCase()} a {agent.name}.</Text> : null}

      {owner ? (
        <ListSection>
          <ListRow
            leading={<RowIcon icon={Eye} />}
            title="Quién puede"
            subtitle={`Ver o hablar con ${agent.name}, persona a persona`}
            chevron
            onPress={() => router.push(`/acceso/${agent.id}`)}
          />
          <ListRow
            leading={<RowIcon icon={LinkSimple} />}
            title="Herramientas"
            subtitle={`Qué cuentas conectadas usa ${agent.name}`}
            chevron
            onPress={() => router.push(`/herramientas/${agent.id}`)}
          />
          {agent.isMain ? null : (
            <ListRow
              leading={<RowIcon icon={Prohibit} tone="danger" />}
              title={confirming ? 'Cancelar' : 'Quitar del equipo'}
              tone={confirming ? 'default' : 'danger'}
              onPress={() => setConfirming((v) => !v)}
            />
          )}
        </ListSection>
      ) : null}
      {owner && !agent.isMain && confirming ? (
        <View className="mt-3">
          <Button label={`Sí, quitar a ${agent.name}`} variant="danger" busy={busy} onPress={() => void remove()} />
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
