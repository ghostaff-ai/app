import { type AudioPlayer, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, type LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { clock } from '@/components/chat/RecordingBar';
import { Icon, Pause, Play } from '@/components/icons';
import { voiceNoteLink } from '@/lib/hooks/useChat';
import { usePalette } from '@/lib/theme';

// An audio in the chat, whoever made it (voice.md, agent-audio.md), as in
// WhatsApp (chat-like-whatsapp.md): play, its waveform (drag along it to
// jump), the length, the speed (1×, 1.5×, 2×) once playing and, on someone
// else's you haven't played, a dot. The audio is fetched on the first play,
// through a short-lived link to the private bucket; one plays at a time. A
// person's voice note wraps it with its transcript (VoiceNote), an agent's
// audio with its title (AgentAudio).

/** One audio plays at a time, as in any messenger. */
let playing: AudioPlayer | null = null;
/** The speed chosen, for every audio this session, as WhatsApp keeps it. */
let speed = 1;
const SPEEDS = [1, 1.5, 2];
/** Audios played this session: their dot goes. */
const played = new Set<string>();
const BARS = 36;

/** In your own bubble, or on a card in the page's colours. Both draw in the chat's violet. */
export type AudioTone = 'mine' | 'card';

/** The length's colour; the play button, bars and speed pill are the chat accent in both. */
const TONES = {
  mine: { text: 'text-mine-muted' },
  card: { text: 'text-muted' },
} as const;

/** The bars to draw: the audio's own levels, or, without them (an agent's, an older note), a steady shape from `seed`. */
export function barsOf(waveform: number[] | undefined, seed: string): number[] {
  if (waveform?.length) {
    const out: number[] = [];
    for (let i = 0; i < BARS; i++) out.push(waveform[Math.floor((i * waveform.length) / BARS)] ?? 0);
    return out.map((l) => 0.15 + 0.85 * Math.max(0, Math.min(1, l)));
  }
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: BARS }, (_, i) => {
    h = (h * 1103515245 + 12345 + i) >>> 0;
    return 0.25 + (0.6 * ((h >>> 8) % 100)) / 100;
  });
}

export function AudioClip({
  path,
  durationMs,
  labels,
  tone = 'mine',
  waveform,
  unplayed = false,
  stamp,
}: {
  /** In the «voice-notes» bucket; also what the steady shape and «played» go by. */
  path: string;
  /** Shown until the audio has loaded and knows its own; null when unknown. */
  durationMs: number | null;
  /** What a screen reader says: «Escuchar nota de voz», «Pausar…», «Posición en la nota». */
  labels: { play: string; pause: string; position: string };
  tone?: AudioTone;
  /** How loud it was, 0 to 1, when the recorder measured it. */
  waveform?: number[];
  /** Someone else's that arrived since the person last read the chat: a dot until played. */
  unplayed?: boolean;
  /** The bubble's time and ticks: drawn at the right end of the length's row. */
  stamp?: ReactNode;
}) {
  const c = usePalette();
  const t = TONES[tone];
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const [source, setSource] = useState<'none' | 'loading' | 'ready' | 'failed'>('none');
  const [rate, setRate] = useState(speed);
  const [heard, setHeard] = useState(played.has(path));
  const width = useRef(0);
  const pending = useRef(false);
  const bars = useMemo(() => barsOf(waveform, path), [waveform, path]);

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
  const progress = total > 0 ? at / total : 0;

  /** Loads the audio once, through a link valid for an hour. */
  const load = async (): Promise<boolean> => {
    if (source === 'ready') return true;
    if (pending.current) return false;
    pending.current = true;
    setSource('loading');
    try {
      player.replace({ uri: await voiceNoteLink(path) });
      setSource('ready');
      return true;
    } catch {
      setSource('failed');
      return false;
    } finally {
      pending.current = false;
    }
  };

  const toggle = async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (playing && playing !== player) playing.pause();
    playing = player;
    if (!(await load())) return;
    // iPhone: heard even with the ringer switched off, as an audio one chose to play.
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => {});
    player.setPlaybackRate(speed);
    player.play();
    played.add(path);
    setHeard(true);
  };

  const seekTo = async (fraction: number) => {
    if (total <= 0 || !(await load())) return;
    void player.seekTo(Math.max(0, Math.min(1, fraction)) * total);
  };

  // Drag along the waveform to jump, as in WhatsApp.
  const drag = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => void seekTo(e.nativeEvent.locationX / (width.current || 1)),
        onPanResponderMove: (e) => void seekTo(e.nativeEvent.locationX / (width.current || 1)),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [total, source],
  );

  const nextSpeed = () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
    setRate(speed);
    if (status.playing) player.setPlaybackRate(speed);
  };

  const showDot = unplayed && !heard;

  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? labels.pause : labels.play}
        onPress={() => void toggle()}
        hitSlop={8}
        className="h-[34px] w-[34px] items-center justify-center rounded-full bg-chat-accent active:opacity-70"
      >
        {source === 'loading' ? <ActivityIndicator color={c.onChatAccent} /> : <Icon icon={status.playing ? Pause : Play} size={15} color={c.onChatAccent} weight="fill" />}
      </Pressable>
      <View className="flex-1">
        <View
          {...drag.panHandlers}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={labels.position}
          accessibilityValue={{ text: `${clock(Math.floor(at))} de ${clock(Math.round(total))}` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => void seekTo((at + (e.nativeEvent.actionName === 'increment' ? 5 : -5)) / (total || 1))}
          onLayout={(e: LayoutChangeEvent) => {
            width.current = e.nativeEvent.layout.width;
          }}
          className="h-7 flex-row items-center justify-between"
        >
          {bars.map((h, i) => {
            const done = (i + 0.5) / bars.length <= progress;
            return (
              <View
                key={i}
                style={{ width: 2.5, height: Math.max(3, h * 26), borderRadius: 2, backgroundColor: c.chatAccent, opacity: done ? 1 : 0.35 }}
              />
            );
          })}
        </View>
        <View testID="voice-meta" className="mt-0.5 flex-row items-center">
          <Text className={`text-[11px] ${t.text}`} style={{ fontVariant: ['tabular-nums'] }}>
            {source === 'failed' ? 'No se puede reproducir aquí' : total > 0 ? clock(Math.round(started ? at : total)) : '–:––'}
          </Text>
          {showDot ? <View testID="voice-unplayed" className="ml-1.5 h-2 w-2 rounded-full bg-chat-accent" /> : null}
          {stamp ? <View className="ml-auto pl-2">{stamp}</View> : null}
        </View>
      </View>
      {started ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Velocidad ${rate}×, cambiar`} onPress={nextSpeed} hitSlop={8} className="min-w-9 items-center overflow-hidden rounded-full px-2 py-0.5 active:opacity-70">
          <View style={[StyleSheet.absoluteFill, { backgroundColor: c.chatAccent, opacity: 0.15 }]} />
          <Text className={`text-[12px] font-semibold text-chat-accent`}>{rate === 1.5 ? '1,5×' : `${rate}×`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
