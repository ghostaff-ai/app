import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

// Emoji, as WhatsApp's panel offers them (docs/plans/ready/chat-like-whatsapp.md,
// phase 2): for the text box and for reacting with something other than the six
// quick ones. A plain list in the app, no library: the phone draws them.

/** The six quick reactions above a held message, as in WhatsApp. */
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export const EMOJI_GROUPS: Array<{ name: string; emoji: string[] }> = [
  {
    name: 'Caras',
    emoji: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😛', '😜', '🤪',
      '🤗', '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '😌', '😔', '😪', '😴', '😷', '🤒', '🤯',
      '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😢', '😭', '😱', '😖', '😣', '😞', '😓', '😩',
      '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '💀', '💩', '🤡', '👻', '🤖',
    ],
  },
  {
    name: 'Gestos',
    emoji: ['👍', '👎', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '👋', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🫡', '🫶'],
  },
  {
    name: 'Corazones',
    emoji: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💯', '✨', '⭐', '🔥', '💥'],
  },
  {
    name: 'Trabajo',
    emoji: ['✅', '❌', '⚠️', '❓', '❗', '📌', '📎', '📝', '📅', '⏰', '📞', '📧', '💼', '📊', '📈', '📉', '💰', '💶', '💳', '🧾', '📦', '🚚', '🏪', '🛒', '🔑', '💡', '🎯', '🚀'],
  },
  {
    name: 'Celebrar',
    emoji: ['🎉', '🎊', '🥂', '🍾', '🎂', '🎁', '🏆', '🥇', '🎈', '🙌', '👑', '🌟'],
  },
  {
    name: 'Comida',
    emoji: ['☕', '🍺', '🍷', '🥖', '🍞', '🥐', '🍕', '🍔', '🥗', '🍝', '🥘', '🍤', '🍰', '🍫', '🍎', '🍊', '🍋', '🍓'],
  },
];

export function EmojiPicker({ onPick, height = 240 }: { onPick: (emoji: string) => void; height?: number }) {
  const [group, setGroup] = useState(0);
  const shown = EMOJI_GROUPS[group]?.emoji ?? [];
  return (
    <View testID="emoji-picker" className="border-t border-line bg-card" style={{ height }}>
      <View className="flex-row border-b border-line px-1">
        {EMOJI_GROUPS.map((g, i) => (
          <Pressable
            key={g.name}
            accessibilityRole="tab"
            accessibilityState={{ selected: i === group }}
            accessibilityLabel={g.name}
            onPress={() => setGroup(i)}
            className={`flex-1 items-center py-2 ${i === group ? 'border-b-2 border-ink' : ''}`}
          >
            <Text className="text-lg">{g.emoji[0]}</Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', padding: 6 }} keyboardShouldPersistTaps="handled">
        {shown.map((e) => (
          <Pressable key={e} accessibilityRole="button" accessibilityLabel={e} onPress={() => onPick(e)} className="h-11 w-11 items-center justify-center active:opacity-50">
            <Text style={{ fontSize: 26 }}>{e}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
