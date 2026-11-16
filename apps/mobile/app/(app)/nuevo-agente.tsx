import { type Department, DEPARTMENTS } from '@ghostaff/shared';
import { createAgent } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, Chips, ErrorText, Field } from '@/components/ui';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { supabase } from '@/lib/supabase';
import { DEPARTMENT_NAMES, GHOST_ORDER, GHOSTS, type GhostId } from '@/lib/team';

// An owner adds an agent to the team: picks its ghost, and the name and
// department follow from it, both changeable. For now an agent is only how the
// team looks; its job comes later, with the engine.

const nameToDepartment = Object.fromEntries(DEPARTMENTS.map((d) => [DEPARTMENT_NAMES[d], d])) as Record<string, Department>;

export default function NuevoAgente() {
  const { active } = useActiveOrg();
  const [ghost, setGhost] = useState<GhostId | null>(null);
  const [name, setName] = useState('');
  const [department, setDepartment] = useState<Department | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!active) return null;

  const pick = (g: GhostId) => {
    // The name follows the ghost until the owner writes one of their own.
    if (!name.trim() || (ghost && name === GHOSTS[ghost].label)) setName(GHOSTS[g].label);
    setDepartment(GHOSTS[g].department);
    setGhost(g);
  };

  const save = async () => {
    if (!ghost || !department) return;
    setBusy(true);
    setError(null);
    try {
      await createAgent(supabase, { orgId: active.id, name, ghost, department });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-6 pt-2 pb-16" keyboardShouldPersistTaps="handled">
      <Text className="mt-2 text-sm font-semibold text-ink">Elige su fantasma</Text>
      <View className="mt-2 flex-row flex-wrap justify-between">
        {GHOST_ORDER.map((g) => {
          const on = g === ghost;
          return (
            <Pressable
              key={g}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={GHOSTS[g].label}
              onPress={() => pick(g)}
              className={`mb-3 w-[31%] items-center rounded-2xl border-2 bg-card p-2 ${on ? 'border-accent' : 'border-line'}`}
            >
              <Image source={GHOSTS[g].picture} style={{ width: 72, height: 72 }} resizeMode="contain" />
              <Text className="mt-1 text-xs text-ink">{GHOSTS[g].label}</Text>
            </Pressable>
          );
        })}
      </View>
      {ghost ? <Text className="text-sm text-muted">{GHOSTS[ghost].job}</Text> : null}
      <Field label="Nombre" placeholder="Por ejemplo, Lucía" maxLength={60} value={name} onChangeText={setName} />
      <Chips
        label="Departamento"
        options={DEPARTMENTS.map((d) => DEPARTMENT_NAMES[d])}
        value={department ? DEPARTMENT_NAMES[department] : null}
        onChange={(v) => setDepartment(v ? (nameToDepartment[v] ?? null) : null)}
      />
      <View className="mt-8">
        <Button label="Añadir al equipo" disabled={!ghost || !department || !name.trim()} busy={busy} onPress={() => void save()} />
      </View>
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
