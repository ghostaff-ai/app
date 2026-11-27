import type { Agent, ChatThread, OrgMember } from '@ghostaff/shared';
import { agentJob } from '@ghostaff/shared/services';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Avatar } from '@/components/chat/Message';
import { CaretRight, Icon, Plus } from '@/components/icons';
import { GhostStage } from '@/components/team/GhostStage';
import { agentLastLine, generalLastLine, shortTime } from '@/lib/chat';
import { DEPARTMENT_NAMES } from '@/lib/team';
import type { AgentTag } from '@/lib/team/status';
import { usePalette } from '@/lib/theme';

// The cards of Equipo on a phone (team-board.md, decision 2): General, the
// main agent, one tile per agent and «Contratar». Their test IDs are the ones
// the list had, which the end-to-end flows tap.

/** General: the people's chat, with their faces and the last thing said. */
export function GeneralCard({ thread, members }: { thread: ChatThread; members: OrgMember[] }) {
  const line = generalLastLine(thread);
  const faces = members.slice(0, 3);
  return (
    <Pressable
      testID="general"
      accessibilityRole="button"
      accessibilityLabel={`General${thread.unread ? ', mensajes sin leer' : ''}`}
      onPress={() => router.push('/general')}
      className="flex-row items-center rounded-3xl bg-card px-4 py-3.5 active:opacity-80"
    >
      <View className="flex-row">
        {faces.map((m, i) => (
          <View key={m.userId} style={{ marginLeft: i === 0 ? 0 : -12, borderRadius: 22, borderWidth: 3 }} className="border-card">
            <Avatar name={m.displayName} id={m.userId} size={38} />
          </View>
        ))}
      </View>
      <View className="ml-3 flex-1">
        <Text className="font-display-medium text-title3 text-ink">General</Text>
        <Text className={`text-footnote ${thread.unread ? 'text-ink' : 'text-muted'}`} numberOfLines={1}>
          {line ?? 'Habla con tu equipo, por audios'}
        </Text>
      </View>
      {line ? (
        <View className="ml-2 items-end">
          <Text className="text-caption text-muted">{shortTime(thread.lastMessageAt)}</Text>
          {thread.unread ? <View testID="general-unread" className="mt-1.5 h-2.5 w-2.5 rounded-full bg-waiting" /> : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * The main agent, wide: the one you talk to about anything, so a tap opens her
 * chat. Its line says what she has for you, else the last thing said in her
 * chat, else her job.
 */
export function LeadCard({ agent, tag, waiting, last }: { agent: Agent; tag: AgentTag; waiting: number; last: ChatThread | null }) {
  const c = usePalette();
  const line =
    waiting > 0 ? `Tiene ${waiting === 1 ? 'una cosa' : `${waiting} cosas`} para ti.` : (agentLastLine(agent.name, last) ?? agent.description ?? agentJob(agent));
  return (
    <Pressable
      testID={`agent-${agent.ghost}`}
      accessibilityRole="button"
      accessibilityLabel={`${agent.name}. ${line}`}
      onPress={() => router.push(`/chat/${agent.id}`)}
      className="active:opacity-90"
    >
      <GhostStage ghost={agent.ghost} department={agent.department} ghostSize={118} ghostX={0.74} ghostBottom={20} tag={tag} height={156}>
        <View style={{ position: 'absolute', left: 18, top: 18, bottom: 16, width: '52%' }}>
          <Text className="font-display text-title2 text-ink" numberOfLines={1}>
            {agent.name}
          </Text>
          <Text className="mt-1 text-footnote text-muted" numberOfLines={3}>
            {line}
          </Text>
          <View className="mt-auto flex-row items-center">
            <Text className="text-footnote font-semibold text-ink">Hablar</Text>
            <Icon icon={CaretRight} size={14} color={c.ink} weight="bold" />
          </View>
        </View>
      </GhostStage>
    </Pressable>
  );
}

/** One agent of the team: large, on its stage, with what it is doing above it. A tap opens its page. */
export function AgentTile({ agent, tag }: { agent: Agent; tag: AgentTag }) {
  return (
    <Pressable
      testID={`agent-${agent.ghost}`}
      accessibilityRole="button"
      accessibilityLabel={agent.name}
      onPress={() => router.push(`/agente/${agent.id}`)}
      className="flex-1 active:opacity-90"
    >
      <GhostStage ghost={agent.ghost} department={agent.department} ghostSize={100} ghostBottom={62} tag={tag} height={200}>
        <View style={{ position: 'absolute', left: 14, right: 14, bottom: 14 }}>
          <Text className="font-display-medium text-title3 text-ink" numberOfLines={1}>
            {agent.name}
          </Text>
          <Text className="text-footnote text-muted" numberOfLines={1}>
            {DEPARTMENT_NAMES[agent.department]}
          </Text>
        </View>
      </GhostStage>
    </Pressable>
  );
}

/** The last tile, for an owner: hire someone. */
export function HireTile() {
  const c = usePalette();
  return (
    <Pressable
      testID="add-agent"
      accessibilityRole="button"
      accessibilityLabel="Contratar un agente"
      onPress={() => router.push('/anadir-agente')}
      className="flex-1 items-center justify-center rounded-3xl border-[1.5px] border-dashed border-line active:opacity-80"
      style={{ height: 200 }}
    >
      <View className="h-14 w-14 items-center justify-center rounded-full bg-card">
        <Icon icon={Plus} size={22} color={c.ink} weight="bold" />
      </View>
      <Text className="mt-2.5 text-footnote font-medium text-muted">Contratar</Text>
    </Pressable>
  );
}
