import { AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

// Voice notes (voice.md), as in WhatsApp: tap the mic, speak, send. The note
// goes to the engine as audio, which keeps it and transcribes it. The file on
// the phone is deleted once read; a note that couldn't go yet stays in memory
// until it is sent or discarded.

/** A note stops by itself at 10:00 and is sent. */
export const MAX_SECONDS = 600;

/** Shorter than this, the mic was tapped by mistake: nothing is sent. */
const MIN_MILLIS = 1000;

/**
 * Speech, not music: mono, 16 kHz, 32 kbit/s, AAC in an .m4a everywhere it can
 * be, so a note recorded on a computer plays on an iPhone. The web asks the
 * browser for AAC in MP4 (Chrome, Safari) and gets its own format where it has
 * none (Firefox's WebM). Ten minutes come to about 2.4 MB, under the engine's 10 MB.
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
  web: { mimeType: 'audio/mp4;codecs=mp4a.40.2', bitsPerSecond: 32000 },
};

export type VoiceNoteState = 'idle' | 'recording' | 'sending';

/** Between the press and the first sound: permission, audio session, prepare. Internal; the screen sees it as idle. */
type Phase = VoiceNoteState | 'starting';

export interface RecordedNote {
  audio: Blob;
  mimeType: string;
  durationMs: number;
}

export const DENIED = 'Ghostaff no tiene permiso para usar el micrófono. Actívalo en los ajustes.';
const NOT_RECORDED = 'No he podido grabar. Inténtalo otra vez.';
const TOO_SHORT = 'La nota es demasiado corta.';
const NOT_SENT = 'No se ha enviado la nota.';
const TOO_MANY = 'Has enviado muchas notas de voz en la última hora. Espera un poco.';
const TOO_LONG = 'La nota es demasiado larga.';
const STOPPED = 'La nota se ha parado sin enviar.';

/**
 * The recording's bytes and the type to send. A phone's file is always what the
 * preset writes (AAC in an .m4a, `audio/mp4`): the file read may call it
 * `audio/x-m4a`. The web hands over a typed blob URL.
 */
async function readRecording(uri: string): Promise<{ audio: Blob; mimeType: string }> {
  const audio = await (await fetch(uri)).blob();
  return { audio, mimeType: uri.startsWith('blob:') ? audio.type || 'audio/webm' : 'audio/mp4' };
}

export function useVoiceNote({ send }: { send: (note: RecordedNote) => Promise<void> }) {
  const recorder = useAudioRecorder(SPEECH);
  const [state, setState] = useState<VoiceNoteState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Whether a note waits to be sent again or discarded. */
  const [held, setHeld] = useState(false);

  // What the callbacks below need to see now, not as of the render that made them.
  const phase = useRef<Phase>('idle');
  const clock = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);
  const lastMillis = useRef(0);
  /** A note that didn't go: in memory only (the file is already deleted), for «Enviar». */
  const kept = useRef<RecordedNote | null>(null);
  const latest = useRef(send);
  latest.current = send;

  const go = (next: Phase) => {
    phase.current = next;
    if (alive.current) setState(next === 'starting' ? 'idle' : next);
  };
  const hold = (note: RecordedNote | null) => {
    kept.current = note;
    if (alive.current) setHeld(note !== null);
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

  /** Sends a note; on a failure it is kept to send again, unless it can never go. */
  const deliver = async (note: RecordedNote) => {
    try {
      await latest.current(note);
      if (!alive.current) return;
      hold(null);
    } catch (e) {
      if (!alive.current) return;
      const code = (e as { code?: string }).code;
      setError(code === 'too_large' ? TOO_LONG : code === 'too_many' ? TOO_MANY : NOT_SENT);
      hold(code === 'too_large' ? null : note);
    }
  };

  /** Stops the recorder and reads the note into memory; null when there is nothing worth keeping. */
  const finishRecording = async (): Promise<RecordedNote | null> => {
    stopClock();
    // The last measure before stopping: after it the recorder reports zero.
    const durationMs = Math.max(lastMillis.current, recorder.getStatus().durationMillis || 0);
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
      void release();
      if (!uri) throw new Error('no recording');
      if (durationMs < MIN_MILLIS) {
        if (alive.current) setError(TOO_SHORT);
        return null;
      }
      return { ...(await readRecording(uri)), durationMs };
    } catch {
      if (alive.current) setError(NOT_RECORDED);
      return null;
    } finally {
      discardFile(uri); // read into memory, or not worth keeping
    }
  };

  /** «Enviar» while recording, and the 10:00 limit. */
  const finish = useCallback(async () => {
    if (phase.current !== 'recording') return;
    go('sending');
    try {
      const note = await finishRecording();
      if (note) await deliver(note);
    } finally {
      go('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder]);

  /**
   * Something else stopped the note (a call took the microphone, the app went
   * to the background): keep what there is, unsent, for the person to decide.
   */
  const interrupt = useCallback(async () => {
    if (phase.current !== 'recording') return;
    go('sending');
    try {
      const note = await finishRecording();
      if (note && alive.current) {
        hold(note);
        setError(STOPPED);
      }
    } finally {
      go('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder]);

  const resend = useCallback(async () => {
    const note = kept.current;
    if (phase.current !== 'idle' || !note) return;
    setError(null);
    go('sending');
    try {
      await deliver(note);
    } finally {
      go('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const discard = useCallback(() => {
    setError(null);
    hold(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Clears a passing message; a note waiting to be sent keeps its line. */
  const clearError = useCallback(() => {
    if (!kept.current) setError(null);
  }, []);

  const start = useCallback(async () => {
    if (phase.current !== 'idle') return;
    setError(null);
    hold(null);
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
    lastMillis.current = 0;
    setSeconds(0);
    go('recording');
    // The recorder's own clock and state, not JS time: a call or another app
    // taking the microphone stops it, and what it has is kept unsent.
    clock.current = setInterval(() => {
      const status = recorder.getStatus();
      const stopped = !status.isRecording && Date.now() - began > 1000;
      if (status.durationMillis) lastMillis.current = status.durationMillis;
      const s = Math.min(MAX_SECONDS, Math.floor(lastMillis.current / 1000));
      setSeconds(s);
      if (s >= MAX_SECONDS) void finish();
      else if (stopped) void interrupt();
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, finish, interrupt]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder]);

  // Recording happens only while the app is open: going to the background
  // stops the note and keeps it unsent. While starting there is nothing to stop
  // yet (Android's permission dialog sends the app there).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') void interrupt();
    });
    return () => sub.remove();
  }, [interrupt]);

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

  return { state, seconds, error, held, start, finish, cancel, resend, discard, clearError };
}
