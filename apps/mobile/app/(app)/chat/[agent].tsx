import { LegendList } from '@legendapp/list/react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useMemo } from 'react';
import { Image, Platform, Pressable, Text, View } from 'react-native';
import { shortNext, soonest } from '@ghostaff/shared';
import { decideAction } from '@ghostaff/shared/services';
import { Composer, ReadOnlyComposer } from '@/components/chat/Composer';
import { MessageView } from '@/components/chat/Message';
import { Clock, Icon } from '@/components/icons';
import { Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { showAuthors } from '@/lib/chat';
import { useAccountAsks } from '@/lib/hooks/useAccountAsks';
import { useAgents } from '@/lib/hooks/useAgents';
import { useGuideCards } from '@/lib/hooks/useGuideCards';
import { useEngine } from '@/lib/hooks/useConnections';
import { useAgentChat, useMembers, useMyLevels } from '@/lib/hooks/useChat';
import { useRoutines } from '@/lib/hooks/useRoutines';
import { KeyboardColumn } from '@/lib/keyboard';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { GHOSTS } from '@/lib/team';
import { usePalette } from '@/lib/theme';

// The person's one chat with an agent (three-tabs.md, decision 3), opened
// straight from its row in Equipo: one long conversation, as in WhatsApp, with
// what the agent did on its own in it too (decision 12). Only the person and
// the agent see it. The agent's name on top opens its page and settings
// (decision 6). The mic sends voice notes (voice.md), here only: no engine, no mic.
// The clock on the right is the agent's routines (agent-routines.md): an
// outline when the person has none with it, the next one's day and hour
// when they do; it opens them.

export default function Chat() {
  const { agent: agentId } = useLocalSearchParams<{ agent: string }>();
  const { session } = useAuth();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const { items: agents, loading: agentsLoading, reload: reloadAgents } = useAgents(orgId);
  const { members } = useMembers(orgId);
  const { levels, loading: levelsLoading } = useMyLevels(orgId);
  const { messages, loading, error, send, sendVoice, retryTranscript } = useAgentChat(orgId, agentId ?? null);
  const { items: routines, reload: reloadRoutines } = useRoutines(orgId, agentId ?? null);
  const palette = usePalette();
  const headerHeight = useHeaderHeight();
  const engine = useEngine();

  const me = session?.user.id;
  const agent = agents.find((a) => a.id === agentId);
  const names = useMemo(() => [...agents.map((a) => a.name), ...members.filter((m) => m.userId !== me).map((m) => m.displayName)], [agents, members, me]);
  const authors = useMemo(() => showAuthors(messages), [messages]);
  const ghostOf = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.ghost])), [agents]);
  const owner = members.find((m) => m.role === 'owner' && m.userId !== me)?.displayName ?? null;
  const isOwner = active?.role === 'owner';
  const owners = useMemo(() => members.filter((m) => m.role === 'owner').map((m) => m.displayName), [members]);
  const asks = useAccountAsks({ orgId, messages, agents, reloadAgents, owners, isOwner, returnPath: `chat/${agentId}` });
  const canTalk = !!agent && levels[agent.id] === 'talk';
  const guides = useGuideCards({ orgId, messages, isOwner, owners, canTalk, returnPath: `chat/${agentId}` });
  // The cards' state (asked for, going on) lives outside the messages: redraw them when it changes.
  const cardState = useMemo(() => ({ asks, guides }), [asks, guides]);
  // The card updates itself when the engine rewrites the message.
  const decide = useMemo(
    () => async (actionId: string, decision: 'approve' | 'reject') => {
      if (!engine) throw new Error('not signed in');
      await decideAction(engine, actionId, decision);
      // An approved routine shows on the clock at once.
      void reloadRoutines();
    },
    [engine, reloadRoutines],
  );
  const routineTitles = useMemo(() => Object.fromEntries(routines.map((r) => [r.id, r.title])), [routines]);
  const next = soonest(routines, new Date());

  if (!agent && (agentsLoading || levelsLoading)) return <Loading />;
  if (!agent) return <Notice title="No encontramos este agente" body="Puede que ya no esté en el equipo, o que no tengas acceso." />;
  const g = GHOSTS[agent.ghost];
  const showClock = agent.runner !== 'ordago_job' && (canTalk || routines.length > 0);
  const nextLabel = next ? shortNext(next, new Date(), next.timezone) : null;

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen
        options={{
          title: agent.name,
          headerTitle: () => (
            <Pressable
              testID="chat-agent"
              accessibilityRole="button"
              accessibilityLabel={agent.name}
              accessibilityHint={`Abre la ficha y los ajustes de ${agent.name}`}
              onPress={() => router.push(`/agente/${agent.id}`)}
              hitSlop={8}
              className="flex-row items-center active:opacity-60"
              style={{ maxWidth: 260 }}
            >
              <Image source={g.picture} style={{ width: 28, height: 28 }} resizeMode="contain" />
              <View className="ml-2 flex-shrink">
                <Text className="font-display text-base text-ink" numberOfLines={1}>
                  {agent.name}
                </Text>
                <Text className="text-caption text-muted" numberOfLines={1}>
                  {agent.name === g.label ? 'Toca para ver su ficha' : g.label}
                </Text>
              </View>
            </Pressable>
          ),
          headerRight: showClock
            ? () => (
                <Pressable
                  testID="chat-routines"
                  accessibilityRole="button"
                  accessibilityLabel={nextLabel ? `Rutinas. La próxima: ${nextLabel}` : 'Rutinas'}
                  accessibilityHint={`Lo que ${agent.name} hace solo, a su hora`}
                  onPress={() => router.push(`/rutinas/${agent.id}`)}
                  hitSlop={10}
                  className="min-h-11 flex-row items-center justify-center px-1 active:opacity-60"
                >
                  <Icon icon={Clock} size={22} color={nextLabel ? palette.ink : palette.muted} weight={nextLabel ? 'regular' : 'light'} />
                  {nextLabel ? <Text className="ml-1 text-footnote font-medium text-ink">{nextLabel}</Text> : null}
                </Pressable>
              )
            : undefined,
        }}
      />
      <KeyboardColumn offset={headerHeight}>
        {loading ? (
          <Loading />
        ) : messages.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Image source={g.picture} style={{ width: 120, height: 120 }} resizeMode="contain" />
            <Text className="mt-3 font-display text-title2 text-ink">{agent.name}</Text>
            <Text className="mt-1 text-center text-base text-muted">{g.job}</Text>
            <Text className="mt-6 text-center text-footnote text-muted">Esta conversación es solo entre tú y {agent.name}.</Text>
          </View>
        ) : (
          <LegendList
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item, index }) => (
              <MessageView
                message={item}
                mine={item.authorKind === 'person' && item.authorUserId === me}
                ghost={item.authorAgentId ? ghostOf[item.authorAgentId] : undefined}
                showAuthor={authors[index] ?? true}
                names={names}
                canDecide={isOwner}
                onDecide={decide}
                asks={asks}
                guides={guides}
                onRetryTranscript={retryTranscript}
                routineTitle={item.routineId ? routineTitles[item.routineId] : null}
                me={me}
              />
            )}
            estimatedItemSize={64}
            extraData={cardState}
            alignItemsAtEnd
            initialScrollAtEnd
            maintainScrollAtEnd
            maintainVisibleContentPosition
            // The web's list is a plain element that would print these as attributes.
            {...(Platform.OS === 'web' ? {} : { keyboardDismissMode: 'interactive' as const, keyboardShouldPersistTaps: 'handled' as const })}
            contentContainerStyle={{ paddingBottom: 16 }}
            style={{ flex: 1 }}
          />
        )}
        {error ? <Text className="px-4 pb-1 text-footnote text-no">{error}</Text> : null}
        {canTalk ? (
          <Composer placeholder={`Escribe a ${agent.name}`} names={names} onSend={send} onVoiceNote={engine ? sendVoice : undefined} />
        ) : (
          <ReadOnlyComposer note={owner ? `Pide acceso a ${owner}` : null} />
        )}
      </KeyboardColumn>
    </View>
  );
}
