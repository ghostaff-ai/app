import { LegendList } from '@legendapp/list/react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useMemo } from 'react';
import { Image, Platform, Text, View } from 'react-native';
import { decideAction, transcribe } from '@ghostaff/shared/services';
import { Composer, ReadOnlyComposer } from '@/components/chat/Composer';
import { MessageView } from '@/components/chat/Message';
import { Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { showAuthors } from '@/lib/chat';
import { useAgents } from '@/lib/hooks/useAgents';
import { useEngine } from '@/lib/hooks/useConnections';
import { useMembers, useMyLevels, useThread } from '@/lib/hooks/useChat';
import { KeyboardColumn } from '@/lib/keyboard';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { GHOSTS } from '@/lib/team';

// One thread of the team chat (team-chat.md, decisions 2, 3, 6 and 9): its
// messages live, newest at the bottom; a text box if the person may talk to
// the agent, «Solo lectura» if they may only see it.

export default function Conversacion() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const { head, messages, error, send } = useThread(id ?? null);
  const { items: agents } = useAgents(orgId);
  const { members } = useMembers(orgId);
  const { levels } = useMyLevels(orgId);
  const headerHeight = useHeaderHeight();
  const engine = useEngine();

  const me = session?.user.id;
  const agent = agents.find((a) => a.id === head?.agentId);
  const names = useMemo(() => [...agents.map((a) => a.name), ...members.filter((m) => m.userId !== me).map((m) => m.displayName)], [agents, members, me]);
  const authors = useMemo(() => showAuthors(messages), [messages]);
  const ghostOf = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.ghost])), [agents]);
  const owner = members.find((m) => m.role === 'owner' && m.userId !== me)?.displayName ?? null;
  const isOwner = active?.role === 'owner';
  // No engine, no mic.
  const dictate = useMemo(
    () => (engine && orgId ? (audio: Blob, mimeType: string) => transcribe(engine, orgId, audio, mimeType) : undefined),
    [engine, orgId],
  );
  // The card updates itself when the engine rewrites the message.
  const decide = useMemo(
    () => async (actionId: string, decision: 'approve' | 'reject') => {
      if (!engine) throw new Error('not signed in');
      await decideAction(engine, actionId, decision);
    },
    [engine],
  );

  if (head === undefined) return <Loading />;
  if (!head) return <Notice title="No encontramos esta conversación" body={error ?? 'Puede que ya no tengas acceso a este agente.'} />;
  const canTalk = levels[head.agentId] === 'talk';

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
            />
          )}
          estimatedItemSize={64}
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
          <Composer placeholder={agent ? `Escribe a ${agent.name}` : 'Escribe aquí'} names={names} onSend={send} onDictate={dictate} />
        ) : (
          <ReadOnlyComposer owner={owner} />
        )}
      </KeyboardColumn>
    </View>
  );
}
