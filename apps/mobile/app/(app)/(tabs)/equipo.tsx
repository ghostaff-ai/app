import { DEPARTMENTS } from '@ghostaff/shared';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { MicButton } from '@/components/chat/MicButton';
import { ThreadRow } from '@/components/chat/ThreadRow';
import { Button, ErrorText, Loading } from '@/components/ui';
import { vacancies } from '@/lib/chat';
import { useAgents } from '@/lib/hooks/useAgents';
import { useThreads } from '@/lib/hooks/useChat';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useTabScreenTop } from '@/lib/tabs';
import { CORE_DEPARTMENTS, DEPARTMENT_NAMES, GHOSTS } from '@/lib/team';

// The organisation's team: its three departments and the agents in each, drawn
// as their ghosts, an orange dot on an agent with a message you haven't read.
// An owner sees each job nobody does yet as «Vacante · Redes»: a tap and it
// starts (team-chat.md, decision 8). «Conversaciones» lists every thread you
// may see, newest first (decision 10). The mic talks to Secretaría.

type View_ = 'equipo' | 'conversaciones';

export default function Equipo() {
  const { active } = useActiveOrg();
  const top = useTabScreenTop();
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
    <ScrollView className="flex-1 bg-surface" contentContainerStyle={{ padding: 16, paddingBottom: 64, paddingTop: 16 + top }} contentInsetAdjustmentBehavior="automatic">
      <View className="mb-4 flex-row items-center justify-between">
        <Text className="font-display text-2xl text-ink">Equipo</Text>
        <MicButton />
      </View>

      <View accessibilityRole="tablist" className="mb-5 flex-row self-start rounded-full border border-line bg-card p-0.5">
        {(['equipo', 'conversaciones'] as const).map((v) => {
          const on = v === view;
          return (
            <Pressable
              key={v}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onPress={() => setView(v)}
              className={`flex-row items-center rounded-full px-4 py-1.5 ${on ? 'bg-accent' : ''}`}
            >
              <Text className={`text-sm ${on ? 'font-semibold text-on-accent' : 'text-muted'}`}>{v === 'equipo' ? 'Equipo' : 'Conversaciones'}</Text>
              {v === 'conversaciones' && unreadCount > 0 ? (
                <View className="ml-1.5 rounded-full bg-waiting px-1.5">
                  <Text className="text-xs font-semibold text-white">{unreadCount}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {view === 'conversaciones' ? (
        threads.length === 0 ? (
          <View className="rounded-2xl border border-dashed border-line p-4">
            <Text className="text-sm text-muted">Aún no hay conversaciones. Abre un agente y empieza una, o toca el micrófono.</Text>
          </View>
        ) : (
          <View className="overflow-hidden rounded-2xl border border-line bg-card">
            {threads.map((t, i) => {
              const a = byId[t.agentId];
              return <ThreadRow key={t.id} thread={t} first={i === 0} ghost={a?.ghost} agentName={a?.name} onPress={() => router.push(`/conversacion/${t.id}`)} />;
            })}
          </View>
        )
      ) : (
        <>
          {DEPARTMENTS.map((d) => {
            const agents = items.filter((a) => a.department === d);
            const jobs = owner ? open.filter((g) => GHOSTS[g].department === d) : [];
            if (agents.length === 0 && jobs.length === 0 && !CORE_DEPARTMENTS.includes(d)) return null;
            return (
              <View key={d} className="mb-6">
                <Text className="mb-2 text-xs uppercase tracking-wide text-muted">{DEPARTMENT_NAMES[d]}</Text>
                {agents.length === 0 && jobs.length === 0 ? (
                  <View className="rounded-2xl border border-dashed border-line p-4">
                    <Text className="text-sm text-muted">Vacante</Text>
                  </View>
                ) : null}
                {agents.map((a) => (
                  <Pressable
                    key={a.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${a.name}${unreadBy.has(a.id) ? ', mensajes sin leer' : ''}`}
                    onPress={() => router.push(`/agente/${a.id}`)}
                    className="mb-3 flex-row items-center rounded-2xl border border-line bg-card p-3"
                  >
                    <Image source={GHOSTS[a.ghost].picture} style={{ width: 80, height: 80 }} resizeMode="contain" />
                    <View className="ml-3 flex-1">
                      <Text className="text-base font-semibold text-ink">{a.name}</Text>
                      <Text className="mt-1 text-sm text-muted" numberOfLines={2}>{a.description ?? GHOSTS[a.ghost].job}</Text>
                    </View>
                    {unreadBy.has(a.id) ? <View testID="agent-unread" className="ml-2 h-2.5 w-2.5 rounded-full bg-waiting" /> : null}
                  </Pressable>
                ))}
                {jobs.map((g) => (
                  <Pressable
                    key={g}
                    accessibilityRole="button"
                    accessibilityLabel={`Vacante: ${GHOSTS[g].label}. Toca para que empiece`}
                    onPress={() => router.push(`/contratar?ghost=${g}`)}
                    className="mb-3 flex-row items-center rounded-2xl border border-dashed border-line p-3"
                  >
                    <Image source={GHOSTS[g].picture} style={{ width: 56, height: 56, opacity: 0.45 }} resizeMode="contain" />
                    <View className="ml-3 flex-1">
                      <Text className="text-base font-semibold text-ink">Vacante · {GHOSTS[g].label}</Text>
                      <Text className="mt-0.5 text-sm text-muted">Toca para que empiece</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            );
          })}
          <ErrorText>{error}</ErrorText>
          {owner ? <Button label="Agente a medida" tone="plain" onPress={() => router.push('/nuevo-agente')} /> : null}
        </>
      )}
    </ScrollView>
  );
}
