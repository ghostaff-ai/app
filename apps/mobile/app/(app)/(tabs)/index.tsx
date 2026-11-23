import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Icon, Plus, UsersThree, WarningCircle } from '@/components/icons';
import { EmptyState, ErrorText, ListRow, ListSection, Loading, RowIcon, ScreenTitle } from '@/components/ui';
import { shortTime, teamRows, visibilityTag } from '@/lib/chat';
import { canRunAgents } from '@/lib/connections';
import { useAgents } from '@/lib/hooks/useAgents';
import { useThreads } from '@/lib/hooks/useChat';
import { useConnections } from '@/lib/hooks/useConnections';
import { DESKTOP_CONTENT_MAX_WIDTH, useIsDesktop } from '@/lib/layout';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { useTabScreenTop } from '@/lib/tabs';
import { GHOSTS } from '@/lib/team';
import { usePalette } from '@/lib/theme';

// Equipo, the first tab (three-tabs.md, decisions 2 and 4): one row per agent,
// as in WhatsApp, Secretaría first and then whoever spoke last, with its last
// word and an orange dot while it waits unread. A tap opens the chat with it
// (decision 3). Titled conversations the person follows sit among them, like
// groups (chat-permissions.md, decision 3). An owner adds agents from the last
// row (decision 5).

export default function Equipo() {
  const { active } = useActiveOrg();
  const top = useTabScreenTop();
  const desktop = useIsDesktop();
  const c = usePalette();
  const orgId = active?.id ?? null;
  const agents = useAgents(orgId);
  const { threads, reload: reloadThreads } = useThreads(orgId);
  const connections = useConnections(orgId);
  const { reload: reloadAgents } = agents;
  const { reload: reloadConnections } = connections;
  useFocusEffect(
    useCallback(() => {
      void reloadAgents();
      void reloadThreads();
      void reloadConnections();
    }, [reloadAgents, reloadThreads, reloadConnections]),
  );
  if (!active) return null;
  if (agents.loading && agents.items.length === 0) return <Loading />;
  const owner = active.role === 'owner';
  // An owner never gets here without an AI account (the layout's gate); a member can't connect one.
  const noAi = connections.loaded && !connections.error && !canRunAgents(connections.items);
  const rows = teamRows(agents.items, threads);

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
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={() => {
            void reloadAgents();
            void reloadThreads();
          }}
        />
      }
    >
      <ScreenTitle>Equipo</ScreenTitle>
      {noAi ? (
        <View testID="no-ai" className="mt-4 flex-row items-start rounded-2xl bg-card px-4 py-3.5">
          <View className="mt-0.5">
            <Icon icon={WarningCircle} size={20} color={c.waiting} />
          </View>
          <View className="ml-2.5 flex-1">
            <Text className="text-base font-semibold text-ink">Tu equipo aún no puede trabajar</Text>
            <Text className="mt-1 text-footnote text-muted">
              Falta que quien es propietario de {active.name} conecte una cuenta de IA, en Empresa, Conexiones.
            </Text>
          </View>
        </View>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={UsersThree}
          title="Aún no hay nadie en el equipo"
          body={owner ? 'Añade tu primer agente y empezará a trabajar contigo.' : 'Quien es propietario de la empresa incorpora a los agentes.'}
        />
      ) : (
        <ListSection>
          {rows.map((row) => {
            const { agent: a, last, unread } = row;
            const said = last?.lastText ? (last.lastAuthor && last.lastAuthor !== a.name ? `${last.lastAuthor}: ${last.lastText}` : last.lastText) : null;
            const trailing = last ? (
              <View className="items-end">
                <Text className="text-caption text-muted">{shortTime(last.lastMessageAt)}</Text>
                {unread ? <View testID="agent-unread" className="mt-1.5 h-2.5 w-2.5 rounded-full bg-waiting" /> : null}
              </View>
            ) : undefined;
            const ghost = <Image source={GHOSTS[a.ghost].picture} style={{ width: 48, height: 48 }} resizeMode="contain" />;
            if (row.kind === 'conversation') {
              const tag = active.kind === 'personal' ? a.name : `${a.name} · ${visibilityTag(row.last.visibility)}`;
              return (
                <ListRow
                  key={row.last.id}
                  testID={`conversation-${row.last.id}`}
                  accessibilityLabel={`${row.last.title}, con ${a.name}${unread ? ', mensajes sin leer' : ''}`}
                  leading={ghost}
                  title={row.last.title}
                  subtitle={said ? `${tag}. ${said}` : tag}
                  emphasis={unread}
                  trailing={trailing}
                  onPress={() => router.push(`/conversacion/${row.last.id}`)}
                />
              );
            }
            return (
              <ListRow
                key={a.id}
                testID={`agent-${a.ghost}`}
                accessibilityLabel={`${a.name}${unread ? ', mensajes sin leer' : ''}`}
                leading={ghost}
                title={a.name}
                subtitle={said ?? a.description ?? GHOSTS[a.ghost].job}
                emphasis={unread}
                trailing={trailing}
                onPress={() => router.push(`/chat/${a.id}`)}
              />
            );
          })}
        </ListSection>
      )}
      <ErrorText>{agents.error}</ErrorText>

      {owner ? (
        <ListSection>
          <ListRow testID="add-agent" leading={<RowIcon icon={Plus} />} title="Añadir agente" chevron onPress={() => router.push('/anadir-agente')} />
        </ListSection>
      ) : null}
    </ScrollView>
  );
}
