import type { Agent } from '@ghostaff/shared';
import { agentJob, getAgent } from '@ghostaff/shared/services';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { DecisionCard } from '@/components/DecisionCard';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { ChatsCircle, GearSix, Icon } from '@/components/icons';
import { PhotoView } from '@/components/photo/PhotoView';
import { StageTag } from '@/components/team/GhostStage';
import { Button, ErrorText, Loading, Notice } from '@/components/ui';
import { shortTime } from '@/lib/chat';
import { decisionHref } from '@/lib/deck';
import { useAgentOverview } from '@/lib/hooks/useAgentOverview';
import { useMyLevels } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';
import { agentTag } from '@/lib/team/status';
import { usePalette } from '@/lib/theme';

// One agent's page, opened from its tile on Equipo and from its name on top
// of the chat (three-tabs.md, decision 6): live in 3D on top (drag to spin it,
// tap to make it hop) with what it is doing, then what matters first
// (team-board.md, decision 4): its decisions waiting for you, its photo
// (agent-photo.md), what it did lately and «Escribir», its chat. Its settings
// are behind the gear on top (agente/[id]/ajustes.tsx).

export default function Agente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);
  const { levels, reload: reloadLevels } = useMyLevels(orgId);
  const overview = useAgentOverview(orgId, id);
  const c = usePalette();
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
  const level = levels[agent.id];
  const tag = agentTag({ waiting: overview.waiting.length, working: overview.working, unread: false });


  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen
        options={{
          title: agent.name,
          headerRight: () => (
            <Pressable
              testID="agent-settings"
              accessibilityRole="button"
              accessibilityLabel={`Ajustes de ${agent.name}`}
              onPress={() => router.push(`/agente/${agent.id}/ajustes`)}
              hitSlop={6}
              className="min-h-11 min-w-11 items-center justify-center active:opacity-60"
            >
              <Icon icon={GearSix} size={22} color={c.ink} />
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerClassName="px-5 pb-12">
        {/* The ghost scrolls away with the page, so a long page isn't half ghost (Jaime, 2026-11-27).
            Its viewer tells the drags apart: sideways spins it, up and down scrolls the page. */}
        <View className="-mx-5" style={{ height: 210 }}>
          <GhostViewer ghost={agent.ghost} active={focused} halo />
          {tag ? (
            <View pointerEvents="none" className="absolute left-0 right-0 top-2 items-center">
              <StageTag tag={tag} />
            </View>
          ) : null}
        </View>
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
