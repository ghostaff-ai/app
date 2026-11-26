import { type AudioPlayer, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import { clock } from '@/components/chat/RecordingBar';
import { Icon, Pause, Play } from '@/components/icons';
import { voiceNoteLink } from '@/lib/hooks/useChat';
import { usePalette } from '@/lib/theme';

// An audio in the chat, whoever made it (voice.md, agent-audio.md): play or
// pause, a bar to jump along it, its length. The audio is fetched on the first
// play, through a short-lived link to the private bucket; one plays at a time.
// A person's voice note wraps it with its transcript (VoiceNote), an agent's
// audio with its title (AgentAudio).

/** One audio plays at a time, as in any messenger. */
let playing: AudioPlayer | null = null;

/** On the person's accent bubble, or on a card in the page's colours. */
export type AudioTone = 'accent' | 'card';

const TONES = {
  accent: { ring: 'border-on-accent', bar: 'bg-on-accent', text: 'text-on-accent' },
  card: { ring: 'border-ink', bar: 'bg-ink', text: 'text-ink' },
} as const;

export function AudioClip({
  path,
  durationMs,
  labels,
  tone = 'accent',
}: {
  /** In the «voice-notes» bucket. */
  path: string;
  /** Shown until the audio has loaded and knows its own; null when unknown. */
  durationMs: number | null;
  /** What a screen reader says: «Escuchar nota de voz», «Pausar…», «Posición en la nota». */
  labels: { play: string; pause: string; position: string };
  tone?: AudioTone;
}) {
  const c = usePalette();
  const t = TONES[tone];
  const iconColor = tone === 'accent' ? c.onAccent : c.ink;
  const player = useAudioPlayer(null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [source, setSource] = useState<'none' | 'loading' | 'ready' | 'failed'>('none');
  const [width, setWidth] = useState(0);
  const pending = useRef(false);

  // An audio that played to the end starts over on the next tap.
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

  const total = status.duration > 0 ? status.duration : (durationMs ?? 0) / 1000;
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
        player.replace({ uri: await voiceNoteLink(path) });
        setSource('ready');
      } catch {
        setSource('failed');
        return;
      } finally {
        pending.current = false;
      }
    }
    // iPhone: heard even with the ringer switched off, as an audio one chose to play.
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    player.play();
  };

  const seek = (x: number) => {
    if (source !== 'ready' || width <= 0 || total <= 0) return;
    void player.seekTo(Math.max(0, Math.min(1, x / width)) * total);
  };
  const step = (by: number) => seek(((at + by) / (total || 1)) * width);

  return (
    <View className="flex-row items-center gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? labels.pause : labels.play}
        onPress={() => void toggle()}
        hitSlop={8}
        className={`h-11 w-11 items-center justify-center rounded-full border ${t.ring} active:opacity-70`}
      >
        {source === 'loading' ? (
          <ActivityIndicator color={iconColor} />
        ) : (
          <Icon icon={status.playing ? Pause : Play} size={20} color={iconColor} weight="fill" />
        )}
      </Pressable>
      <View className="flex-1">
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={labels.position}
          accessibilityValue={{ text: `${clock(Math.floor(at))} de ${clock(Math.round(total))}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 5 : -5)}
          onPress={(e) => seek(e.nativeEvent.locationX)}
          onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
          className="h-6 justify-center"
        >
          <View className={`absolute inset-x-0 h-1 rounded-full ${t.bar} opacity-30`} />
          <View className={`h-1 rounded-full ${t.bar}`} style={{ width: total > 0 ? `${(at / total) * 100}%` : '0%' }} />
        </Pressable>
        <Text className={`text-caption ${t.text} opacity-80`} style={{ fontVariant: ['tabular-nums'] }}>
          {source === 'failed' ? 'No se puede reproducir aquí' : total > 0 ? clock(Math.round(started ? at : total)) : '–:––'}
        </Text>
      </View>
    </View>
  );
}
