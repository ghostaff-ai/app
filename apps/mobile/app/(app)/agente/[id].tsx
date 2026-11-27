import type { Agent } from '@ghostaff/shared';
import { agentJob, deleteAgent, getAgent } from '@ghostaff/shared/services';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { DecisionCard } from '@/components/DecisionCard';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { Brain, ChatsCircle, Clock, Eye, LinkSimple, Prohibit } from '@/components/icons';
import { PhotoView } from '@/components/photo/PhotoView';
import { StageTag } from '@/components/team/GhostStage';
import { Button, ErrorText, LEVEL_NAMES, ListRow, ListSection, Loading, Notice, RowIcon } from '@/components/ui';
import { shortTime } from '@/lib/chat';
import { decisionHref } from '@/lib/deck';
import { useAgentOverview } from '@/lib/hooks/useAgentOverview';
import { useMyLevels } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';
import { agentTag } from '@/lib/team/status';

// One agent's page, opened from its tile on Equipo and from its name on top
// of the chat (three-tabs.md, decision 6): live in 3D on top (drag to spin it,
// tap to make it hop) with what it is doing, then what matters first
// (team-board.md, decision 4): its decisions waiting for you, its photo
// (agent-photo.md), what it did lately and «Escribir», its chat. Below, the settings: «Rutinas» for whoever
// may talk to it and its «Memoria» for whoever may see it. Its chat is the one everyone with access shares
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
  const overview = useAgentOverview(orgId, id);
  const { reload: reloadOverview } = overview;
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void reloadLevels();
      void reloadOverview();
      return () => setFocused(false);
    }, [reloadLevels, reloadOverview]),
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
  const tag = agentTag({ waiting: overview.waiting.length, working: overview.working, unread: false });

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
        <GhostViewer ghost={agent.ghost} active={focused} halo />
        {tag ? (
          <View pointerEvents="none" className="absolute left-0 right-0 top-2 items-center">
            <StageTag tag={tag} />
          </View>
        ) : null}
      </View>
      <ScrollView contentContainerClassName="px-5 pb-12">
        <Text className="text-center text-footnote font-medium text-muted">
          {DEPARTMENT_NAMES[agent.department]}, {g.label.toLowerCase()}
        </Text>
        <Text className="mt-1.5 text-center text-[17px] leading-6 text-ink">{agentJob(agent)}</Text>

        {level ? (
          <View className="mt-5">
            <Button
              testID="agent-write"
              label={level === 'talk' ? 'Escribir' : 'Ver su chat'}
              icon={ChatsCircle}
              onPress={() => router.push(`/chat/${agent.id}`)}
            />
          </View>
        ) : null}

        {overview.waiting.length > 0 ? (
          <View testID="agent-waiting" className="mt-7">
            <Text className="mb-2 ml-1 text-footnote text-muted">{overview.waiting.length === 1 ? 'Te espera' : 'Te esperan'}</Text>
            {overview.waiting.map((d) => (
              <DecisionCard key={d.id} decision={d} onPress={() => router.push(decisionHref(d))} />
            ))}
          </View>
        ) : null}

        {overview.photo && (overview.photo.blocks.length > 0 || overview.photo.error) ? (
          <View className="mt-5">
            <Text className="mb-2 ml-1 text-footnote text-muted">Su foto</Text>
            <PhotoView photo={overview.photo} agentName={agent.name} />
          </View>
        ) : null}

        {overview.runs.length > 0 ? (
          <View testID="agent-lately" className="mt-5">
            <Text className="mb-2 ml-1 text-footnote text-muted">Últimamente</Text>
            <View className="rounded-2xl bg-card px-4 py-1">
              {overview.runs.map((r, i) => (
                <View key={r.id} className={`py-3 ${i > 0 ? 'border-t border-line' : ''}`}>
                  <Text className="text-base leading-[21px] text-ink" numberOfLines={3}>
                    {firstLine(r.summary ?? '')}
                  </Text>
                  <Text className="mt-1 text-footnote text-muted">{shortTime(r.finishedAt ?? r.startedAt)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

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

/** A run's summary as one plain line: its first paragraph, without markdown marks. */
function firstLine(summary: string): string {
  const para = summary.trim().split(/\n\s*\n/)[0] ?? '';
  return para.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
}
