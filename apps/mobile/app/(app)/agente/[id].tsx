import type { Agent } from '@ghostaff/shared';
import { agentJob, deleteAgent, getAgent } from '@ghostaff/shared/services';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { Brain, Clock, Eye, LinkSimple, Prohibit } from '@/components/icons';
import { Button, ErrorText, LEVEL_NAMES, ListRow, ListSection, Loading, Notice, RowIcon } from '@/components/ui';
import { useMyLevels } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';

// One agent's page, opened from its name on top of the chat (three-tabs.md,
// decision 6): live in 3D on top (drag to spin it, tap to make it hop), its
// job, «Rutinas» for whoever may talk to it and its «Memoria» for whoever may
// see it. Its chat is the one everyone with access shares
// (group-chat-per-agent.md): who reads and who writes there is «Quién puede».
// An owner sets that and which connected accounts it uses, and can remove it
// (two taps, so not by accident).

export default function Agente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(true);
  const { levels, reload: reloadLevels } = useMyLevels(orgId);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void reloadLevels();
      return () => setFocused(false);
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
  const g = GHOSTS[agent.ghost];
  const owner = active?.role === 'owner' && active.id === agent.orgId;
  const level = levels[agent.id];

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAgent(supabase, agent.id);
      // Its chat is gone too: back to Equipo, not to it.
      router.dismissTo('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen options={{ title: agent.name }} />
      {/* The ghost stays out of the scroll view so dragging it never scrolls the page. */}
      <View style={{ height: 210 }}>
        <GhostViewer ghost={agent.ghost} active={focused} />
      </View>
      <ScrollView contentContainerClassName="px-5 pb-12">
        <Text className="text-center text-footnote font-medium text-muted">
          {DEPARTMENT_NAMES[agent.department]}, {g.label.toLowerCase()}
        </Text>
        <Text className="mt-1.5 text-center text-[17px] leading-6 text-ink">{agentJob(agent)}</Text>

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
    </View>
  );
}
