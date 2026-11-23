import type { VoicePart } from '@ghostaff/shared';
import { type AudioPlayer, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import { clock } from '@/components/chat/RecordingBar';
import { Icon, Pause, Play } from '@/components/icons';
import { voiceNoteLink } from '@/lib/hooks/useChat';
import { usePalette } from '@/lib/theme';

// A voice note inside its bubble (voice.md): play or pause, a bar to jump
// along it, its length; under it, the transcript, which is what the agent read.
// The audio is fetched on the first play, through a short-lived link.

/** Past this, a note still «pending» was left behind (the app closed before asking): it can be asked again. */
const STALE_MS = 3 * 60_000;

/** One note plays at a time, as in any messenger. */
let playing: AudioPlayer | null = null;

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
  const c = usePalette();
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [source, setSource] = useState<'none' | 'loading' | 'ready' | 'failed'>('none');
  const [retrying, setRetrying] = useState(false);
  const [width, setWidth] = useState(0);
  const pending = useRef(false);

  // A note that played to the end starts over on the next tap.
  useEffect(() => {
    if (status.didJustFinish) {
      player.pause();
      void player.seekTo(0);
    }
  }, [status.didJustFinish, player]);

  useEffect(
    () => () => {
      if (playing === player) playing = null;
    },
    [player],
  );

  // Once the transcript arrives, «Reintentar» is done.
  useEffect(() => {
    if (part.transcription !== 'pending') setRetrying(false);
  }, [part.transcription]);

  const total = status.duration > 0 ? status.duration : (part.durationMs ?? 0) / 1000;
  const at = Math.min(status.currentTime, total);
  const started = status.playing || at > 0;

  const toggle = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (pending.current) return;
    if (playing && playing !== player) playing.pause();
    playing = player;
    if (source !== 'ready') {
      pending.current = true;
      setSource('loading');
      try {
        player.replace({ uri: await voiceNoteLink(part.path) });
        setSource('ready');
      } catch {
        setSource('failed');
        return;
      } finally {
        pending.current = false;
      }
    }
    // iPhone: heard even with the ringer switched off, as a note one chose to play.
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    player.play();
  };

  const seek = (x: number) => {
    if (source !== 'ready' || width <= 0 || total <= 0) return;
    void player.seekTo(Math.max(0, Math.min(1, x / width)) * total);
  };
  const step = (by: number) => seek(((at + by) / (total || 1)) * width);

  const retry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    await onRetry().catch(() => setRetrying(false));
  };

  const stale = part.transcription === 'pending' && Date.now() - new Date(createdAt).getTime() > STALE_MS;
  const failed = (part.transcription === 'failed' || stale) && !retrying;

  return (
    <View style={{ minWidth: 220 }}>
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pausar nota de voz' : 'Escuchar nota de voz'}
          onPress={() => void toggle()}
          hitSlop={8}
          className="h-11 w-11 items-center justify-center rounded-full border border-on-accent active:opacity-70"
        >
          {source === 'loading' ? (
            <ActivityIndicator color={c.onAccent} />
          ) : (
            <Icon icon={status.playing ? Pause : Play} size={20} color={c.onAccent} weight="fill" />
          )}
        </Pressable>
        <View className="flex-1">
          <Pressable
            accessibilityRole="adjustable"
            accessibilityLabel="Posición en la nota"
            accessibilityValue={{ text: `${clock(Math.floor(at))} de ${clock(Math.round(total))}` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 5 : -5)}
            onPress={(e) => seek(e.nativeEvent.locationX)}
            onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
            className="h-6 justify-center"
          >
            <View className="absolute inset-x-0 h-1 rounded-full bg-on-accent opacity-30" />
            <View className="h-1 rounded-full bg-on-accent" style={{ width: total > 0 ? `${(at / total) * 100}%` : '0%' }} />
          </Pressable>
          <Text className="text-caption text-on-accent opacity-80" style={{ fontVariant: ['tabular-nums'] }}>
            {source === 'failed' ? 'No se puede reproducir aquí' : clock(Math.round(started ? at : total))}
          </Text>
        </View>
      </View>
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
