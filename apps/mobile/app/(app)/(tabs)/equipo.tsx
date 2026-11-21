import { DEPARTMENTS } from '@ghostaff/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { MicButton } from '@/components/chat/MicButton';
import { ThreadRow } from '@/components/chat/ThreadRow';
import { ChatsCircle, PencilSimple } from '@/components/icons';
import { EmptyState, ErrorText, ListRow, ListSection, Loading, RowIcon, ScreenTitle, Segmented } from '@/components/ui';
import { vacancies } from '@/lib/chat';
import { useAgents } from '@/lib/hooks/useAgents';
import { useThreads } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useTabScreenTop } from '@/lib/tabs';
import { CORE_DEPARTMENTS, DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';

// The organisation's team: its three departments and the agents in each, drawn
// as their ghosts, an orange dot on an agent with a message you haven't read.
// An owner sees each job nobody does yet as a faded ghost with «Contratar»: a
// tap and it starts (team-chat.md, decision 8). «Conversaciones» lists every
// thread you may see, newest first (decision 10). The mic talks to Secretaría.

type View_ = 'equipo' | 'conversaciones';

export default function Equipo() {
  const { active } = useActiveOrg();
  const top = useTabScreenTop();
  const desktop = useIsDesktop();
  const orgId = active?.id ?? null;
  const { items, loading, error, reload } = useAgents(orgId);
  const { threads, reload: reloadThreads } = useThreads(orgId);
  const [view, setView] = useState<View_>('equipo');
  useFocusEffect(
    useCallback(() => {
      void reload();
      void reloadThreads();
    }, [reload, reloadThreads]),
  );
  if (!active) return null;
  if (loading && items.length === 0) return <Loading />;
  const owner = active.role === 'owner';
  const unreadBy = new Set(threads.filter((t) => t.unread).map((t) => t.agentId));
  const unreadCount = threads.filter((t) => t.unread).length;
  const open = vacancies(items);
  const byId = Object.fromEntries(items.map((a) => [a.id, a]));

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{
        paddingHorizontal: desktop ? 40 : 20,
        paddingBottom: 64,
        paddingTop: (desktop ? 40 : 12) + top,
        maxWidth: DESKTOP_CONTENT_MAX_WIDTH,
        width: '100%',
        alignSelf: 'center',
      }}
      contentInsetAdjustmentBehavior="automatic"
    >
      {/* On a desktop the mic is in the sidebar. */}
      <ScreenTitle right={desktop ? undefined : <MicButton />}>Equipo</ScreenTitle>
      <View className="mt-2">
        <Segmented
          label="Ver"
          value={view}
          onChange={setView}
          options={[
            { value: 'equipo', label: 'Agentes' },
            { value: 'conversaciones', label: 'Conversaciones', badge: unreadCount },
          ]}
        />
      </View>

      {view === 'conversaciones' ? (
        threads.length === 0 ? (
          <EmptyState icon={ChatsCircle} title="Aún no hay conversaciones" body="Abre un agente y escríbele, o toca el micrófono para hablar con Secretaría." />
        ) : (
          <ListSection>
            {threads.map((t) => {
              const a = byId[t.agentId];
              return <ThreadRow key={t.id} thread={t} ghost={a?.ghost} agentName={a?.name} onPress={() => router.push(`/conversacion/${t.id}`)} />;
            })}
          </ListSection>
        )
      ) : (
        <>
          {DEPARTMENTS.map((d) => {
            const agents = items.filter((a) => a.department === d);
            const jobs = owner ? open.filter((g) => GHOSTS[g].department === d) : [];
            if (agents.length === 0 && jobs.length === 0 && !CORE_DEPARTMENTS.includes(d)) return null;
            return (
              <ListSection key={d} header={DEPARTMENT_NAMES[d]}>
                {agents.length === 0 && jobs.length === 0 ? <ListRow title="Nadie todavía" subtitle="Quien es propietario de la empresa incorpora a sus agentes." /> : null}
                {agents.map((a) => (
                  <ListRow
                    key={a.id}
                    accessibilityLabel={`${a.name}${unreadBy.has(a.id) ? ', mensajes sin leer' : ''}`}
                    leading={<Image source={GHOSTS[a.ghost].picture} style={{ width: 52, height: 52 }} resizeMode="contain" />}
                    title={a.name}
                    subtitle={a.description ?? GHOSTS[a.ghost].job}
                    trailing={unreadBy.has(a.id) ? <View testID="agent-unread" className="h-2.5 w-2.5 rounded-full bg-waiting" /> : undefined}
                    chevron
                    onPress={() => router.push(`/agente/${a.id}`)}
                  />
                ))}
                {jobs.map((g) => (
                  <ListRow
                    key={g}
                    testID={`vacancy-${g}`}
                    accessibilityLabel={`Vacante: ${GHOSTS[g].label}. Contratar`}
                    leading={<Image source={GHOSTS[g].picture} style={{ width: 52, height: 52, opacity: 0.35 }} resizeMode="contain" />}
                    title={GHOSTS[g].label}
                    subtitle="Vacante"
                    trailing={
                      <View className="rounded-full bg-sunk px-3.5 py-1.5">
                        <Text className="text-[14px] font-semibold text-ink">Contratar</Text>
                      </View>
                    }
                    onPress={() => router.push(`/contratar?ghost=${g}`)}
                  />
                ))}
              </ListSection>
            );
          })}
          <ErrorText>{error}</ErrorText>
          {owner ? (
            <ListSection footer="Descríbele el trabajo y elige su fantasma.">
              <ListRow leading={<RowIcon icon={PencilSimple} />} title="Agente a medida" chevron onPress={() => router.push('/nuevo-agente')} />
            </ListSection>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
