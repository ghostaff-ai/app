import { completeMention, mentionQuery, mentionSuggestions } from '@ghostaff/shared';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, TextInput, type TextInputInstance, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DictationBar } from '@/components/chat/DictationBar';
import { ArrowUp, Eye, Icon, Microphone, Stop } from '@/components/icons';
import { tap } from '@/lib/haptics';
import { appendDictation } from '@/lib/chat';
import { useDictation } from '@/lib/hooks/useDictation';
import { usePalette } from '@/lib/theme';

// Where a person writes in a thread (team-chat.md): a growing text box and a
// round send button; typing @ offers the agents and people that can be
// mentioned. With «onDictate», the round button is the mic while the box is
// empty (speak, and the text lands in the box to review; nothing is sent on its
// own) and send once there is text. With «Ver» it turns into a quiet line
// saying who to ask.

export function Composer({
  placeholder,
  names,
  onSend,
  autoFocus,
  onDictate,
}: {
  placeholder: string;
  /** What @ can complete to. */
  names: string[];
  /** Resolves once sent; a rejection keeps the text so nothing is lost. */
  onSend: (text: string) => Promise<void>;
  autoFocus?: boolean;
  /** Turns a recorded note into text; without it there is no mic. */
  onDictate?: (audio: Blob, mimeType: string) => Promise<string>;
}) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<TextInputInstance>(null);
  const focusWhenBack = useRef(false);

  const dictation = useDictation({
    onText: (t) => {
      setText((prev) => appendDictation(prev, t));
      focusWhenBack.current = true;
    },
    transcribe: onDictate ?? (() => Promise.reject(new Error('dictation is off'))),
  });
  const dictating = dictation.state !== 'idle';
  // The box is out of the tree while dictating: focus it once it is back.
  useEffect(() => {
    if (!dictating && focusWhenBack.current) {
      focusWhenBack.current = false;
      input.current?.focus();
    }
  }, [dictating]);
  const mic = onDictate !== undefined && text.trim().length === 0 && !busy;

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
      {error || dictation.error ? <Text className="mb-1 ml-2 text-footnote text-no">{error ? `No se ha enviado. ${error}` : dictation.error}</Text> : null}
      <View className="flex-row items-end gap-2">
        {dictating ? (
          <DictationBar recording={dictation.state === 'recording'} seconds={dictation.seconds} onCancel={() => void dictation.cancel()} />
        ) : (
          <TextInput
            ref={input}
            accessibilityLabel={placeholder}
            placeholder={placeholder}
            placeholderTextColor={c.muted}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus={autoFocus}
            maxLength={8000}
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
        {dictation.state === 'recording' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Parar y transcribir"
            onPress={() => void dictation.stop()}
            className="h-11 w-11 items-center justify-center rounded-full bg-accent"
          >
            <Icon icon={Stop} size={20} color={c.onAccent} weight="fill" />
          </Pressable>
        ) : dictation.state === 'transcribing' ? (
          <View className="h-11 w-11 items-center justify-center rounded-full bg-accent opacity-30" accessibilityState={{ disabled: true }}>
            <Icon icon={Microphone} size={20} color={c.onAccent} weight="bold" />
          </View>
        ) : mic ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dictar"
            onPress={() => void dictation.start()}
            className="h-11 w-11 items-center justify-center rounded-full bg-accent"
          >
            <Icon icon={Microphone} size={20} color={c.onAccent} weight="bold" />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar"
            accessibilityState={{ disabled: !ready, busy }}
            onPress={ready ? () => void send() : undefined}
            className={`h-11 w-11 items-center justify-center rounded-full bg-accent ${ready ? '' : 'opacity-30'}`}
          >
            {busy ? <ActivityIndicator color={c.onAccent} /> : <Icon icon={ArrowUp} size={20} color={c.onAccent} weight="bold" />}
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** What someone with «Ver» sees instead of the text box. */
export function ReadOnlyComposer({ owner }: { owner: string | null }) {
  const insets = useSafeAreaInsets();
  const c = usePalette();
  return (
    <View className="border-t border-line bg-surface px-4 pt-3" style={{ paddingBottom: Math.max(16, insets.bottom) }}>
      <View className="flex-row items-center justify-center rounded-3xl bg-sunk px-4 py-3">
        <Icon icon={Eye} size={18} color={c.muted} weight="regular" />
        <Text className="ml-2 text-center text-footnote text-muted">Solo lectura{owner ? `. Pide acceso a ${owner}` : ''}</Text>
      </View>
    </View>
  );
}
