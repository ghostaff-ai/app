import {
  ALL_WEEKDAYS,
  DAY_LETTER,
  DAY_NAMES,
  describeWhen,
  invalidWhen,
  type Routine,
  type RoutineAudience,
  type RoutineKind,
  type RoutineWhen,
  type Weekday,
} from '@ghostaff/shared';
import { createRoutine, deleteRoutine, listRoutines, setRoutinePaused, updateRoutine } from '@ghostaff/shared/services';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Button, ErrorText, Field, Loading, Notice, Segmented } from '@/components/ui';
import { useAgents } from '@/lib/hooks/useAgents';
import { selection } from '@/lib/haptics';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { parseClock, routineRefusal, titleFrom } from '@/lib/routines';
import { supabase } from '@/lib/supabase';

// A new routine, or one to change (agent-routines.md): what the agent will
// do, when, and, for an owner, whether its answer reaches only them or the
// whole team. What it says under «Cuándo» is what the agent will be held to.
// Changing it starts it again from now; pausing and deleting are here too.

export default function Rutina() {
  const { agent: agentId, id } = useLocalSearchParams<{ agent: string; id?: string }>();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const { items: agents, loading: agentsLoading } = useAgents(orgId);
  const [existing, setExisting] = useState<Routine | null | undefined>(id ? undefined : null);
  const [instruction, setInstruction] = useState('');
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<RoutineKind>('days');
  const [weekdays, setWeekdays] = useState<Weekday[]>([1, 2, 3, 4, 5]);
  const [monthDay, setMonthDay] = useState('1');
  const [time, setTime] = useState('9:00');
  const [audience, setAudience] = useState<RoutineAudience>('me');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!id || !orgId) return;
    listRoutines(supabase, orgId, agentId)
      .then((list) => {
        const r = list.find((x) => x.id === id) ?? null;
        setExisting(r);
        if (!r) return;
        setInstruction(r.instruction);
        setTitle(r.title);
        setKind(r.kind);
        setWeekdays(r.weekdays);
        setMonthDay(String(r.monthDay ?? 1));
        setTime(`${r.hour}:${String(r.minute).padStart(2, '0')}`);
        setAudience(r.audience);
      })
      .catch(() => setExisting(null));
  }, [id, orgId, agentId]);

  const agent = agents.find((a) => a.id === agentId);
  if ((!agent && agentsLoading) || existing === undefined) return <Loading />;
  if (!agent) return <Notice title="No encontramos este agente" />;
  if (id && !existing) return <Notice title="No encontramos esta rutina" body="Puede que la hayan borrado." />;

  const owner = active?.role === 'owner';
  const clock = parseClock(time);
  const day = Number(monthDay);
  const when: RoutineWhen | null = clock
    ? { kind, weekdays: kind === 'days' ? weekdays : [...ALL_WEEKDAYS], monthDay: kind === 'monthly' ? day : null, ...clock }
    : null;
  const whenProblem = !clock ? 'Escribe la hora así: 9:00.' : when ? invalidWhen(when) : null;
  const ready = !!instruction.trim() && !whenProblem && !busy;

  const toggleDay = (d: Weekday) => {
    selection();
    setWeekdays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort((a, b) => a - b)));
  };

  const save = async () => {
    if (!when || whenProblem) return;
    setBusy(true);
    setError(null);
    const input = { ...when, title: title.trim() || titleFrom(instruction), instruction: instruction.trim() };
    try {
      if (existing) await updateRoutine(supabase, existing.id, input);
      else await createRoutine(supabase, agent.id, audience, input);
      router.back();
    } catch (e) {
      setError(routineRefusal(e));
      setBusy(false);
    }
  };

  const pause = async () => {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      await setRoutinePaused(supabase, existing.id, !existing.paused);
      router.back();
    } catch (e) {
      setError(routineRefusal(e));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    setBusy(true);
    setError(null);
    try {
      await deleteRoutine(supabase, existing.id);
      router.back();
    } catch (e) {
      setError(routineRefusal(e));
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-16" keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: existing ? 'Rutina' : 'Nueva rutina' }} />
      <Field
        testID="routine-instruction"
        label={`Qué hará ${agent.name}`}
        hint="Como se lo escribirías en el chat."
        placeholder="Mándame el resumen de ventas de la semana"
        value={instruction}
        onChangeText={setInstruction}
        multiline
        maxLength={2000}
      />
      <Field
        testID="routine-title"
        label="Nombre"
        hint="Lo verás sobre cada respuesta. Si lo dejas vacío, se toma de lo que hará."
        placeholder={instruction.trim() ? titleFrom(instruction) : 'Resumen de ventas'}
        value={title}
        onChangeText={setTitle}
        maxLength={80}
      />

      <Text className="mt-6 text-footnote font-medium text-ink">Cuándo</Text>
      <View className="mt-2">
        <Segmented<RoutineKind>
          label="Cada cuánto"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'days', label: 'Unos días' },
            { value: 'monthly', label: 'Cada mes' },
          ]}
        />
      </View>
      {kind === 'days' ? (
        <View accessibilityLabel="Días de la semana" className="mt-3 flex-row flex-wrap gap-2">
          {ALL_WEEKDAYS.map((d) => {
            const on = weekdays.includes(d);
            return (
              <Pressable
                key={d}
                testID={`routine-day-${d}`}
                accessibilityRole="checkbox"
                accessibilityLabel={DAY_NAMES[d]}
                accessibilityState={{ checked: on }}
                onPress={() => toggleDay(d)}
                className={`h-11 w-11 items-center justify-center rounded-full ${on ? 'bg-accent' : 'bg-sunk active:opacity-70'}`}
              >
                <Text className={`text-[15px] ${on ? 'font-semibold text-on-accent' : 'text-ink'}`}>{DAY_LETTER[d]}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Field
          testID="routine-month-day"
          label="Día del mes"
          hint="Del 1 al 28, para que lo tengan todos los meses."
          value={monthDay}
          onChangeText={setMonthDay}
          keyboardType="number-pad"
          maxLength={2}
        />
      )}
      <Field testID="routine-time" label="Hora" placeholder="9:00" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" maxLength={5} />
      <Text testID="routine-when" className={`mt-2 text-footnote ${whenProblem ? 'text-no' : 'text-muted'}`}>
        {whenProblem ?? (when ? describeWhen(when) : '')}
      </Text>

      {owner && !existing ? (
        <>
          <Text className="mt-6 text-footnote font-medium text-ink">Para quién</Text>
          <View className="mt-2">
            <Segmented<RoutineAudience>
              label="Para quién"
              value={audience}
              onChange={setAudience}
              options={[
                { value: 'me', label: 'Solo para mí' },
                { value: 'team', label: 'Todo el equipo' },
              ]}
            />
          </View>
          <Text className="mt-2 text-footnote text-muted">
            {audience === 'me'
              ? `La respuesta te llega solo a ti, en tu chat con ${agent.name}.`
              : `La respuesta llega a todas las personas que ven a ${agent.name}.`}
          </Text>
        </>
      ) : null}

      <View className="mt-8">
        <Button testID="routine-save" label={existing ? 'Guardar cambios' : 'Guardar rutina'} onPress={() => void save()} disabled={!ready} busy={busy} />
      </View>
      {existing ? (
        <View className="mt-3 gap-3">
          <Button label={existing.paused ? 'Reanudar' : 'Pausar'} variant="secondary" onPress={() => void pause()} disabled={busy} />
          {confirming ? (
            <>
              <Button testID="routine-delete-confirm" label="Sí, borrar la rutina" variant="danger" onPress={() => void remove()} busy={busy} />
              <Button label="Cancelar" variant="plain" onPress={() => setConfirming(false)} />
            </>
          ) : (
            <Button testID="routine-delete" label="Borrar rutina" variant="plain" onPress={() => setConfirming(true)} disabled={busy} />
          )}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </ScrollView>
  );
}
