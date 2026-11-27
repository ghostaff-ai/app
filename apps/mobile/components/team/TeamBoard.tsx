import type { Agent } from '@ghostaff/shared';
import { isMainAgent } from '@ghostaff/shared/services';
import { Fragment } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { Icon, UsersThree, WarningCircle } from '@/components/icons';
import { SpaceSwitcher } from '@/components/SpaceSwitcher';
import { AgentTile, GeneralCard, HireTile, LeadCard } from '@/components/team/TeamCards';
import { EmptyState, ErrorText, Loading, ScreenTitle } from '@/components/ui';
import { generalChat, teamRows } from '@/lib/chat';
import { useTeam } from '@/lib/hooks/useTeam';
import { DESKTOP_CONTENT_MAX_WIDTH } from '@/lib/layout';
import { useTabScreenTop } from '@/lib/tabs';
import { agentTag, waitingByAgent } from '@/lib/team/status';
import { usePalette } from '@/lib/theme';

// Equipo on a phone (team-board.md, decision 2): General first, then the main
// agent wide, then the others large, two to a row, each with what it is doing
// above its head, and «Contratar» last for an owner. On a desktop Equipo is
// the list beside the open chat instead (TeamList).

type Cell = { kind: 'agent'; agent: Agent } | { kind: 'hire' };

/** The cells two to a row; a lone last one keeps its half. */
function pairs(cells: Cell[]): Cell[][] {
  const out: Cell[][] = [];
  for (let i = 0; i < cells.length; i += 2) out.push(cells.slice(i, i + 2));
  return out;
}

export function TeamBoard() {
  const top = useTabScreenTop();
  const c = usePalette();
  const team = useTeam({ withStatus: true });
  const { active, agents, threads, members, decisions, working, noAi, owner, reload } = team;
  if (!active) return null;
  if (agents.loading && agents.items.length === 0) return <Loading />;

  const rows = teamRows(agents.items, threads);
  const general = generalChat(threads, members.length);
  const waiting = waitingByAgent(decisions);
  const tagOf = (a: Agent, unread: boolean) => agentTag({ waiting: waiting[a.id] ?? 0, working: working.has(a.id), unread });
  const lead = rows.find((r) => isMainAgent(r.agent)) ?? null;
  const rest = rows.filter((r) => r !== lead);
  const unread = new Map(rows.map((r) => [r.agent.id, r.unread]));
  const cells: Cell[] = [...rest.map((r) => ({ kind: 'agent' as const, agent: r.agent })), ...(owner ? [{ kind: 'hire' as const }] : [])];

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96, paddingTop: 12 + top, maxWidth: DESKTOP_CONTENT_MAX_WIDTH, width: '100%', alignSelf: 'center' }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
    >
      <View className="px-1">
        <SpaceSwitcher />
        <ScreenTitle>Equipo</ScreenTitle>
      </View>

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

      <View className="mt-4 gap-3">
        {general ? <GeneralCard thread={general} members={members} /> : null}
        {lead ? <LeadCard agent={lead.agent} tag={tagOf(lead.agent, lead.unread)} waiting={waiting[lead.agent.id] ?? 0} last={lead.last} /> : null}
      </View>

      {rows.length === 0 && !owner ? (
        <EmptyState icon={UsersThree} title="Aún no hay nadie en el equipo" body="Quien es propietario de la empresa incorpora a los agentes." />
      ) : null}

      {cells.length > 0 ? (
        <Fragment>
          {rest.length > 0 ? (
            <View className="mb-2.5 mt-6 flex-row justify-between px-1.5">
              <Text className="text-footnote text-muted">Agentes</Text>
              <Text className="text-footnote text-muted">{rest.length}</Text>
            </View>
          ) : (
            <View className="mt-3" />
          )}
          <View className="gap-2.5">
            {pairs(cells).map((pair, i) => (
              <View key={i} className="flex-row gap-2.5">
                {pair.map((cell) =>
                  cell.kind === 'hire' ? <HireTile key="hire" /> : <AgentTile key={cell.agent.id} agent={cell.agent} tag={tagOf(cell.agent, unread.get(cell.agent.id) ?? false)} />,
                )}
                {pair.length === 1 ? <View className="flex-1" /> : null}
              </View>
            ))}
          </View>
        </Fragment>
      ) : null}
      <ErrorText>{agents.error}</ErrorText>
    </ScrollView>
  );
}
