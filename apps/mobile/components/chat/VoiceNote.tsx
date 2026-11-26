import type { VoicePart } from '@ghostaff/shared';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { AudioClip } from '@/components/chat/AudioClip';

// A voice note inside its bubble (voice.md): the player (AudioClip); under it,
// the transcript, which is what the agent read.

/** Past this, a note still «pending» was left behind (the app closed before asking): it can be asked again. */
const STALE_MS = 3 * 60_000;

const LABELS = { play: 'Escuchar nota de voz', pause: 'Pausar nota de voz', position: 'Posición en la nota' };

export function VoiceNote({
  part,
  transcript,
  createdAt,
  onRetry,
}: {
  part: VoicePart;
  /** The text part that follows the audio, once transcribed. */
  transcript: string;
  createdAt: string;
  /** Asks for the transcript again; without it there is no «Reintentar». */
  onRetry?: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);

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
    <View style={{ minWidth: 220 }}>
      <AudioClip path={part.path} durationMs={part.durationMs} labels={LABELS} />
      {/* What came of the transcript is announced as it changes. */}
      <View aria-live="polite">
        {part.transcription === 'done' && transcript ? (
          <Text className="mt-2 text-base leading-6 text-on-accent" selectable>
            {transcript}
          </Text>
        ) : part.transcription === 'empty' ? (
          <Text className="mt-2 text-footnote text-on-accent opacity-80">No se ha oído nada.</Text>
        ) : failed ? (
          <View className="mt-2 flex-row flex-wrap items-center gap-x-3">
            <Text className="text-footnote text-on-accent opacity-80">No se ha podido transcribir.</Text>
            {onRetry ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Reintentar la transcripción" onPress={() => void retry()} hitSlop={8} className="active:opacity-70">
                <Text className="text-footnote font-semibold text-on-accent underline">Reintentar</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Text className="mt-2 text-footnote text-on-accent opacity-80">Transcribiendo…</Text>
        )}
      </View>
    </View>
  );
}
