import { completeMention, mentionQuery, mentionSuggestions } from '@ghostaff/shared';
import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, type TextInputInstance, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RecordingBar } from '@/components/chat/RecordingBar';
import { ArrowUp, Eye, Icon, Microphone } from '@/components/icons';
import { tap } from '@/lib/haptics';
import { type RecordedNote, useVoiceNote } from '@/lib/hooks/useVoiceNote';
import { usePalette } from '@/lib/theme';

// Where a person writes in a thread (team-chat.md): a growing text box and a
// round send button; typing @ offers the agents and people that can be
// mentioned. With «onVoiceNote», a plain round mic sits beside send: tap it,
// speak, and send the voice note (voice.md). With «Ver», or in a conversation
// its opener keeps to reading, it turns into a quiet line saying why.

/** What the database takes in one message (post_message). */
const MAX_LENGTH = 8000;

export function Composer({
  placeholder,
  names,
  onSend,
  autoFocus,
  onVoiceNote,
}: {
  placeholder: string;
  /** What @ can complete to. */
  names: string[];
  /** Resolves once sent; a rejection keeps the text so nothing is lost. */
  onSend: (text: string) => Promise<void>;
  autoFocus?: boolean;
  /** Sends a recorded voice note; without it there is no mic. A rejection keeps the note to send again. */
  onVoiceNote?: (note: RecordedNote) => Promise<void>;
}) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInputInstance>(null);

  const voice = useVoiceNote({ send: onVoiceNote ?? (() => Promise.reject(new Error('voice notes are off'))) });
  const recording = voice.state !== 'idle';
  const mic = onVoiceNote !== undefined && !busy;

  const query = mentionQuery(text);
  const suggestions = query === null ? [] : mentionSuggestions(query, names);
  const ready = text.trim().length > 0 && !busy;

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

  return (
    <View className="border-t border-line bg-surface px-3 pt-2" style={{ paddingBottom: Math.max(12, insets.bottom) }}>
      {suggestions.length > 0 ? (
        <View className="mb-2 flex-row flex-wrap gap-2" accessibilityLabel="Mencionar a">
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
      {error ? <Text className="mb-1 ml-2 text-footnote text-no">No se ha enviado. {error}</Text> : null}
      {voice.error ? (
        <View className="mb-1 ml-2 flex-row flex-wrap items-center gap-x-3">
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
      <View className="flex-row items-end gap-2">
        {recording ? (
          <RecordingBar recording={voice.state === 'recording'} seconds={voice.seconds} onCancel={() => void voice.cancel()} />
        ) : (
          <TextInput
            ref={input}
            accessibilityLabel={placeholder}
            placeholder={placeholder}
            placeholderTextColor={c.muted}
            value={text}
            onChangeText={(t) => {
              setText(t);
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
            className="max-h-36 min-h-11 flex-1 rounded-3xl border border-line bg-card px-4 py-2.5 text-base text-ink"
            textAlignVertical="center"
          />
        )}
        {voice.state === 'recording' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar nota de voz"
            onPress={() => void voice.finish()}
            className="h-11 w-11 items-center justify-center rounded-full bg-accent"
          >
            <Icon icon={ArrowUp} size={20} color={c.onAccent} weight="bold" />
          </Pressable>
        ) : voice.state === 'sending' ? (
          <View className="h-11 w-11 items-center justify-center rounded-full bg-accent opacity-30" accessibilityState={{ disabled: true }}>
            <ActivityIndicator color={c.onAccent} />
          </View>
        ) : (
          <>
            {mic ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Grabar nota de voz"
                onPress={() => void voice.start()}
                className="h-11 w-11 items-center justify-center rounded-full border border-line bg-card active:opacity-70"
              >
                <Icon icon={Microphone} size={20} color={c.ink} weight="bold" />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Enviar"
              accessibilityState={{ disabled: !ready, busy }}
              onPress={ready ? () => void send() : undefined}
              className={`h-11 w-11 items-center justify-center rounded-full bg-accent ${ready ? '' : 'opacity-30'}`}
            >
              {busy ? <ActivityIndicator color={c.onAccent} /> : <Icon icon={ArrowUp} size={20} color={c.onAccent} weight="bold" />}
            </Pressable>
          </>
        )}
      </View>
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
