import type { ChatMessage } from '@ghostaff/shared';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { type NativeScrollEvent, type NativeSyntheticEvent, Platform, Pressable, Text, View } from 'react-native';
import type { Ticks } from '@/components/chat/Bubble';
import { CaretDoubleDown, Icon } from '@/components/icons';
import { type ChatRow, chatRows } from '@/lib/chat';
import { usePalette } from '@/lib/theme';

// A chat's list, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md),
// for General and every chat with an agent: a pill where each day starts,
// «N mensajes sin leer» where the person left off, the messages in runs, and,
// when they have scrolled up, a round button down to the newest with how many
// arrived meanwhile.

/** Further than this from the bottom, the person is reading back. */
const AWAY = 160;

export function ChatList({
  messages,
  me,
  openedAt,
  readByAll,
  renderMessage,
  extraData,
}: {
  messages: ChatMessage[];
  me?: string;
  /** The person's read mark when the chat opened; undefined while unknown. */
  openedAt: string | null | undefined;
  /** Up to when everyone else has read it (readByAllUntil). */
  readByAll: string | null;
  renderMessage: (row: Extract<ChatRow, { kind: 'message' }>, ticks: Ticks | null) => ReactNode;
  /** What the rows also depend on (the cards' state). */
  extraData?: unknown;
}) {
  const c = usePalette();
  const list = useRef<LegendListRef>(null);
  const rows = useMemo(() => chatRows(messages, { me, readAt: openedAt }), [messages, me, openedAt]);
  const [away, setAway] = useState(false);
  const [missed, setMissed] = useState(0);
  const seen = useRef(messages.length);

  // While reading back, count what arrives; at the bottom, nothing is missed.
  useEffect(() => {
    const added = messages.length - seen.current;
    seen.current = messages.length;
    if (away && added > 0) setMissed((n) => n + added);
    if (!away) setMissed(0);
  }, [messages.length, away]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    setAway(contentSize.height - (contentOffset.y + layoutMeasurement.height) > AWAY);
  };

  const ticksOf = (m: ChatMessage): Ticks | null => {
    if (m.authorKind !== 'person' || m.authorUserId !== me) return null;
    // Nobody else reads this chat (an agent's, with you alone): sent is all there is.
    if (readByAll === null) return 'sent';
    return Date.parse(readByAll) >= Date.parse(m.createdAt) ? 'read' : 'sent';
  };

  return (
    <View className="flex-1">
      <LegendList
        ref={list}
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <View className="my-2 items-center" accessibilityRole="header">
              <View className="rounded-lg border border-line bg-card px-3 py-1">
                <Text className="text-footnote font-medium text-muted">{item.label}</Text>
              </View>
            </View>
          ) : item.kind === 'unread' ? (
            <View testID="unread-divider" className="my-2 items-center bg-sunk py-1">
              <Text className="text-footnote font-medium text-muted">
                {item.count === 1 ? '1 mensaje sin leer' : `${item.count} mensajes sin leer`}
              </Text>
            </View>
          ) : (
            <>{renderMessage(item, ticksOf(item.message))}</>
          )
        }
        estimatedItemSize={64}
        extraData={[extraData, readByAll]}
        alignItemsAtEnd
        initialScrollAtEnd
        maintainScrollAtEnd
        maintainVisibleContentPosition
        onScroll={onScroll}
        scrollEventThrottle={64}
        // The web's list is a plain element that would print these as attributes.
        {...(Platform.OS === 'web' ? {} : { keyboardDismissMode: 'interactive' as const, keyboardShouldPersistTaps: 'handled' as const })}
        contentContainerStyle={{ paddingBottom: 12, paddingTop: 8 }}
        style={{ flex: 1 }}
      />
      {away ? (
        <Pressable
          testID="scroll-to-newest"
          accessibilityRole="button"
          accessibilityLabel={missed > 0 ? `Ir al final, ${missed} nuevos` : 'Ir al final'}
          onPress={() => {
            void list.current?.scrollToEnd({ animated: true });
            setMissed(0);
          }}
          className="absolute bottom-3 right-3 h-10 w-10 items-center justify-center rounded-full border border-line bg-card active:opacity-70"
        >
          <Icon icon={CaretDoubleDown} size={18} color={c.ink} weight="bold" />
          {missed > 0 ? (
            <View className="absolute -top-1.5 -right-1 min-w-5 items-center rounded-full bg-ok px-1">
              <Text className="text-[11px] font-semibold text-white">{missed}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}
