import type { Agent } from '@ghostaff/shared';
import { deleteAgent, getAgent } from '@ghostaff/shared/services';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { ThreadRow } from '@/components/chat/ThreadRow';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { Button, ErrorText, LEVEL_NAMES, Loading, Notice } from '@/components/ui';
import { useMyLevels, useThreads } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';

// One agent of the team: live in 3D on top (drag to spin it, tap to make it
// hop), its job, and its conversations under it (team-chat.md, decisions 2 and
// 10), newest first. Whoever may talk to it starts a new one from here. An
// owner sets who may use it, and can remove it (two taps, so not by accident).

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

  const header = (
    <View>
      <Text className="text-center text-xs uppercase tracking-wide text-muted">
        {DEPARTMENT_NAMES[agent.department]} · {g.label}
      </Text>
      <Text className="mt-2 text-center text-base text-ink">{g.job}</Text>
      <View className="mb-2 mt-6 flex-row items-center justify-between">
        <Text className="font-display text-lg text-ink">Conversaciones</Text>
        {canTalk ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push(`/conversacion/nueva?agent=${agent.id}`)}>
            <Text className="text-base font-semibold text-ink">+ Nueva</Text>
          </Pressable>
        ) : level ? (
          <Text className="text-sm text-muted">Puedes {LEVEL_NAMES[level].toLowerCase()}</Text>
        ) : null}
      </View>
      {threads.length === 0 ? (
        <View className="rounded-2xl border border-dashed border-line p-4">
          <Text className="text-sm text-muted">
            {canTalk ? `Aún no hay conversaciones. Empieza una y ${agent.name} la verá, igual que quien pueda verle.` : 'Aún no hay conversaciones.'}
          </Text>
        </View>
      ) : null}
    </View>
  );

  const footer = (
    <View className="pb-10">
      {owner ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/acceso/${agent.id}`)}
          className="mt-6 flex-row items-center justify-between rounded-2xl border border-line bg-card px-4 py-3"
        >
          <View>
            <Text className="text-base font-semibold text-ink">Quién puede</Text>
            <Text className="text-sm text-muted">Ver o hablar con {agent.name}, persona a persona</Text>
          </View>
          <Text className="text-xl text-muted">›</Text>
        </Pressable>
      ) : null}
      {owner ? (
        <View className="mt-3">
          {confirming ? (
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Button label="Cancelar" tone="plain" onPress={() => setConfirming(false)} />
              </View>
              <View className="flex-1">
                <Button label="Sí, quitar" tone="no" busy={busy} onPress={() => void remove()} />
              </View>
            </View>
          ) : (
            <Button label="Quitar del equipo" tone="plain" onPress={() => setConfirming(true)} />
          )}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </View>
  );

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen options={{ title: agent.name }} />
      {/* The ghost stays out of the list so dragging it never scrolls the page. */}
      <View style={{ height: 200 }}>
        <GhostViewer ghost={agent.ghost} active={focused} />
      </View>
      <FlatList
        data={threads}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        renderItem={({ item, index }) => (
          <View
            className={`overflow-hidden border-x border-line bg-card ${index === 0 ? 'rounded-t-2xl border-t' : ''} ${index === threads.length - 1 ? 'rounded-b-2xl border-b' : ''}`}
          >
            <ThreadRow thread={item} first={index === 0} onPress={() => router.push(`/conversacion/${item.id}`)} />
          </View>
        )}
        contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12 }}
      />
    </View>
  );
}
