import { createAgent } from '@ghostaff/shared/services';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Button, ErrorText, Notice } from '@/components/ui';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { DEPARTMENT_NAMES, GHOSTS, isGhostId } from '@/lib/team';

// A vacancy, tapped (team-chat.md, decision 8): the ghost, its one-line job and
// «Que empiece». Its name and department come from the job; both change later
// on its page. Today it joins the team and opens its page; once the engine
// talks, it will arrive with a first message of its own.

export default function Contratar() {
  const { ghost } = useLocalSearchParams<{ ghost: string }>();
  const { active } = useActiveOrg();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!active || !ghost || !isGhostId(ghost)) return <Notice title="No encontramos este puesto" />;
  if (active.role !== 'owner') return <Notice title="Solo quien es propietario de la empresa incorpora agentes" />;
  const g = GHOSTS[ghost];

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const a = await createAgent(supabase, { orgId: active.id, name: g.label, ghost, department: g.department });
      router.replace(`/agente/${a.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 items-center bg-surface px-8 pb-10 pt-8">
      <Image source={g.picture} style={{ width: 140, height: 140 }} resizeMode="contain" />
      <Text className="mt-2 text-xs uppercase tracking-wide text-muted">{DEPARTMENT_NAMES[g.department]}</Text>
      <Text className="mt-1 font-display text-2xl text-ink">{g.label}</Text>
      <Text className="mt-2 text-center text-base text-muted">{g.job}</Text>
      <View className="mt-8 w-full gap-3">
        <Button label="Que empiece" busy={busy} onPress={() => void start()} />
        <Button label="Ahora no" tone="plain" onPress={() => router.back()} />
      </View>
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
