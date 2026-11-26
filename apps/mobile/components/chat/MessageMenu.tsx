import type { ChatMessage } from '@ghostaff/shared';
import { messageText } from '@ghostaff/shared';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { EmojiPicker, QUICK_REACTIONS } from '@/components/chat/EmojiPicker';
import { ArrowUUpLeft, Copy, Icon, PencilSimple, PushPin, ShareFat, Trash } from '@/components/icons';
import { useColorVars, usePalette } from '@/lib/theme';

// What a held message offers, as in WhatsApp (docs/plans/ready/chat-like-whatsapp.md,
// phase 2): six quick reactions and any other emoji, then Responder, Copiar,
// Reenviar a un agente, Fijar, and on your own, Editar (15 minutes, text only)
// and Eliminar (for everyone, after a confirmation).

export type MenuAction = 'reply' | 'copy' | 'forward' | 'pin' | 'unpin' | 'edit' | 'delete';

const EDIT_WINDOW_MS = 15 * 60_000;

/** What a person may do with a message: their own text can be edited for 15 minutes; only their own can be deleted. */
export function actionsFor(m: ChatMessage, opts: { me?: string; canWrite: boolean; pinned: boolean; canForward: boolean; now?: number }): MenuAction[] {
  if (m.deletedAt) return [];
  const mine = m.authorKind === 'person' && m.authorUserId === opts.me;
  const voice = m.parts.some((p) => p.type === 'voice');
  const out: MenuAction[] = [];
  if (opts.canWrite) out.push('reply');
  if (messageText(m.parts).trim()) out.push('copy');
  if (opts.canForward) out.push('forward');
  if (opts.canWrite) out.push(opts.pinned ? 'unpin' : 'pin');
  if (mine && !voice && (opts.now ?? Date.now()) - Date.parse(m.createdAt) < EDIT_WINDOW_MS) out.push('edit');
  if (mine) out.push('delete');
  return out;
}

const LABELS: Record<MenuAction, string> = {
  reply: 'Responder',
  copy: 'Copiar',
  forward: 'Reenviar a un agente',
  pin: 'Fijar',
  unpin: 'Desfijar',
  edit: 'Editar',
  delete: 'Eliminar',
};

const ICONS = { reply: ArrowUUpLeft, copy: Copy, forward: ShareFat, pin: PushPin, unpin: PushPin, edit: PencilSimple, delete: Trash };

export function MessageMenu({
  message,
  actions,
  myReaction,
  canReact,
  onReact,
  onAction,
  onClose,
}: {
  message: ChatMessage | null;
  actions: MenuAction[];
  /** The emoji you reacted with, if any: picking it again takes it away. */
  myReaction: string | null;
  canReact: boolean;
  onReact: (emoji: string | null) => void;
  onAction: (a: MenuAction) => void;
  onClose: () => void;
}) {
  const c = usePalette();
  // A Modal on the web renders outside the root view, where the colour classes' variables live.
  const themed = useColorVars();
  const [more, setMore] = useState(false);
  const [sure, setSure] = useState(false);
  const close = () => {
    setMore(false);
    setSure(false);
    onClose();
  };
  const react = (e: string) => {
    onReact(e === myReaction ? null : e);
    close();
  };
  return (
    <Modal visible={message !== null} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={themed} accessibilityLabel="Cerrar" onPress={close} className="flex-1 justify-center bg-black/50 px-6">
        <Pressable onPress={() => {}} className="self-center" style={{ width: '100%', maxWidth: 360 }}>
          {canReact ? (
            <View testID="quick-reactions" className="mb-2 flex-row items-center justify-between self-start rounded-full bg-card px-2 py-1">
              {QUICK_REACTIONS.map((e) => (
                <Pressable
                  key={e}
                  accessibilityRole="button"
                  accessibilityLabel={`Reaccionar con ${e}`}
                  accessibilityState={{ selected: e === myReaction }}
                  onPress={() => react(e)}
                  className={`h-11 w-11 items-center justify-center rounded-full ${e === myReaction ? 'bg-sunk' : ''} active:opacity-60`}
                >
                  <Text style={{ fontSize: 26 }}>{e}</Text>
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" accessibilityLabel="Más emojis" onPress={() => setMore((m) => !m)} className="h-11 w-11 items-center justify-center rounded-full bg-sunk active:opacity-60">
                <Text className="text-xl text-muted">+</Text>
              </Pressable>
            </View>
          ) : null}
          {more ? (
            <View className="mb-2 overflow-hidden rounded-2xl">
              <EmojiPicker onPick={react} height={260} />
            </View>
          ) : null}
          {message ? (
            <View className="mb-2 rounded-2xl bg-card px-3 py-2" accessibilityElementsHidden>
              <Text className="text-footnote font-semibold text-muted">{message.authorName}</Text>
              <Text className="text-base text-ink" numberOfLines={4}>
                {message.parts.some((p) => p.type === 'voice') ? 'Nota de voz' : messageText(message.parts)}
              </Text>
            </View>
          ) : null}
          {sure ? (
            <View className="overflow-hidden rounded-2xl bg-card">
              <Text className="px-4 pt-3 text-base text-ink">¿Eliminar este mensaje para todos?</Text>
              <View className="flex-row justify-end gap-2 p-2">
                <Pressable accessibilityRole="button" onPress={() => setSure(false)} className="min-h-11 justify-center px-4 active:opacity-60">
                  <Text className="text-base text-muted">Cancelar</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Eliminar para todos"
                  onPress={() => {
                    onAction('delete');
                    close();
                  }}
                  className="min-h-11 justify-center px-4 active:opacity-60"
                >
                  <Text className="text-base font-semibold text-no">Eliminar</Text>
                </Pressable>
              </View>
            </View>
          ) : actions.length ? (
            <View className="overflow-hidden rounded-2xl bg-card">
              {actions.map((a, i) => (
                <Pressable
                  key={a}
                  accessibilityRole="button"
                  accessibilityLabel={LABELS[a]}
                  onPress={() => {
                    if (a === 'delete') {
                      setSure(true);
                      return;
                    }
                    onAction(a);
                    close();
                  }}
                  className={`min-h-12 flex-row items-center justify-between px-4 active:bg-sunk ${i > 0 ? 'border-t border-line' : ''}`}
                >
                  <Text className={`text-base ${a === 'delete' ? 'text-no' : 'text-ink'}`}>{LABELS[a]}</Text>
                  <Icon icon={ICONS[a]} size={20} color={a === 'delete' ? c.no : c.muted} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
