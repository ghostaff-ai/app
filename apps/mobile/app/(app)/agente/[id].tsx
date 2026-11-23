import type { Agent } from '@ghostaff/shared';
import { deleteAgent, getAgent } from '@ghostaff/shared/services';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { ThreadRow } from '@/components/chat/ThreadRow';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { Eye, LinkSimple, Plus, Prohibit } from '@/components/icons';
import { Button, ErrorText, LEVEL_NAMES, ListRow, ListSection, Loading, Notice, RowIcon } from '@/components/ui';
import { useMyLevels, useThreads } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';

// One agent of the team: live in 3D on top (drag to spin it, tap to make it
// hop), its job, and its conversations under it (team-chat.md, decisions 2 and
// 10), newest first. Whoever may talk to it starts a new one from here. An
// owner sets who may use it and which connected accounts it uses, and can
// remove it (two taps, so not by accident).

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
  const canTalk = level === 'talk';

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteAgent(supabase, agent.id);
      router.back();
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

        <ListSection
          header={
            <View className="mb-2 flex-row items-center justify-between px-4">
              <Text accessibilityRole="header" className="text-footnote font-medium text-muted">
                Conversaciones
              </Text>
              {canTalk ? (
                <Button label="Nueva" size="small" variant="secondary" icon={Plus} onPress={() => router.push(`/conversacion/nueva?agent=${agent.id}`)} />
              ) : level ? (
                <Text className="text-footnote text-muted">Puedes {LEVEL_NAMES[level].toLowerCase()}</Text>
              ) : null}
            </View>
          }
        >
          {threads.length === 0 ? (
            <ListRow
              title="Aún no hay conversaciones"
              subtitle={canTalk ? `Empieza una y ${agent.name} la verá, igual que quien pueda verle.` : null}
            />
          ) : null}
          {threads.map((t) => (
            <ThreadRow key={t.id} thread={t} onPress={() => router.push(`/conversacion/${t.id}`)} />
          ))}
        </ListSection>

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
