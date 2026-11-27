import type { VoicePart } from '@ghostaff/shared';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AudioClip } from '@/components/chat/AudioClip';

// A voice note in its bubble, as in WhatsApp (chat-like-whatsapp.md): the
// player (AudioClip: waveform, seek, speed, the unplayed dot) and, under it,
// the transcript, which is what the agent read: one tap away in an agent's
// chat, out of sight in General (decision 5). A failure shows unasked.

/** Past this, a note still «pending» was left behind (the app closed before asking): it can be asked again. */
const STALE_MS = 3 * 60_000;

const LABELS = { play: 'Escuchar nota de voz', pause: 'Pausar nota de voz', position: 'Posición en la nota' };

const TONES = { mine: { text: 'text-on-accent', clip: 'accent' }, theirs: { text: 'text-ink', clip: 'card' } } as const;

export function VoiceNote({
  part,
  messageId: _messageId,
  transcript,
  createdAt,
  onRetry,
  tone = 'mine',
  unplayed = false,
}: {
  part: VoicePart;
  messageId: string;
  /** The text part after the audio; null keeps the transcript out of sight (General). */
  transcript: string | null;
  createdAt: string;
  /** Asks for the transcript again; without it there is no «Reintentar». */
  onRetry?: () => Promise<void>;
  tone?: keyof typeof TONES;
  /** Someone else's note that arrived since the person last read the chat: a dot until played. */
  unplayed?: boolean;
}) {
  const t = TONES[tone];
  const [retrying, setRetrying] = useState(false);
  const [open, setOpen] = useState(false);

  // Once the transcript arrives, «Reintentar» is done.
  useEffect(() => {
    if (part.transcription !== 'pending') setRetrying(false);
  }, [part.transcription]);

  const retry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    await onRetry().catch(() => setRetrying(false));
  };

  const stale = part.transcription === 'pending' && Date.now() - new Date(createdAt).getTime() > STALE_MS;
  const failed = (part.transcription === 'failed' || stale) && !retrying;

  return (
    <View style={{ minWidth: 230 }}>
      <AudioClip path={part.path} durationMs={part.durationMs} labels={LABELS} tone={t.clip} waveform={part.waveform} unplayed={unplayed} />
      {transcript !== null || failed ? (
        <View aria-live="polite">
          {failed ? (
            <View className="mt-1 flex-row flex-wrap items-center gap-x-3">
              <Text className={`text-footnote ${t.text} opacity-80`}>No se ha podido transcribir.</Text>
              {onRetry ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Reintentar la transcripción" onPress={() => void retry()} hitSlop={8} className="active:opacity-70">
                  <Text className={`text-footnote font-semibold ${t.text} underline`}>Reintentar</Text>
                </Pressable>
              ) : null}
            </View>
          ) : open ? (
            part.transcription === 'done' && transcript ? (
              <Text className={`mt-1 text-[15px] leading-[21px] ${t.text}`} selectable>
                {transcript}
              </Text>
            ) : (
              <Text className={`mt-1 text-footnote ${t.text} opacity-80`}>{part.transcription === 'empty' ? 'No se ha oído nada.' : 'Transcribiendo…'}</Text>
            )
          ) : (
            <Pressable accessibilityRole="button" accessibilityLabel="Ver transcripción" onPress={() => setOpen(true)} hitSlop={8} className="mt-0.5 self-start active:opacity-70">
              <Text className={`text-footnote ${t.text} opacity-70`}>Transcripción</Text>
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}
