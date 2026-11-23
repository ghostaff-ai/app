import type { Agent } from '@ghostaff/shared';
import { deleteAgent, getAgent } from '@ghostaff/shared/services';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ThreadRow } from '@/components/chat/ThreadRow';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { Eye, LinkSimple, Prohibit } from '@/components/icons';
import { Button, ErrorText, LEVEL_NAMES, ListRow, ListSection, Loading, Notice, RowIcon } from '@/components/ui';
import { useMyLevels, useThreads } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';

// One agent's page, opened from its name on top of the chat (three-tabs.md,
// decision 6): live in 3D on top (drag to spin it, tap to make it hop), its
// job, and the shared conversations of before, read-only history. An owner
// sets who may use it and which connected accounts it uses, and can remove it
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
  const { threads, reload: reloadThreads } = useThreads(orgId, id);
  const { levels, reload: reloadLevels } = useMyLevels(orgId);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void reloadThreads();
      void reloadLevels();
      return () => setFocused(false);
    }, [reloadThreads, reloadLevels]),
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
  // The shared, titled threads of before (team-chat.md, decision 2): history now.
  const earlier = threads.filter((t) => !t.personal && !t.notices);

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
        <Text className="mt-1.5 text-center text-[17px] leading-6 text-ink">{g.job}</Text>

        {earlier.length > 0 ? (
          <ListSection header="Conversaciones anteriores" footer="De antes de que cada persona tuviera su propia conversación con cada agente.">
            {earlier.map((t) => (
              <ThreadRow key={t.id} thread={t} onPress={() => router.push(`/conversacion/${t.id}`)} />
            ))}
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
            <ListRow
              leading={<RowIcon icon={Prohibit} tone="danger" />}
              title={confirming ? 'Cancelar' : 'Quitar del equipo'}
              tone={confirming ? 'default' : 'danger'}
              onPress={() => setConfirming((v) => !v)}
            />
          </ListSection>
        ) : null}
        {owner && confirming ? (
          <View className="mt-3">
            <Button label={`Sí, quitar a ${agent.name}`} variant="danger" busy={busy} onPress={() => void remove()} />
          </View>
        ) : null}
        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </View>
  );
}
