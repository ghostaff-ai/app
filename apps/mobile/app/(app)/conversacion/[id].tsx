import { LegendList } from '@legendapp/list/react-native';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useMemo } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { decideAction } from '@ghostaff/shared/services';
import { Audience } from '@/components/chat/Audience';
import { Composer, ReadOnlyComposer } from '@/components/chat/Composer';
import { MessageView } from '@/components/chat/Message';
import { Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { canWriteIn, readOnlyNote, showAuthors } from '@/lib/chat';
import { useAccountAsks } from '@/lib/hooks/useAccountAsks';
import { useAgents } from '@/lib/hooks/useAgents';
import { useGuideCards } from '@/lib/hooks/useGuideCards';
import { useEngine } from '@/lib/hooks/useConnections';
import { useMembers, useMyLevels, useReaders, useThread } from '@/lib/hooks/useChat';
import { KeyboardColumn } from '@/lib/keyboard';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { GHOSTS } from '@/lib/team';

// One titled conversation with an agent (team-chat.md, decisions 3, 6 and 9;
// chat-permissions.md): its messages live, newest at the bottom; under the
// header who sees it, which its opener can change; a text box if the person
// may write in it, else «Solo lectura» and why.

export default function Conversacion() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const { head, messages, error, send, reloadHead } = useThread(id ?? null);
  const { readers, reload: reloadReaders } = useReaders(id ?? null, head?.visibility);
  const { items: agents, reload: reloadAgents } = useAgents(orgId);
  const { members } = useMembers(orgId);
  const { levels } = useMyLevels(orgId);
  const headerHeight = useHeaderHeight();
  const engine = useEngine();
  // Back from changing who sees it.
  useFocusEffect(
    useCallback(() => {
      void reloadHead();
      void reloadReaders();
    }, [reloadHead, reloadReaders]),
  );

  const me = session?.user.id;
  const agent = agents.find((a) => a.id === head?.agentId);
  const names = useMemo(() => [...agents.map((a) => a.name), ...members.filter((m) => m.userId !== me).map((m) => m.displayName)], [agents, members, me]);
  const authors = useMemo(() => showAuthors(messages), [messages]);
  const ghostOf = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.ghost])), [agents]);
  const owner = members.find((m) => m.role === 'owner' && m.userId !== me)?.displayName ?? null;
  const isOwner = active?.role === 'owner';
  const owners = useMemo(() => members.filter((m) => m.role === 'owner').map((m) => m.displayName), [members]);
  const asks = useAccountAsks({ orgId, messages, agents, reloadAgents, owners, isOwner, returnPath: `conversacion/${id}` });
  const mine = !!head && (head.personal || head.createdBy === me);
  const level = head ? levels[head.agentId] : undefined;
  const canTalk = !!head && canWriteIn({ visibility: head.visibility, mine }, level);
  const guides = useGuideCards({ orgId, messages, isOwner, owners, canTalk, returnPath: `conversacion/${id}` });
  // The cards' state (asked for, going on) lives outside the messages: redraw them when it changes.
  const cardState = useMemo(() => ({ asks, guides }), [asks, guides]);
  // The card updates itself when the engine rewrites the message.
  const decide = useMemo(
    () => async (actionId: string, decision: 'approve' | 'reject') => {
      if (!engine) throw new Error('not signed in');
      await decideAction(engine, actionId, decision);
    },
    [engine],
  );

  if (head === undefined) return <Loading />;
  if (!head) return <Notice title="No encontramos esta conversación" body="Puede que ya no tengas acceso: quien la abrió la ha hecho privada, o ya no puedes ver a este agente." />;
  const opener = members.find((m) => m.userId === head.createdBy)?.displayName ?? null;
  const showAudience = !head.personal && agent;

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen
        options={{
          title: head.title,
          headerTitle: () => (
            <View className="flex-row items-center" style={{ maxWidth: 260 }}>
              {agent ? <Image source={GHOSTS[agent.ghost].picture} style={{ width: 26, height: 26 }} resizeMode="contain" /> : null}
              <View className="ml-2 flex-shrink">
                <Text className="font-display text-base text-ink" numberOfLines={1}>
                  {head.title}
                </Text>
                {agent ? <Text className="text-caption text-muted">{agent.name}</Text> : null}
              </View>
            </View>
          ),
        }}
      />
      <KeyboardColumn offset={headerHeight}>
        {showAudience ? (
          <Audience
            visibility={head.visibility}
            agentName={agent.name}
            readers={readers}
            onPress={mine ? () => router.push(`/visibilidad/${head.id}`) : undefined}
          />
        ) : null}
        <LegendList
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={({ item, index }) => (
            <MessageView
              me={me}
              message={item}
              mine={item.authorKind === 'person' && item.authorUserId === me}
              ghost={item.authorAgentId ? ghostOf[item.authorAgentId] : undefined}
              showAuthor={authors[index] ?? true}
              names={names}
              canDecide={isOwner}
              onDecide={decide}
              asks={asks}
              guides={guides}
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
        {error ? <Text className="px-4 pb-1 text-footnote text-no">{error}</Text> : null}
        {canTalk ? (
          <Composer placeholder={agent ? `Escribe a ${agent.name}` : 'Escribe aquí'} names={names} onSend={send} />
        ) : (
          <ReadOnlyComposer note={readOnlyNote(level, opener, owner)} />
        )}
      </KeyboardColumn>
    </View>
  );
}
