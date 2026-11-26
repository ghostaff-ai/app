import { LegendList } from '@legendapp/list/react-native';
import { Stack, useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useMemo } from 'react';
import { Platform, Text, View } from 'react-native';
import { decideAction } from '@ghostaff/shared/services';
import { Composer } from '@/components/chat/Composer';
import { MessageView } from '@/components/chat/Message';
import { Icon, UsersThree } from '@/components/icons';
import { Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { agentIdsNamed, showAuthors } from '@/lib/chat';
import { useAccountAsks } from '@/lib/hooks/useAccountAsks';
import { useAgents } from '@/lib/hooks/useAgents';
import { useEngine } from '@/lib/hooks/useConnections';
import { useGeneralChat, useMembers, useMyLevels } from '@/lib/hooks/useChat';
import { useGuideCards } from '@/lib/hooks/useGuideCards';
import { KeyboardColumn } from '@/lib/keyboard';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { usePush } from '@/lib/push/PushProvider';
import { usePalette } from '@/lib/theme';

// General (docs/plans/ready/general-chat.md): the people's chat, one per
// organisation, where everyone in it talks to each other, mostly by voice
// notes, as in a WhatsApp group. The mic is the main button; with only
// «@Secretaría» in the box the note goes to her. Agents stay out unless a
// message @mentions one the writer may talk to; then it answers here, for
// everyone to read. Transcripts are folded: the audio is the message.

export default function General() {
  const { session } = useAuth();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const me = session?.user.id;
  const c = usePalette();
  const headerHeight = useHeaderHeight();
  const engine = useEngine();
  const { items: agents, reload: reloadAgents } = useAgents(orgId);
  const { members } = useMembers(orgId);
  const { levels } = useMyLevels(orgId);
  const { messages, loading, missing, error, send, sendVoice, retryTranscript } = useGeneralChat(orgId);

  // While General is on screen, its pushes aren't shown.
  const { setOnScreen } = usePush();
  useFocusEffect(
    useCallback(() => {
      setOnScreen('/general');
      return () => setOnScreen(null);
    }, [setOnScreen]),
  );

  // @ offers the agents the person may talk to, and the other people.
  const talkable = useMemo(() => agents.filter((a) => levels[a.id] === 'talk'), [agents, levels]);
  const names = useMemo(
    () => [...talkable.map((a) => a.name), ...members.filter((m) => m.userId !== me).map((m) => m.displayName)],
    [talkable, members, me],
  );
  // Every agent's name is drawn bold in the messages, also one the viewer can't call.
  const shown = useMemo(() => [...agents.map((a) => a.name), ...members.map((m) => m.displayName)], [agents, members]);
  const authors = useMemo(() => showAuthors(messages), [messages]);
  const ghostOf = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.ghost])), [agents]);
  const people = useMemo(() => members.map((m) => (m.userId === me ? 'Tú' : m.displayName)).join(', '), [members, me]);
  const isOwner = active?.role === 'owner';
  const owners = useMemo(() => members.filter((m) => m.role === 'owner').map((m) => m.displayName), [members]);
  const asks = useAccountAsks({ orgId, messages, agents, reloadAgents, owners, isOwner, returnPath: 'general' });
  const guides = useGuideCards({ messages, isOwner, owners, canTalk: true });
  const cardState = useMemo(() => ({ asks, guides }), [asks, guides]);
  const decide = useMemo(
    () => async (actionId: string, decision: 'approve' | 'reject') => {
      if (!engine) throw new Error('not signed in');
      await decideAction(engine, actionId, decision);
    },
    [engine],
  );

  if (loading) return <Loading />;
  if (missing) return <Notice title="No encontramos el chat General" body="Vuelve a Equipo y ábrelo de nuevo." />;

  return (
    <View className="flex-1 bg-surface">
      <Stack.Screen
        options={{
          title: 'General',
          headerTitle: () => (
            <View testID="general-header" className="flex-row items-center" style={{ maxWidth: 260 }}>
              <View className="h-7 w-7 items-center justify-center rounded-full bg-accent">
                <Icon icon={UsersThree} size={16} color={c.onAccent} weight="bold" />
              </View>
              <View className="ml-2 flex-shrink">
                <Text className="font-display text-base text-ink" numberOfLines={1}>
                  General
                </Text>
                <Text className="text-caption text-muted" numberOfLines={1}>
                  {people}
                </Text>
              </View>
            </View>
          ),
        }}
      />
      <KeyboardColumn offset={headerHeight}>
        {messages.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="font-display text-title2 text-ink">Habla con tu equipo</Text>
            <Text className="mt-2 text-center text-base text-muted">
              Mándale un audio a quien está en {active?.name ?? 'la empresa'}. Los agentes no contestan aquí, salvo que los menciones con @, pero cada día leen lo que habláis.
            </Text>
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
                names={shown}
                canDecide={isOwner}
                onDecide={decide}
                asks={asks}
                guides={guides}
                onRetryTranscript={retryTranscript}
                me={me}
                foldTranscripts
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
        <Composer
          placeholder="Mensaje"
          names={names}
          onSend={send}
          onVoiceNote={engine ? (note, tagged) => sendVoice(note, agentIdsNamed(talkable, tagged)) : undefined}
        />
      </KeyboardColumn>
    </View>
  );
}
