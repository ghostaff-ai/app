import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { shortNext, soonest } from '@ghostaff/shared';
import { agentJob, decideAction } from '@ghostaff/shared/services';
import { Wallpaper } from '@/components/chat/Wallpaper';
import { ChatList } from '@/components/chat/ChatList';
import { Composer, ReadOnlyComposer } from '@/components/chat/Composer';
import { MessageView } from '@/components/chat/Message';
import { Clock, Icon, MagnifyingGlass } from '@/components/icons';
import { Button, Loading, Notice } from '@/components/ui';
import { useAuth } from '@/lib/auth/AuthContext';
import { ChatSearch } from '@/components/chat/ChatSearch';
import { agentIdsNamed, typingLine } from '@/lib/chat';
import { useAccountAsks } from '@/lib/hooks/useAccountAsks';
import { useAgents } from '@/lib/hooks/useAgents';
import { useGuideCards } from '@/lib/hooks/useGuideCards';
import { useMessageActions } from '@/lib/hooks/useMessageActions';
import { useEngine } from '@/lib/hooks/useConnections';
import { useAgentChat, useMembers, useMyLevels, useTyping } from '@/lib/hooks/useChat';
import { useRoutines } from '@/lib/hooks/useRoutines';
import { KeyboardColumn } from '@/lib/keyboard';
import { useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { usePush } from '@/lib/push/PushProvider';
import { loadAskState, saveDecline, shouldAsk, type AskState } from '@/lib/push/softAsk';
import { GHOSTS } from '@/lib/team';
import { usePalette } from '@/lib/theme';

// An agent's one chat (group-chat-per-agent.md), opened straight from its row
// in Equipo: one long conversation, as in a WhatsApp group, with what the agent
// did on its own in it too. Everyone who may see the agent reads it, and
// whoever may talk to it writes, each message signed. The agent's name on top
// opens its page and settings (three-tabs.md, decision 6). The mic sends voice notes (voice.md), here only: no engine, no mic.
// The clock on the right is the agent's routines (agent-routines.md): an
// outline when the person has none with it, the next one's day and hour
// when they do; it opens them.
// «Preguntar» on a decision lands here with it (`about`, `q`): it shows above
// the box, and the next message carries it (decision-model.md, decision 7).

// Under the person's first message of the session, once: would they like to be
// told when the agent answers? «Sí» opens the phone's own dialog; «Ahora no» is
// remembered (softAsk.ts). Never on the web, where there is nothing to turn on.
function PushAsk({ onAnswered }: { onAnswered: () => void }) {
  const { ask } = usePush();
  return (
    <View testID="push-ask" className="px-4 pb-2">
      <Text className="text-footnote text-muted">¿Te aviso cuando te conteste?</Text>
      <View className="mt-1 flex-row gap-2">
        <Button
          label="Sí, avísame"
          variant="secondary"
          size="small"
          onPress={() => {
            onAnswered();
            void ask();
          }}
        />
        <Button
          label="Ahora no"
          variant="plain"
          size="small"
          onPress={() => {
            onAnswered();
            void saveDecline(new Date());
          }}
        />
      </View>
    </View>
  );
}

export default function Chat() {
  const { agent: agentId, about, q } = useLocalSearchParams<{ agent: string; about?: string; q?: string }>();
  // The decision the next message is about, until it is sent or put away.
  const [aboutId, setAboutId] = useState<string | null>(about ?? null);
  useEffect(() => {
    if (about) setAboutId(about);
  }, [about]);
  const { session } = useAuth();
  const { active } = useActiveOrg();
  const orgId = active?.id ?? null;
  const { items: agents, loading: agentsLoading, reload: reloadAgents } = useAgents(orgId);
  const { members } = useMembers(orgId);
  const { levels, loading: levelsLoading } = useMyLevels(orgId);
  const { chatId, messages, openedAt, readByAll, reactions, actions, pinned, sendFile, loading, error, send: sendPlain, askAbout, sendVoice, retryTranscript } = useAgentChat(orgId, agentId ?? null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const jump = useRef<((id: string) => void) | null>(null);
  const send = useCallback(
    async (body: string, quoted?: string | null) => {
      if (!aboutId) return sendPlain(body, quoted);
      await askAbout(aboutId, body);
      setAboutId(null);
    },
    [aboutId, sendPlain, askAbout],
  );
  const { items: routines, reload: reloadRoutines } = useRoutines(orgId, agentId ?? null);
  const palette = usePalette();
  const headerHeight = useHeaderHeight();
  const engine = useEngine();
  // While this chat is on screen, a push for its reply isn't shown.
  const { permission, setOnScreen } = usePush();
  useFocusEffect(
    useCallback(() => {
      setOnScreen(`/chat/${agentId}`);
      return () => setOnScreen(null);
    }, [agentId, setOnScreen]),
  );

  // Asking for notifications: after the first message sent in this session, if the policy allows.
  const [sentOne, setSentOne] = useState(false);
  const [askState, setAskState] = useState<AskState | null>(null);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    void loadAskState().then(setAskState);
  }, []);
  const sendAndNote = useCallback(
    async (text: string, quoted?: string | null) => {
      await send(text, quoted);
      setSentOne(true);
    },
    [send],
  );
  const showPushAsk = sentOne && !asked && askState !== null && shouldAsk(permission, askState, new Date());

  const me = session?.user.id;
  const agent = agents.find((a) => a.id === agentId);
  const names = useMemo(() => [...agents.map((a) => a.name), ...members.filter((m) => m.userId !== me).map((m) => m.displayName)], [agents, members, me]);
  const ghostOf = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.ghost])), [agents]);
  const owner = members.find((m) => m.role === 'owner' && m.userId !== me)?.displayName ?? null;
  const isOwner = active?.role === 'owner';
  const owners = useMemo(() => members.filter((m) => m.role === 'owner').map((m) => m.displayName), [members]);
  const asks = useAccountAsks({ orgId, messages, agents, reloadAgents, owners, isOwner, returnPath: `chat/${agentId}` });
  const canTalk = !!agent && levels[agent.id] === 'talk';
  const guides = useGuideCards({ messages, isOwner, owners, canTalk });
  // The cards' state (asked for, going on) lives outside the messages: redraw them when it changes.
  const cardState = useMemo(() => ({ asks, guides }), [asks, guides]);
  // The card updates itself when the engine rewrites the message.
  const decide = useMemo(
    () => async (actionId: string, decision: 'approve' | 'reject', edits?: Record<string, string>) => {
      if (!engine) throw new Error('not signed in');
      await decideAction(engine, actionId, decision, edits);
      // An approved routine shows on the clock at once.
      void reloadRoutines();
    },
    [engine, reloadRoutines],
  );
  const routineTitles = useMemo(() => Object.fromEntries(routines.map((r) => [r.id, r.title])), [routines]);
  const myName = members.find((m) => m.userId === me)?.displayName ?? '';
  const typing = useTyping(chatId, me ? { userId: me, name: myName } : null);
  const typingNow = typingLine(typing.others);
  // Forwarding goes to the other agents the person may talk to.
  const forwardTo = useMemo(() => agents.filter((a) => a.id !== agentId && levels[a.id] === 'talk'), [agents, agentId, levels]);
  const ma = useMessageActions({
    messages,
    reactions,
    actions,
    me,
    canWrite: canTalk,
    pinned,
    agents: forwardTo,
    send: sendAndNote,
    sendVoice: engine ? (note, tagged, quoted) => sendVoice(note, agentIdsNamed(agents, tagged), quoted) : undefined,
    jumpTo: (id) => jump.current?.(id),
    onError: setActionError,
    // Files go to a chat that exists: a new agent's opens with its hello.
    sendFile: engine && messages.length > 0 ? sendFile : undefined,
  });
  const next = soonest(routines, new Date());

  if (!agent && (agentsLoading || levelsLoading)) return <Loading />;
  if (!agent) return <Notice title="No encontramos este agente" body="Puede que ya no esté en el equipo, o que no tengas acceso." />;
  const g = GHOSTS[agent.ghost];
  const showClock = agent.runner !== 'ordago_job' && (canTalk || routines.length > 0);
  const nextLabel = next ? shortNext(next, new Date(), next.timezone) : null;

  return (
    <View className="flex-1 bg-chat">
      <Wallpaper />
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
                  {typingNow ?? (agent.name === g.label ? 'Toca para ver su ficha' : g.label)}
                </Text>
              </View>
            </Pressable>
          ),
          headerRight: () => (
            <View className="flex-row items-center">
              <Pressable accessibilityRole="button" accessibilityLabel="Buscar en el chat" onPress={() => setSearching(true)} hitSlop={6} className="min-h-11 min-w-11 items-center justify-center active:opacity-60">
                <Icon icon={MagnifyingGlass} size={22} color={palette.ink} />
              </Pressable>
              {showClock ? (
                <Pressable
                  testID="chat-routines"
                  accessibilityRole="button"
                  accessibilityLabel={nextLabel ? `Tareas programadas. La próxima: ${nextLabel}` : 'Tareas programadas'}
                  accessibilityHint={`Lo que ${agent.name} hace solo, a su hora`}
                  onPress={() => router.push(`/tareas-programadas/${agent.id}`)}
                  hitSlop={10}
                  className="min-h-11 flex-row items-center justify-center px-1 active:opacity-60"
                >
                  <Icon icon={Clock} size={22} color={nextLabel ? palette.ink : palette.muted} weight={nextLabel ? 'regular' : 'light'} />
                  {nextLabel ? <Text className="ml-1 text-footnote font-medium text-ink">{nextLabel}</Text> : null}
                </Pressable>
              ) : null}
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
        ) : loading ? (
          <Loading />
        ) : messages.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Image source={g.picture} style={{ width: 120, height: 120 }} resizeMode="contain" />
            <Text className="mt-3 font-display text-title2 text-ink">{agent.name}</Text>
            <Text className="mt-1 text-center text-base text-muted">{agentJob(agent)}</Text>
            <Text className="mt-6 text-center text-footnote text-muted">La ve todo el que tiene acceso a {agent.name}.</Text>
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
                names={names}
                canDecide={isOwner}
                onDecide={decide}
                asks={asks}
                guides={guides}
                onRetryTranscript={retryTranscript}
                routineTitle={row.message.routineId ? routineTitles[row.message.routineId] : null}
                me={me}
                {...ma.itemProps(row.message)}
              />
            )}
          />
        )}
        {error || actionError ? <Text className="px-4 pb-1 text-footnote text-no">{error ?? actionError}</Text> : null}
        {showPushAsk ? <PushAsk onAnswered={() => setAsked(true)} /> : null}
        {canTalk && aboutId ? (
          <View testID="asking-about" className="mx-4 mb-1 flex-row items-center rounded-2xl bg-card py-1 pl-3 pr-1">
            <View className="flex-1 border-l-2 border-line pl-2">
              <Text className="text-caption text-muted">Sobre la decisión</Text>
              <Text className="text-footnote font-semibold text-ink" numberOfLines={2}>
                {q ?? 'La decisión que abriste'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quitar la decisión del mensaje"
              onPress={() => setAboutId(null)}
              hitSlop={6}
              className="min-h-11 min-w-11 items-center justify-center active:opacity-60"
            >
              <Text className="text-lg text-muted">×</Text>
            </Pressable>
          </View>
        ) : null}
        {canTalk ? (
          <Composer
            placeholder={`Escribe a ${agent.name}`}
            names={names}
            onSend={ma.send}
            onVoiceNote={ma.sendVoice}
            above={ma.above}
            prefill={ma.prefill}
            onAttach={ma.attach ? (k) => void ma.attach!(k) : undefined}
            attaching={ma.sendingFiles}
            onTyping={typing.say}
          />
        ) : (
          <ReadOnlyComposer note={owner ? `Pide acceso a ${owner}` : null} />
        )}
      </KeyboardColumn>
      {ma.overlays}
    </View>
  );
}
