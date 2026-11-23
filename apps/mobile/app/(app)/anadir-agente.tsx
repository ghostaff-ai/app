import { DEPARTMENTS } from '@ghostaff/shared';
import { router } from 'expo-router';
import { Image, ScrollView, Text, View } from 'react-native';
import { PencilSimple } from '@/components/icons';
import { ListRow, ListSection, Loading, Notice, RowIcon } from '@/components/ui';
import { vacancies } from '@/lib/chat';
import { useAgents } from '@/lib/hooks/useAgents';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';

// «Añadir agente», from the last row of Equipo (three-tabs.md, decision 5):
// the jobs nobody does yet, by department, each opening «Que empiece»
// (team-chat.md, decision 8), and a custom agent at the end. Owners only.

export default function AnadirAgente() {
  const { active } = useActiveOrg();
  const { items, loading } = useAgents(active?.id ?? null);
  if (!active) return null;
  if (active.role !== 'owner') return <Notice title="Solo quien es propietario de la empresa incorpora agentes" />;
  if (loading && items.length === 0) return <Loading />;
  const open = vacancies(items);

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="px-5 pb-12" contentInsetAdjustmentBehavior="automatic">
      {open.length === 0 ? <Text className="mt-6 px-1 text-base text-muted">Ya tienes a todo el equipo de partida. Puedes crear uno a medida.</Text> : null}
      {DEPARTMENTS.map((d) => {
        const jobs = open.filter((g) => GHOSTS[g].department === d);
        if (jobs.length === 0) return null;
        return (
          <ListSection key={d} header={DEPARTMENT_NAMES[d]}>
            {jobs.map((g) => (
              <ListRow
                key={g}
                testID={`vacancy-${g}`}
                accessibilityLabel={`${GHOSTS[g].label}. Incorporar`}
                leading={<Image source={GHOSTS[g].picture} style={{ width: 48, height: 48 }} resizeMode="contain" />}
                title={GHOSTS[g].label}
                subtitle={GHOSTS[g].job}
                chevron
                onPress={() => router.push(`/contratar?ghost=${g}`)}
              />
            ))}
          </ListSection>
        );
      })}
      <ListSection footer="Descríbele el trabajo y elige su fantasma.">
        <ListRow leading={<RowIcon icon={PencilSimple} />} title="Agente a medida" chevron onPress={() => router.push('/nuevo-agente')} />
      </ListSection>
      <View className="h-4" />
    </ScrollView>
  );
}
