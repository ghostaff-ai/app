import { completeMention, mentionQuery, mentionSuggestions, onlyMentions } from '@ghostaff/shared';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, PanResponder, Platform, Pressable, Text, TextInput, type TextInputInstance, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import { clock } from '@/components/chat/RecordingBar';
import { ArrowUp, Camera, CaretLeft, CaretUp, Eye, FileText, Icon, ImageSquare, LockSimple, Microphone, Paperclip, Pause, PaperPlaneRight, Smiley, Trash } from '@/components/icons';
import type { AttachKind } from '@/lib/attach';
import { tap } from '@/lib/haptics';
import { holdMove, holdRelease } from '@/lib/hold';
import { type RecordedNote, useVoiceNote } from '@/lib/hooks/useVoiceNote';
import { useColorVars, usePalette } from '@/lib/theme';

// Where a person writes in a chat, as in WhatsApp (docs/plans/ready/
// chat-like-whatsapp.md): a growing text box and one round button, the mic
// while the box is empty and send once there is text. Hold the mic to record
// and let go to send; slide left to cancel; slide up to lock, and the note
// goes on hands-free with pause, bin and send (decision 4). A short tap says
// how. With only @mentions in the box, the note goes tagged to them (general-
// chat.md, decision 6). A screen reader's «activate» starts a locked note.
// Typing @ offers the agents and people that can be mentioned. With «Ver», or
// in a conversation its opener keeps to reading, it turns into a quiet line.

/** What the database takes in one message (post_message). */
const MAX_LENGTH = 8000;

type Mode = 'idle' | 'holding' | 'locked';

export function Composer({
  placeholder,
  names,
  onSend,
  autoFocus,
  onVoiceNote,
  above,
  prefill,
  onAttach,
  attaching,
  onTyping,
}: {
  placeholder: string;
  /** What @ can complete to. */
  names: string[];
  /** Resolves once sent; a rejection keeps the text so nothing is lost. */
  onSend: (text: string) => Promise<void>;
  autoFocus?: boolean;
  /**
   * Sends a recorded voice note, with the names the box tagged when it was
   * started; without it there is no mic. A rejection keeps the note to send again.
   */
  onVoiceNote?: (note: RecordedNote, tagged: string[]) => Promise<void>;
  /** A bar above the box: the message being replied to, or the one being edited (chat-like-whatsapp.md, phase 2). */
  above?: ReactNode;
  /** Words to put in the box (editing a message); a new `key` puts them again. */
  prefill?: { key: string; text: string } | null;
  /** The clip and the camera (chat-like-whatsapp.md, phase 3); without it there are none. */
  onAttach?: (kind: AttachKind) => void;
  /** Files going out: the clip waits. */
  attaching?: boolean;
  /** Tells the others you are typing or recording (phase 4). */
  onTyping?: (kind: 'typing' | 'recording') => void;
}) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(false);
  const [mode, setMode] = useState<Mode>('idle');
  const [emoji, setEmoji] = useState(false);
  const [sheet, setSheet] = useState(false);
  const themed = useColorVars();
  useEffect(() => {
    if (prefill) {
      setText(prefill.text);
      input.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill?.key]);
  const modeRef = useRef<Mode>('idle');
  const slide = useRef(new Animated.Value(0)).current;
  const input = useRef<TextInputInstance>(null);

  // The names the box tags while it holds nothing else: they go with the note, and leave the box once it is sent.
  const tags = onlyMentions(text, names);
  const tagged = useRef<string[]>([]);
  const voice = useVoiceNote({
    send: async (note) => {
      if (!onVoiceNote) throw new Error('voice notes are off');
      await onVoiceNote(note, tagged.current);
      if (tagged.current.length > 0) setText('');
      tagged.current = [];
    },
  });

  const setModeBoth = (m: Mode) => {
    modeRef.current = m;
    setMode(m);
  };

  const query = mentionQuery(text);
  const suggestions = query === null ? [] : mentionSuggestions(query, names);
  const hasText = text.trim().length > 0 && tags === null;
  const ready = hasText && !busy;
  const micMode = onVoiceNote !== undefined && !hasText;

  const send = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await onSend(text.trim());
      setText('');
      voice.clearError();
      tap();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const begin = (locked: boolean) => {
    setHint(false);
    tagged.current = tags ?? [];
    setModeBoth(locked ? 'locked' : 'holding');
    tap();
    void voice.start();
  };
  const end = () => {
    slide.setValue(0);
    setModeBoth('idle');
  };

  // Hold, slide and let go: React Native's own responder, so it ships over the air.
  const pressedAt = useRef(0);
  const hold = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          pressedAt.current = Date.now();
          begin(false);
        },
        onPanResponderMove: (_, g) => {
          if (modeRef.current !== 'holding') return;
          slide.setValue(Math.min(0, g.dx));
          const move = holdMove(g.dx, g.dy);
          if (move === 'cancel') {
            void voice.cancel();
            end();
          } else if (move === 'lock') {
            slide.setValue(0);
            setModeBoth('locked');
            tap();
          }
        },
        onPanResponderRelease: () => {
          if (modeRef.current !== 'holding') return;
          if (holdRelease(Date.now() - pressedAt.current) === 'tap') {
            void voice.cancel();
            setHint(true);
          } else {
            void voice.finish();
          }
          end();
        },
        onPanResponderTerminate: () => {
          if (modeRef.current !== 'holding') return;
          void voice.finish();
          end();
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [voice.start, voice.finish, voice.cancel, tags?.join('|')],
  );

  const recording = voice.state === 'recording' || voice.state === 'paused';
  const sending = voice.state === 'sending';
  // Once a note is over (sent, cancelled, stopped by a call) or never began
  // (no microphone), the box comes back.
  const active = useRef(false);
  useEffect(() => {
    if (voice.state !== 'idle') active.current = true;
    else if (active.current || voice.error) {
      active.current = false;
      if (modeRef.current !== 'idle') end();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.state, voice.error]);
  // While recording, the others read «está grabando un audio…».
  useEffect(() => {
    if (voice.state === 'recording') onTyping?.('recording');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.state, voice.seconds]);
  const showLocked = mode === 'locked' && (recording || voice.state === 'idle');
  const showHolding = mode === 'holding';

  return (
    <View testID="composer" className="px-2 pt-2" style={{ paddingBottom: Math.max(10, insets.bottom) }}>
      {suggestions.length > 0 ? (
        <View className="mb-2 flex-row flex-wrap gap-2 px-1" accessibilityLabel="Mencionar a">
          {suggestions.map((n) => (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityLabel={`Mencionar a ${n}`}
              onPress={() => {
                setText((t) => completeMention(t, n));
                input.current?.focus();
              }}
              className="rounded-full bg-sunk px-3 py-1.5 active:opacity-70"
            >
              <Text className="text-footnote text-ink">@{n}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {above}
      {error ? <Text className="mb-1 ml-3 text-footnote text-no">No se ha enviado. {error}</Text> : null}
      {hint ? (
        <Text testID="hold-hint" className="mb-1 ml-3 text-footnote text-muted">
          Mantén pulsado para grabar, suelta para enviar
        </Text>
      ) : null}
      {voice.error ? (
        <View className="mb-1 ml-3 flex-row flex-wrap items-center gap-x-3">
          <Text className="text-footnote text-no">{voice.error}</Text>
          {voice.held && !recording ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Enviar la nota" onPress={() => void voice.resend()} hitSlop={8} className="active:opacity-70">
                <Text className="text-footnote text-ink underline">Enviar</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Descartar la nota" onPress={voice.discard} hitSlop={8} className="active:opacity-70">
                <Text className="text-footnote text-muted underline">Descartar</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ) : null}

      {showLocked ? (
        <View testID="recording-locked" className="rounded-3xl bg-theirs px-3 py-2">
          <View className="flex-row items-center gap-2" accessibilityLabel={`${voice.state === 'paused' ? 'En pausa' : 'Grabando'}, ${clock(voice.seconds)}`}>
            <View className={`h-2.5 w-2.5 rounded-full ${voice.state === 'paused' ? 'bg-muted' : 'bg-no'}`} />
            <Text className="text-base text-ink" style={{ fontVariant: ['tabular-nums'] }}>
              {clock(voice.seconds)}
            </Text>
            <LiveWave levels={voice.live} colour={c.muted} />
          </View>
          <View className="mt-2 flex-row items-center justify-between">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Descartar la grabación"
              onPress={() => {
                void voice.cancel();
                end();
              }}
              hitSlop={8}
              className="h-11 w-11 items-center justify-center active:opacity-60"
            >
              <Icon icon={Trash} size={22} color={c.muted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={voice.state === 'paused' ? 'Seguir grabando' : 'Pausar la grabación'}
              onPress={() => (voice.state === 'paused' ? voice.resume() : voice.pause())}
              hitSlop={8}
              className="h-11 w-11 items-center justify-center active:opacity-60"
            >
              <Icon icon={voice.state === 'paused' ? Microphone : Pause} size={24} color={c.no} weight="fill" />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar nota de voz"
              onPress={() => {
                void voice.finish();
                end();
              }}
              className="h-11 w-11 items-center justify-center rounded-full bg-chat-accent active:opacity-80"
            >
              <Icon icon={PaperPlaneRight} size={20} color={c.onChatAccent} weight="fill" />
            </Pressable>
          </View>
        </View>
      ) : (
        <View className="flex-row items-end gap-2">
          {showHolding ? (
            <View testID="recording-holding" className="min-h-11 flex-1 flex-row items-center rounded-3xl bg-theirs px-4">
              <View className="h-2.5 w-2.5 rounded-full bg-no" />
              <Text className="ml-2 text-base text-ink" style={{ fontVariant: ['tabular-nums'] }} accessibilityLabel={`Grabando, ${clock(voice.seconds)}`}>
                {clock(voice.seconds)}
              </Text>
              <Animated.View className="flex-1 flex-row items-center justify-center" style={{ transform: [{ translateX: slide }] }}>
                <Icon icon={CaretLeft} size={14} color={c.muted} />
                <Text className="ml-1 text-footnote text-muted">Desliza para cancelar</Text>
              </Animated.View>
            </View>
          ) : sending ? (
            <View className="min-h-11 flex-1 flex-row items-center rounded-3xl bg-theirs px-4">
              <Text className="text-footnote text-muted">Enviando la nota…</Text>
            </View>
          ) : (
            <View className="min-h-11 flex-1 flex-row items-end rounded-3xl bg-theirs">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={emoji ? 'Cerrar emojis' : 'Emojis'}
              onPress={() => setEmoji((e) => !e)}
              hitSlop={6}
              className="h-11 w-10 items-center justify-center active:opacity-60"
            >
              <Icon icon={Smiley} size={22} color={c.muted} />
            </Pressable>
            <TextInput
              ref={input}
              accessibilityLabel={placeholder}
              placeholder={placeholder}
              placeholderTextColor={c.muted}
              value={text}
              onChangeText={(t) => {
                setText(t);
                if (t.trim()) onTyping?.('typing');
                setHint(false);
                voice.clearError();
              }}
              multiline
              autoFocus={autoFocus}
              maxLength={MAX_LENGTH}
              onKeyPress={(e) => {
                // On a computer, Enter sends and Shift+Enter makes a new line.
                const ev = e.nativeEvent as { key: string; shiftKey?: boolean };
                if (Platform.OS === 'web' && ev.key === 'Enter' && !ev.shiftKey) {
                  (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                  void send();
                }
              }}
              onFocus={() => setEmoji(false)}
              className={`max-h-36 min-h-11 flex-1 py-2.5 text-base text-ink ${onAttach ? 'pr-1' : 'pr-4'}`}
              textAlignVertical="center"
            />
            {onAttach ? (
              <View className="flex-row">
                {attaching ? (
                  <View className="h-11 w-10 items-center justify-center">
                    <ActivityIndicator color={c.muted} />
                  </View>
                ) : (
                  <Pressable accessibilityRole="button" accessibilityLabel="Adjuntar" onPress={() => setSheet(true)} hitSlop={4} className="h-11 w-10 items-center justify-center active:opacity-60">
                    <Icon icon={Paperclip} size={22} color={c.muted} />
                  </Pressable>
                )}
                {text.trim() ? null : (
                  <Pressable accessibilityRole="button" accessibilityLabel="Hacer una foto" onPress={() => onAttach('camera')} hitSlop={4} className="mr-1 h-11 w-10 items-center justify-center active:opacity-60">
                    <Icon icon={Camera} size={22} color={c.muted} />
                  </Pressable>
                )}
              </View>
            ) : null}
            </View>
          )}

          {micMode ? (
            <View>
              {showHolding ? (
                <View className="absolute -top-16 left-0 right-0 items-center" pointerEvents="none" accessibilityElementsHidden>
                  <View className="items-center rounded-full border border-line bg-card px-2 py-2">
                    <Icon icon={LockSimple} size={16} color={c.muted} />
                    <Icon icon={CaretUp} size={12} color={c.muted} />
                  </View>
                </View>
              ) : null}
              <View
                {...hold.panHandlers}
                accessible
                accessibilityRole="button"
                accessibilityLabel={tags && tags.length > 0 ? `Grabar nota de voz para ${tags.join(' y ')}` : 'Grabar nota de voz'}
                accessibilityHint="Mantén pulsado para grabar y suelta para enviar"
                accessibilityActions={[{ name: 'activate' }]}
                onAccessibilityAction={() => begin(true)}
                className={`items-center justify-center rounded-full bg-chat-accent ${showHolding ? 'h-14 w-14' : 'h-11 w-11'}`}
                style={Platform.OS === 'web' ? ({ cursor: 'pointer', userSelect: 'none', touchAction: 'none' } as object) : undefined}
              >
                {sending ? <ActivityIndicator color={c.onChatAccent} /> : <Icon icon={Microphone} size={showHolding ? 26 : 20} color={c.onChatAccent} weight="fill" />}
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar"
              accessibilityState={{ disabled: !ready, busy }}
              onPress={ready ? () => void send() : undefined}
              className={`h-11 w-11 items-center justify-center rounded-full bg-chat-accent ${ready ? '' : 'opacity-30'}`}
            >
              {busy ? <ActivityIndicator color={c.onChatAccent} /> : <Icon icon={ArrowUp} size={20} color={c.onChatAccent} weight="bold" />}
            </Pressable>
          )}
        </View>
      )}
      <Modal visible={sheet} transparent animationType="fade" onRequestClose={() => setSheet(false)}>
        <Pressable style={themed} accessibilityLabel="Cerrar" onPress={() => setSheet(false)} className="flex-1 justify-end bg-black/40 px-3 pb-24">
          <View testID="attach-sheet" className="flex-row justify-around rounded-2xl bg-card px-2 py-4">
            {(
              [
                ['document', 'Documento', FileText, '#7F77DD'],
                ['photos', 'Fotos', ImageSquare, '#D4537E'],
                ['camera', 'Cámara', Camera, '#D85A30'],
              ] as const
            ).map(([kind, label, icon, colour]) => (
              <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => {
                  setSheet(false);
                  onAttach?.(kind);
                }}
                className="items-center active:opacity-60"
              >
                <View className="h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: colour }}>
                  <Icon icon={icon} size={26} color="#ffffff" weight="fill" />
                </View>
                <Text className="mt-1.5 text-footnote text-ink">{label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
      {emoji && mode === 'idle' ? (
        <View className="-mx-2 mt-2">
          <EmojiPicker onPick={(e) => setText((t) => t + e)} />
        </View>
      ) : null}
    </View>
  );
}

/** The latest levels as bars, newest on the right, while recording. */
function LiveWave({ levels, colour }: { levels: number[]; colour: string }) {
  return (
    <View className="h-6 flex-1 flex-row items-center justify-end gap-[2px] overflow-hidden" accessibilityElementsHidden>
      {levels.map((l, i) => (
        <View key={i} style={{ width: 2.5, height: Math.max(3, l * 22), borderRadius: 2, backgroundColor: colour }} />
      ))}
    </View>
  );
}

/** What someone who can't write sees instead of the text box, with why («Pide acceso a Ana», «La abrió Ana»). */
export function ReadOnlyComposer({ note }: { note: string | null }) {
  const insets = useSafeAreaInsets();
  const c = usePalette();
  return (
    <View className="border-t border-line bg-surface px-4 pt-3" style={{ paddingBottom: Math.max(16, insets.bottom) }}>
      <View className="flex-row items-center justify-center rounded-3xl bg-sunk px-4 py-3">
        <Icon icon={Eye} size={18} color={c.muted} weight="regular" />
        <Text className="ml-2 text-center text-footnote text-muted">Solo lectura{note ? `. ${note}` : ''}</Text>
      </View>
    </View>
  );
}
