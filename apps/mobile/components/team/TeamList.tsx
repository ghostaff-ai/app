import { agentJob } from '@ghostaff/shared/services';
import { router, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Icon, Plus, UsersThree, WarningCircle } from '@/components/icons';
import { SpaceSwitcher } from '@/components/SpaceSwitcher';
import { EmptyState, ErrorText, ListRow, ListSection, Loading, RowIcon, ScreenTitle } from '@/components/ui';
import { agentLastLine, generalChat, generalLastLine, shortTime, teamRows } from '@/lib/chat';
import { useTeam } from '@/lib/hooks/useTeam';
import { DESKTOP_CONTENT_MAX_WIDTH, desktopSection, useIsDesktop, useReplacesBeside } from '@/lib/layout';
import { useTabScreenTop } from '@/lib/tabs';
import { GHOSTS } from '@/lib/team';
import { usePalette } from '@/lib/theme';

// Equipo's list (three-tabs.md, decisions 2 and 4): one row per agent, as in
// WhatsApp, Secretaría first and then whoever spoke last, with its last word
// and an orange dot while it waits unread. A tap opens its chat, everyone's
// with it (group-chat-per-agent.md). An owner adds agents from the last row
// (decision 5). Above them all, once there are two people, General: the
// people's chat, where they talk to each other by voice (general-chat.md).
// On a desktop it is the column beside the open chat
// (docs/plans/ongoing/desktop-web.md), with that chat's row marked; on a
// phone Equipo is the board of ghosts instead (TeamBoard, team-board.md).

export function TeamList() {
  const top = useTabScreenTop();
  const desktop = useIsDesktop();
  const path = usePathname();
  const replace = useReplacesBeside();
  const c = usePalette();
  const { active, agents, threads, members, noAi, owner, reload, reloadThreads } = useTeam();
  // Beside a chat the list stays mounted: read the last words and unread dots
  // again when another chat opens (reading one clears its dot).
  useEffect(() => {
    if (desktop) void reloadThreads();
  }, [desktop, path, reloadThreads]);
  if (!active) return null;
  if (agents.loading && agents.items.length === 0) return <Loading />;
  const rows = teamRows(agents.items, threads);
  const general = generalChat(threads, members.length);
  const section = desktopSection(path);
  const open = desktop && section.list === 'team' ? section.open : null;

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={
        desktop
          ? { paddingHorizontal: 16, paddingBottom: 40, paddingTop: top }
          : { paddingHorizontal: 20, paddingBottom: 64, paddingTop: 12 + top, maxWidth: DESKTOP_CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' }
      }
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
    >
      {/* Where you are, on every tab (welcome-and-spaces.md); on a desktop the sidebar shows it. */}
      <SpaceSwitcher />
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

      {general ? (
        <ListSection>
          <ListRow
            testID="general"
            accessibilityLabel={`General${general.unread ? ', mensajes sin leer' : ''}`}
            leading={
              <View className="h-12 w-12 items-center justify-center rounded-full bg-accent">
                <Icon icon={UsersThree} size={24} color={c.onAccent} weight="bold" />
              </View>
            }
            title="General"
            subtitle={generalLastLine(general) ?? 'Habla con tu equipo, por audios'}
            emphasis={general.unread}
            trailing={
              general.lastText !== null || general.lastVoiceMs !== null ? (
                <View className="items-end">
                  <Text className="text-caption text-muted">{shortTime(general.lastMessageAt)}</Text>
                  {general.unread ? <View testID="general-unread" className="mt-1.5 h-2.5 w-2.5 rounded-full bg-waiting" /> : null}
                </View>
              ) : undefined
            }
            selected={desktop ? open === 'general' : undefined}
            href="/general"
            replace={replace}
          />
        </ListSection>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={UsersThree}
          title="Aún no hay nadie en el equipo"
          body={owner ? 'Añade tu primer agente y empezará a trabajar contigo.' : 'Quien es propietario de la empresa incorpora a los agentes.'}
        />
      ) : (
        <ListSection>
          {rows.map(({ agent: a, last, unread }) => {
            const said = agentLastLine(a.name, last);
            const trailing = last ? (
              <View className="items-end">
                <Text className="text-caption text-muted">{shortTime(last.lastMessageAt)}</Text>
                {unread ? <View testID="agent-unread" className="mt-1.5 h-2.5 w-2.5 rounded-full bg-waiting" /> : null}
              </View>
            ) : undefined;
            const ghost = <Image source={GHOSTS[a.ghost].picture} style={{ width: 48, height: 48 }} resizeMode="contain" />;
            return (
              <ListRow
                key={a.id}
                testID={`agent-${a.ghost}`}
                accessibilityLabel={`${a.name}${unread ? ', mensajes sin leer' : ''}`}
                leading={ghost}
                title={a.name}
                subtitle={said ?? a.description ?? agentJob(a)}
                emphasis={unread}
                trailing={trailing}
                selected={desktop ? open === a.id : undefined}
                href={`/chat/${a.id}`}
                replace={replace}
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
