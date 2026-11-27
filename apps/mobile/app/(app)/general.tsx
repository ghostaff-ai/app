import { router, Stack, useFocusEffect } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { decideAction, isMainAgent } from '@ghostaff/shared/services';
import { GroupFace } from '@/components/chat/GroupFace';
import { Wallpaper } from '@/components/chat/Wallpaper';
import { ChatList } from '@/components/chat/ChatList';
import { Composer } from '@/components/chat/Composer';
import { MessageView } from '@/components/chat/Message';
import { FolderSimple, Icon, MagnifyingGlass } from '@/components/icons';
import { Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { ChatSearch } from '@/components/chat/ChatSearch';
import { agentIdsNamed, groupSubtitle, typingLine } from '@/lib/chat';
import { useAccountAsks } from '@/lib/hooks/useAccountAsks';
import { useAgents } from '@/lib/hooks/useAgents';
import { useEngine } from '@/lib/hooks/useConnections';
import { useGeneralChat, useMembers, useMyLevels, useTyping } from '@/lib/hooks/useChat';
import { useGuideCards } from '@/lib/hooks/useGuideCards';
import { useMessageActions } from '@/lib/hooks/useMessageActions';
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
  const { chatId, messages, openedAt, readByAll, reactions, actions, pinned, sendFile, loading, missing, error, send, sendVoice, retryTranscript } = useGeneralChat(orgId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const myName = members.find((m) => m.userId === me)?.displayName ?? '';
  const typing = useTyping(chatId, me ? { userId: me, name: myName } : null);
  const typingNow = typingLine(typing.others);
  const jump = useRef<((id: string) => void) | null>(null);

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
  const ghostOf = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.ghost])), [agents]);
  const others = useMemo(() => members.filter((m) => m.userId !== me), [members, me]);
  const people = useMemo(() => groupSubtitle(others.map((m) => m.displayName), talkable.length), [others, talkable]);
  const mainGhost = useMemo(() => agents.find(isMainAgent)?.ghost ?? 'base', [agents]);
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

  const ma = useMessageActions({
    messages,
    reactions,
    actions,
    me,
    canWrite: true,
    pinned,
    agents: talkable,
    send,
    sendVoice: engine ? (note, tagged, quoted) => sendVoice(note, agentIdsNamed(talkable, tagged), quoted) : undefined,
    jumpTo: (id) => jump.current?.(id),
    onError: setActionError,
    sendFile: engine ? sendFile : undefined,
  });

  if (loading) return <Loading />;
  if (missing) return <Notice title="No encontramos el chat General" body="Vuelve a Equipo y ábrelo de nuevo." />;

  return (
    <View className="flex-1 bg-chat">
      <Wallpaper />
      <Stack.Screen
        options={{
          title: 'General',
          headerRight: () => (
            <View className="flex-row">
              <Pressable accessibilityRole="button" accessibilityLabel="Buscar en el chat" onPress={() => setSearching(true)} hitSlop={6} className="min-h-11 min-w-11 items-center justify-center active:opacity-60">
                <Icon icon={MagnifyingGlass} size={22} color={c.ink} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Archivos del chat"
                onPress={() => router.push(`/archivos?thread=${chatId}`)}
                hitSlop={6}
                className="min-h-11 min-w-11 items-center justify-center active:opacity-60"
              >
                <Icon icon={FolderSimple} size={22} color={c.ink} />
              </Pressable>
            </View>
          ),
          headerTitle: () => (
            <View testID="general-header" className="flex-row items-center" style={{ maxWidth: 260 }}>
              <GroupFace person={others[0] ? { name: others[0].displayName, id: others[0].userId } : null} ghost={mainGhost} />
              <View className="ml-2 flex-shrink">
                <Text className="font-display text-base text-ink" numberOfLines={1}>
                  General
                </Text>
                <Text className={`text-caption ${typingNow ? 'text-chat-accent' : 'text-muted'}`} numberOfLines={1} accessibilityLiveRegion="polite">
                  {typingNow ?? people}
                </Text>
              </View>
            </View>
          ),
        }}
      />
      {ma.pinnedBar}
      <KeyboardColumn offset={headerHeight}>
        {searching ? (
          <ChatSearch
            messages={messages}
            onClose={() => setSearching(false)}
            onPick={(id) => {
              setSearching(false);
              setTimeout(() => jump.current?.(id), 300);
            }}
          />
        ) : messages.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="font-display text-title2 text-ink">Habla con tu equipo</Text>
            <Text className="mt-2 text-center text-base text-muted">
              Mándale un audio a quien está en {active?.name ?? 'la empresa'}. Los agentes no contestan aquí, salvo que los menciones con @, pero cada día leen lo que habláis.
            </Text>
          </View>
        ) : (
          <ChatList
            messages={messages}
            me={me}
            openedAt={openedAt}
            readByAll={readByAll}
            extraData={[cardState, reactions]}
            jumpRef={jump}
            renderMessage={(row, ticks) => (
              <MessageView
                message={row.message}
                mine={row.message.authorKind === 'person' && row.message.authorUserId === me}
                ghost={row.message.authorAgentId ? ghostOf[row.message.authorAgentId] : undefined}
                showAuthor={row.first}
                ticks={ticks}
                unplayed={row.unread}
                names={shown}
                canDecide={isOwner}
                onDecide={decide}
                asks={asks}
                guides={guides}
                onRetryTranscript={retryTranscript}
                me={me}
                transcript="none"
                {...ma.itemProps(row.message)}
              />
            )}
          />
        )}
        {error || actionError ? <Text className="px-4 pb-1 text-footnote text-no">{error ?? actionError}</Text> : null}
        <Composer
          placeholder="Mensaje"
          names={names}
          onSend={ma.send}
          onVoiceNote={ma.sendVoice}
          above={ma.above}
          prefill={ma.prefill}
          onAttach={ma.attach ? (k) => void ma.attach!(k) : undefined}
          attaching={ma.sendingFiles}
          onTyping={typing.say}
        />
      </KeyboardColumn>
      {ma.overlays}
    </View>
  );
}
