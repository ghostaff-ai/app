import { AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

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

/** Between the press and the first sound: permission, audio session, prepare. Internal; the screen sees it as idle. */
type Phase = DictationState | 'starting';

export const DENIED = 'Ghostaff no tiene permiso para usar el micrófono. Actívalo en los ajustes.';
const NOTHING_HEARD = 'No he oído nada. Inténtalo otra vez.';
const TOO_MANY = 'Has dictado mucho en la última hora. Espera un poco.';
const FAILED = 'No he podido transcribirlo. Inténtalo otra vez.';
const TOO_LONG = 'La nota es demasiado larga.';
const NOT_RECORDED = 'No he podido grabar. Inténtalo otra vez.';

/**
 * The recording's bytes and the type to send. A phone's file is always what the
 * preset writes (AAC in an .m4a, `audio/mp4`): the file read may call it
 * `audio/x-m4a`, which Vertex doesn't list. The web hands over a typed blob URL.
 */
async function readRecording(uri: string): Promise<{ audio: Blob; mimeType: string }> {
  const audio = await (await fetch(uri)).blob();
  return { audio, mimeType: uri.startsWith('blob:') ? audio.type || 'audio/webm' : 'audio/mp4' };
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
  const [canRetry, setCanRetry] = useState(false);

  // What the callbacks below need to see now, not as of the render that made them.
  const phase = useRef<Phase>('idle');
  const clock = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);
  /** A recording whose transcription failed: in memory only (the file is already deleted), for «Reintentar». */
  const kept = useRef<{ audio: Blob; mimeType: string } | null>(null);
  const latest = useRef({ onText, transcribe });
  latest.current = { onText, transcribe };

  const go = (next: Phase) => {
    phase.current = next;
    if (alive.current) setState(next === 'starting' ? 'idle' : next);
  };
  const drop = () => {
    kept.current = null;
    if (alive.current) setCanRetry(false);
  };
  const stopClock = () => {
    if (clock.current) clearInterval(clock.current);
    clock.current = null;
  };
  const discardFile = (uri: string | null) => {
    if (!uri) return;
    if (uri.startsWith('blob:')) {
      URL.revokeObjectURL(uri); // the web's recording lives in memory until released
    } else {
      try {
        new File(uri).delete();
      } catch {
        // The system clears its cache on its own.
      }
    }
  };
  const release = () => setAudioModeAsync({ allowsRecording: false }).catch(() => {});

  /** Sends a recording to be transcribed; on a failure (not silence) it is kept for a retry. */
  const transcribeNote = async (note: { audio: Blob; mimeType: string }) => {
    try {
      const text = (await latest.current.transcribe(note.audio, note.mimeType)).trim();
      if (!alive.current) return;
      drop();
      if (text) latest.current.onText(text);
      else setError(NOTHING_HEARD);
    } catch (e) {
      if (!alive.current) return;
      const code = (e as { code?: string }).code;
      setError(code === 'too_large' ? TOO_LONG : code === 'too_many' ? TOO_MANY : FAILED);
      if (code !== 'too_large') {
        kept.current = note;
        setCanRetry(true);
      } else drop();
    }
  };

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
      const note = await readRecording(uri);
      discardFile(uri); // read into memory: the file is not needed any more
      uri = null;
      await transcribeNote(note);
    } catch {
      if (alive.current) setError(FAILED);
    } finally {
      discardFile(uri);
      go('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder]);

  const retry = useCallback(async () => {
    const note = kept.current;
    if (phase.current !== 'idle' || !note) return;
    setError(null);
    go('transcribing');
    try {
      await transcribeNote(note);
    } finally {
      go('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    if (phase.current !== 'idle') return;
    setError(null);
    drop();
    // Claimed now so a second press can't start another, and so that the
    // background event Android's permission dialog causes finds nothing to stop.
    phase.current = 'starting';
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        phase.current = 'idle';
        if (alive.current) setError(DENIED);
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
    if (!alive.current || phase.current !== 'starting') {
      // Left the screen while asking: nothing is listening to this recording.
      phase.current = 'idle';
      recorder.stop().catch(() => {}).finally(() => discardFile(recorder.uri));
      void release();
      return;
    }
    const began = Date.now();
    setSeconds(0);
    go('recording');
    // The recorder's own clock and state, not JS time: a call or another app
    // taking the microphone stops it, and what it has is then transcribed.
    clock.current = setInterval(() => {
      const status = recorder.getStatus();
      const stopped = !status.isRecording && Date.now() - began > 1000;
      const s = Math.min(MAX_SECONDS, Math.floor(status.durationMillis / 1000));
      setSeconds(s);
      if (stopped || s >= MAX_SECONDS) void stop();
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, stop]);

  const cancel = useCallback(async () => {
    if (phase.current !== 'recording') return;
    stopClock();
    go('idle');
    setSeconds(0);
    drop();
    try {
      await recorder.stop();
    } catch {
      // Nothing to keep either way.
    }
    discardFile(recorder.uri);
    void release();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder]);

  const clearError = useCallback(() => {
    setError(null);
    drop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recording happens only while the app is open: going to the background
  // stops the note and transcribes what there is (never sent). While starting
  // there is nothing to stop yet (Android's permission dialog sends the app there).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') void stop();
    });
    return () => sub.remove();
  }, [stop]);

  // Leaving the screen mid-note stops and discards it.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopClock();
      kept.current = null;
      if (phase.current === 'recording') {
        phase.current = 'idle';
        recorder.stop().catch(() => {}).finally(() => discardFile(recorder.uri));
        void release();
      }
    };
  }, [recorder]);

  return { state, seconds, error, canRetry, start, stop, cancel, retry, clearError };
}
