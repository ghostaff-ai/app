import type { Agent } from '@ghostaff/shared';
import { deleteAgent, getAgent } from '@ghostaff/shared/services';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { GhostViewer } from '@/components/ghost/GhostViewer';
import { Button, ErrorText, Loading, Notice } from '@/components/ui';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';

// One agent of the team, live in 3D: drag to spin it, tap to make it hop. An
// owner can remove it from here (two taps, so not by accident).

export default function Agente() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { active } = useActiveOrg();
  const [agent, setAgent] = useState<Agent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
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
      <View className="flex-1">
        <GhostViewer ghost={agent.ghost} active={focused} />
      </View>
      <View className="px-6 pb-10 pt-4">
        <Text className="text-center text-xs uppercase tracking-wide text-muted">
          {DEPARTMENT_NAMES[agent.department]} · {g.label}
        </Text>
        <Text className="mt-2 text-center text-base text-ink">{g.job}</Text>
        <Text className="mt-3 text-center text-sm text-muted">Arrástralo para girarlo. Tócalo para que salte.</Text>
        {owner ? (
          <View className="mt-6">
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
    </View>
  );
}
