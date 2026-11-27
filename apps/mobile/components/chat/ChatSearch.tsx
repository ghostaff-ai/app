import type { ChatMessage } from '@ghostaff/shared';
import { messageText } from '@ghostaff/shared';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Icon, MagnifyingGlass, X } from '@/components/icons';
import { dayLabel, timeOf } from '@/lib/chat';
import { usePalette } from '@/lib/theme';

// Searching a chat, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md,
// phase 4): words in its messages, a voice note's transcript included (what was
// said can be found though it isn't shown), newest first; a tap goes to it.

const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The messages whose words hold every word searched, accents and case aside; newest first. */
export function searchMessages(messages: ChatMessage[], query: string): ChatMessage[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return messages.filter((m) => !m.deletedAt && words.every((w) => plain(messageText(m.parts)).includes(w))).reverse();
}

export function ChatSearch({ messages, onPick, onClose }: { messages: ChatMessage[]; onPick: (messageId: string) => void; onClose: () => void }) {
  const c = usePalette();
  const [query, setQuery] = useState('');
  const found = useMemo(() => searchMessages(messages, query), [messages, query]);
  return (
    <View testID="chat-search" className="flex-1 bg-surface">
      <View className="flex-row items-center border-b border-line px-3 py-2">
        <Icon icon={MagnifyingGlass} size={18} color={c.muted} />
        <TextInput
          autoFocus
          accessibilityLabel="Buscar en el chat"
          placeholder="Buscar en el chat"
          placeholderTextColor={c.muted}
          value={query}
          onChangeText={setQuery}
          className="ml-2 min-h-11 flex-1 text-base text-ink"
        />
        <Pressable accessibilityRole="button" accessibilityLabel="Cerrar la búsqueda" onPress={onClose} className="h-11 w-11 items-center justify-center active:opacity-60">
          <Icon icon={X} size={18} color={c.muted} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled">
        {query.trim() && found.length === 0 ? <Text className="px-4 py-6 text-center text-footnote text-muted">Nada con «{query.trim()}»</Text> : null}
        {found.map((m) => (
          <Pressable key={m.id} accessibilityRole="button" onPress={() => onPick(m.id)} className="border-b border-line px-4 py-3 active:bg-sunk">
            <View className="flex-row justify-between">
              <Text className="text-footnote font-semibold text-ink">{m.authorName}</Text>
              <Text className="text-caption text-muted">
                {dayLabel(m.createdAt)} {timeOf(m.createdAt)}
              </Text>
            </View>
            <Text className="mt-0.5 text-footnote text-muted" numberOfLines={2}>
              {m.parts.some((p) => p.type === 'voice') ? '🎤 ' : ''}
              {messageText(m.parts)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
