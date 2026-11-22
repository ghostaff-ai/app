import { AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

// Dictation (voice.md): record a note, have the engine turn it into text, hand
// the text to the caller. Nothing is kept: the recording is deleted once read
// and the person reviews the text before sending it.

/** A note stops by itself at 10:00, as if «parar» were pressed. */
export const MAX_SECONDS = 600;

/**
 * Speech, not music: mono, 16 kHz, 32 kbit/s. AAC in an .m4a on iOS and
 * Android, WebM/Opus on the web (the browser's own MediaRecorder format). Ten
 * minutes come to about 2.4 MB, far under the engine's 20 MB limit.
 */
export const SPEECH: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

export type DictationState = 'idle' | 'recording' | 'transcribing';

export const DENIED = 'Ghostaff no tiene permiso para usar el micrófono. Actívalo en los ajustes.';
const NOTHING_HEARD = 'No he oído nada. Inténtalo otra vez.';
const FAILED = 'No he podido transcribirlo. Inténtalo otra vez.';
const TOO_LONG = 'La nota es demasiado larga.';
const NOT_RECORDED = 'No he podido grabar. Inténtalo otra vez.';

/** The recording's bytes and real mime type: the web hands over a blob URL (typed), a phone a file path (typed by extension). */
async function readRecording(uri: string): Promise<{ audio: Blob; mimeType: string }> {
  const audio = await (await fetch(uri)).blob();
  const byExtension = /\.webm$/i.test(uri) ? 'audio/webm' : 'audio/mp4';
  return { audio, mimeType: audio.type || byExtension };
}

export function useDictation({
  onText,
  transcribe,
}: {
  onText: (text: string) => void;
  transcribe: (audio: Blob, mimeType: string) => Promise<string>;
}) {
  const recorder = useAudioRecorder(SPEECH);
  const [state, setState] = useState<DictationState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // What the callbacks below need to see now, not as of the render that made them.
  const phase = useRef<DictationState>('idle');
  const clock = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);
  const latest = useRef({ onText, transcribe });
  latest.current = { onText, transcribe };

  const go = (next: DictationState) => {
    phase.current = next;
    if (alive.current) setState(next);
  };
  const stopClock = () => {
    if (clock.current) clearInterval(clock.current);
    clock.current = null;
  };
  const discardFile = (uri: string | null) => {
    if (uri && !uri.startsWith('blob:')) {
      try {
        new File(uri).delete();
      } catch {
        // The system clears its cache on its own.
      }
    }
  };
  const release = () => setAudioModeAsync({ allowsRecording: false }).catch(() => {});

  const stop = useCallback(async () => {
    if (phase.current !== 'recording') return;
    stopClock();
    go('transcribing');
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
      void release();
      if (!uri) throw new Error('no recording');
      const { audio, mimeType } = await readRecording(uri);
      const text = (await latest.current.transcribe(audio, mimeType)).trim();
      if (!alive.current) return;
      if (text) latest.current.onText(text);
      else setError(NOTHING_HEARD);
    } catch (e) {
      if (alive.current) setError((e as { code?: string }).code === 'too_large' ? TOO_LONG : FAILED);
    } finally {
      discardFile(uri);
      go('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder]);

  const start = useCallback(async () => {
    if (phase.current !== 'idle') return;
    setError(null);
    phase.current = 'recording'; // claimed now so a second press can't start another
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        phase.current = 'idle';
        setError(DENIED);
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      phase.current = 'idle';
      void release();
      if (alive.current) setError(NOT_RECORDED);
      return;
    }
    if (!alive.current) {
      // Left the screen while asking: the cleanup ran before there was anything to stop.
      phase.current = 'idle';
      recorder.stop().catch(() => {}).finally(() => discardFile(recorder.uri));
      void release();
      return;
    }
    const began = Date.now();
    setSeconds(0);
    setState('recording');
    clock.current = setInterval(() => {
      const s = Math.min(MAX_SECONDS, Math.floor((Date.now() - began) / 1000));
      setSeconds(s);
      if (s >= MAX_SECONDS) void stop();
    }, 250);
  }, [recorder, stop]);

  const cancel = useCallback(async () => {
    if (phase.current !== 'recording') return;
    stopClock();
    go('idle');
    setSeconds(0);
    try {
      await recorder.stop();
    } catch {
      // Nothing to keep either way.
    }
    discardFile(recorder.uri);
    void release();
  }, [recorder]);

  // Leaving the screen mid-note stops and discards it.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopClock();
      if (phase.current === 'recording') {
        phase.current = 'idle';
        recorder.stop().catch(() => {}).finally(() => discardFile(recorder.uri));
        void release();
      }
    };
  }, [recorder]);

  return { state, seconds, error, start, stop, cancel };
}
