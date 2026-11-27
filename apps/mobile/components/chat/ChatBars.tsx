import type { Agent, ChatMessage } from '@ghostaff/shared';
import { messageText } from '@ghostaff/shared';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Icon, Microphone, PencilSimple, PushPin, X } from '@/components/icons';
import { personColour } from '@/lib/chat';
import { GHOSTS } from '@/lib/team';
import { useColorVars, usePalette } from '@/lib/theme';

// The small bars of a chat as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md,
// phase 2): what you are replying to or editing, above the box; the pinned
// message, under the header; and the agents to forward a message to.

/** «Nota de voz» or the first words, as a bar shows a message. */
export function preview(m: ChatMessage): { voice: boolean; text: string } {
  const voice = m.parts.some((p) => p.type === 'voice');
  return { voice, text: voice ? 'Nota de voz' : messageText(m.parts) };
}

/** Above the box: the message you reply to (with its author's colour) or that you are editing, with ✕. */
export function ReplyBar({ message, editing, onClose }: { message: ChatMessage; editing?: boolean; onClose: () => void }) {
  const c = usePalette();
  const { voice, text } = preview(message);
  const colour = editing ? c.ink : personColour(message.authorUserId ?? message.authorAgentId ?? message.authorName);
  return (
    <View testID={editing ? 'editing-bar' : 'reply-bar'} className="mx-1 mb-2 flex-row overflow-hidden rounded-xl bg-card">
      <View style={{ width: 4, backgroundColor: colour }} />
      <View className="flex-1 px-3 py-1.5">
        <View className="flex-row items-center">
          {editing ? <Icon icon={PencilSimple} size={13} color={c.muted} /> : null}
          <Text className={`text-footnote font-semibold ${editing ? 'ml-1 text-muted' : ''}`} style={editing ? undefined : { color: colour }} numberOfLines={1}>
            {editing ? 'Editando el mensaje' : message.authorName}
          </Text>
        </View>
        <View className="flex-row items-center">
          {voice ? <Icon icon={Microphone} size={13} color={c.muted} /> : null}
          <Text className={`text-footnote text-muted ${voice ? 'ml-1' : ''}`} numberOfLines={1}>
            {text}
          </Text>
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={editing ? 'Dejar de editar' : 'No responder'} onPress={onClose} className="h-11 w-11 items-center justify-center active:opacity-60">
        <Icon icon={X} size={18} color={c.muted} />
      </Pressable>
    </View>
  );
}

/** Under the header: the pinned message; a tap goes to it, ✕ unpins it. */
export function PinnedBar({ message, onPress, onUnpin }: { message: ChatMessage; onPress: () => void; onUnpin?: () => void }) {
  const c = usePalette();
  const { voice, text } = preview(message);
  return (
    <View testID="pinned-bar" className="flex-row items-center border-b border-line bg-card">
      <Pressable accessibilityRole="button" accessibilityLabel={`Mensaje fijado de ${message.authorName}: ${text}`} onPress={onPress} className="min-h-12 flex-1 flex-row items-center px-4 active:opacity-70">
        <Icon icon={PushPin} size={16} color={c.muted} />
        <Text className="ml-2 flex-1 text-footnote text-ink" numberOfLines={1}>
          <Text className="font-semibold">{message.authorName}: </Text>
          {voice ? '🎤 ' : ''}
          {text}
        </Text>
      </Pressable>
      {onUnpin ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Desfijar" onPress={onUnpin} className="h-12 w-12 items-center justify-center active:opacity-60">
          <Icon icon={X} size={16} color={c.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** «Reenviar a un agente»: the agents the person may talk to. */
export function AgentPicker({ visible, agents, onPick, onClose }: { visible: boolean; agents: Agent[]; onPick: (a: Agent) => void; onClose: () => void }) {
  // A Modal on the web renders outside the root view, where the colour classes' variables live.
  const themed = useColorVars();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={themed} accessibilityLabel="Cerrar" onPress={onClose} className="flex-1 justify-center bg-black/50 px-6">
        <Pressable onPress={() => {}} className="self-center overflow-hidden rounded-2xl bg-card" style={{ width: '100%', maxWidth: 360, maxHeight: 480 }}>
          <Text className="px-4 pb-2 pt-4 font-display text-base text-ink">Reenviar a un agente</Text>
          <ScrollView>
            {agents.length === 0 ? <Text className="px-4 pb-4 text-footnote text-muted">No puedes hablar con ningún agente.</Text> : null}
            {agents.map((a) => (
              <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Reenviar a ${a.name}`} onPress={() => onPick(a)} className="min-h-14 flex-row items-center border-t border-line px-4 active:bg-sunk">
                <Image source={GHOSTS[a.ghost].picture} style={{ width: 32, height: 32 }} resizeMode="contain" />
                <Text className="ml-3 text-base text-ink">{a.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
