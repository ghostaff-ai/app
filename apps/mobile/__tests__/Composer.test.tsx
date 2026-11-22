import { AppState } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Composer } from '@/components/chat/Composer';

// expo-audio is a native module: a recorder that records nothing and a permission we can flip.
let mockRecording = false;
let mockStartedAt = 0;
const mockRecorder = {
  uri: 'file:///cache/ExpoAudio/note.m4a' as string | null,
  prepareToRecordAsync: jest.fn(async () => {}),
  record: jest.fn(() => {
    mockRecording = true;
    mockStartedAt = Date.now();
  }),
  stop: jest.fn(async () => {
    mockRecording = false;
  }),
  getStatus: () => ({ isRecording: mockRecording, durationMillis: mockRecording ? Date.now() - mockStartedAt : 0 }),
};
const mockPermission = jest.fn(async () => ({ granted: true }));
const mockDelete = jest.fn();
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => mockRecorder,
  requestRecordingPermissionsAsync: () => mockPermission(),
  setAudioModeAsync: jest.fn(async () => {}),
  IOSOutputFormat: { MPEG4AAC: 'aac ' },
  AudioQuality: { MEDIUM: 64 },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    delete = mockDelete;
  },
}));

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const names = ['Ana'];
const onSend = jest.fn(() => Promise.resolve());

const setup = async (onDictate?: (audio: Blob, mimeType: string) => Promise<string>) => {
  await render(<Composer placeholder="Escribe aquí" names={names} onSend={onSend} onDictate={onDictate} />);
};

const press = async (label: string) => {
  await fireEvent.press(screen.getByLabelText(label));
};

/** Let the permission, recorder and file reads settle. */
const settle = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
};

describe('Composer dictation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecording = false;
    mockPermission.mockResolvedValue({ granted: true });
    mockRecorder.uri = 'file:///cache/ExpoAudio/note.m4a';
    globalThis.fetch = jest.fn(async () => ({ blob: async () => new Blob(['voz'], { type: '' }) })) as unknown as typeof fetch;
  });

  it('has no mic without onDictate', async () => {
    await setup();
    expect(screen.queryByLabelText('Dictar')).toBeNull();
    expect(screen.getByLabelText('Enviar')).toBeTruthy();
  });

  it('keeps the mic beside send, with or without text', async () => {
    await setup(jest.fn());
    expect(screen.getByLabelText('Dictar')).toBeTruthy();
    expect(screen.getByLabelText('Enviar')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Escribe aquí'), 'Hola');
    expect(screen.getByLabelText('Dictar')).toBeTruthy();
    expect(screen.getByLabelText('Enviar')).toBeTruthy();
  });

  it('appends the transcript to what is already written: «Hola» + «qué tal»', async () => {
    await setup(jest.fn(async () => 'qué tal'));
    await fireEvent.changeText(screen.getByLabelText('Escribe aquí'), 'Hola');
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByLabelText('Escribe aquí').props.value).toBe('Hola qué tal');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('a double press of stop transcribes once', async () => {
    const onDictate = jest.fn(async () => 'x');
    await setup(onDictate);
    await press('Dictar');
    await settle();
    const stop = screen.getByLabelText('Parar y transcribir');
    await fireEvent.press(stop);
    await fireEvent.press(stop);
    await settle();
    expect(onDictate).toHaveBeenCalledTimes(1);
  });

  it('discards the file and stays quiet when the screen is left while transcribing', async () => {
    let finish: (t: string) => void = () => {};
    const onDictate = jest.fn(() => new Promise<string>((r) => (finish = r)));
    await setup(onDictate);
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    await screen.unmount();
    await act(async () => finish('tarde'));
    expect(mockDelete).toHaveBeenCalled();
    expect(onDictate).toHaveBeenCalledTimes(1);
  });

  it('survives the permission dialog sending the app to the background', async () => {
    let onChange: (s: string) => void = () => {};
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
      onChange = h;
      return { remove: jest.fn() };
    }) as never);
    let allow: (r: { granted: boolean }) => void = () => {};
    mockPermission.mockImplementationOnce(() => new Promise((r) => (allow = r)));
    const onDictate = jest.fn(async () => 'tras el diálogo');
    await setup(onDictate);
    await press('Dictar');
    await act(async () => onChange('background')); // Android's dialog
    await act(async () => allow({ granted: true }));
    await settle();
    expect(screen.getByText('Cancelar')).toBeTruthy();
    await press('Parar y transcribir');
    await settle();
    expect(onDictate).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Escribe aquí').props.value).toBe('tras el diálogo');
    jest.restoreAllMocks();
  });

  it('sends audio/mp4 for a phone recording whatever type the file read gives', async () => {
    globalThis.fetch = jest.fn(async () => ({ blob: async () => new Blob(['voz'], { type: 'audio/x-m4a' }) })) as unknown as typeof fetch;
    const onDictate = jest.fn(async () => 'ok');
    await setup(onDictate);
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect((onDictate.mock.calls as unknown[][])[0]?.[1]).toBe('audio/mp4');
  });

  it('keeps a transcript over 8000 characters whole, says so with the count, and blocks send', async () => {
    await setup(jest.fn(async () => 'x'.repeat(8412)));
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByLabelText('Escribe aquí').props.value).toHaveLength(8412);
    expect(screen.getByText(/El mensaje pasa de 8000 caracteres; recórtalo antes de enviar\./)).toBeTruthy();
    expect(screen.getByText(/8 412 \/ 8 000/)).toBeTruthy();
    expect(screen.getByLabelText('Enviar').props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText('Enviar'));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('retries a failed transcription with the same recording', async () => {
    const onDictate = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('a la segunda');
    await setup(onDictate);
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByText('No he podido transcribirlo. Inténtalo otra vez.')).toBeTruthy();
    expect(mockDelete).toHaveBeenCalledTimes(1);
    await press('Reintentar');
    await settle();
    expect(onDictate).toHaveBeenCalledTimes(2);
    expect(onDictate.mock.calls[1]?.[0]).toBe(onDictate.mock.calls[0]?.[0]);
    expect(screen.getByLabelText('Escribe aquí').props.value).toBe('a la segunda');
    expect(screen.queryByText('Reintentar')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); // the file is not read again
  });

  it('offers no retry for silence, and drops the recording on a new one', async () => {
    const onDictate = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('');
    await setup(onDictate);
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByText('Reintentar')).toBeTruthy();
    await press('Dictar');
    await settle();
    expect(screen.queryByText('Reintentar')).toBeNull();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByText('No he oído nada. Inténtalo otra vez.')).toBeTruthy();
    expect(screen.queryByText('Reintentar')).toBeNull();
  });

  it('says so when dictation was used too much', async () => {
    await setup(jest.fn(async () => Promise.reject(Object.assign(new Error('x'), { code: 'too_many' }))));
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByText('Has dictado mucho en la última hora. Espera un poco.')).toBeTruthy();
  });

  it('clears the dictation error when the person types', async () => {
    await setup(jest.fn(async () => ''));
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByText('No he oído nada. Inténtalo otra vez.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Escribe aquí'), 'a');
    expect(screen.queryByText('No he oído nada. Inténtalo otra vez.')).toBeNull();
  });

  it('shows a spinner, not a stop icon, on the disabled button while transcribing', async () => {
    await setup(() => new Promise<string>(() => {}));
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.queryByLabelText('Parar y transcribir')).toBeNull();
    expect(JSON.stringify(screen.toJSON()).match(/ActivityIndicator/g)).toHaveLength(2); // the bar's and the button's
  });

  it('stops and transcribes when the app goes to the background', async () => {
    let onChange: (s: string) => void = () => {};
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
      onChange = h;
      return { remove: jest.fn() };
    }) as never);
    const onDictate = jest.fn(async () => 'de fondo');
    await setup(onDictate);
    await press('Dictar');
    await settle();
    await act(async () => onChange('active'));
    expect(onDictate).not.toHaveBeenCalled();
    await act(async () => onChange('background'));
    await settle();
    expect(onDictate).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Escribe aquí').props.value).toBe('de fondo');
    jest.restoreAllMocks();
  });

  it('records, transcribes and puts the text in the box without sending it', async () => {
    const onDictate = jest.fn(async () => 'qué tal');
    await setup(onDictate);
    await press('Dictar');
    await settle();
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByText('Cancelar')).toBeTruthy();
    await press('Parar y transcribir');
    await settle();
    expect(onDictate).toHaveBeenCalledTimes(1);
    const [audio, mime] = onDictate.mock.calls[0] as unknown as [Blob, string];
    expect(audio).toBeInstanceOf(Blob);
    expect(mime).toBe('audio/mp4');
    expect(screen.getByLabelText('Escribe aquí').props.value).toBe('qué tal');
    expect(onSend).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('shows «Transcribiendo…» while the engine works', async () => {
    let finish: (t: string) => void = () => {};
    await setup(() => new Promise<string>((r) => (finish = r)));
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByText('Transcribiendo…')).toBeTruthy();
    await act(async () => finish('listo'));
    expect(screen.queryByText('Transcribiendo…')).toBeNull();
    expect(screen.getByLabelText('Escribe aquí').props.value).toBe('listo');
  });

  it('cancelling goes back to the empty box and never calls onDictate', async () => {
    const onDictate = jest.fn(async () => 'x');
    await setup(onDictate);
    await press('Dictar');
    await settle();
    await press('Cancelar');
    await settle();
    expect(screen.getByLabelText('Escribe aquí')).toBeTruthy();
    expect(screen.getByLabelText('Dictar')).toBeTruthy();
    expect(onDictate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says so when the microphone is not allowed', async () => {
    mockPermission.mockResolvedValue({ granted: false });
    await setup(jest.fn());
    await press('Dictar');
    await settle();
    expect(screen.getByText('Ghostaff no tiene permiso para usar el micrófono. Actívalo en los ajustes.')).toBeTruthy();
    expect(mockRecorder.record).not.toHaveBeenCalled();
  });

  it('says so when the transcription fails', async () => {
    await setup(jest.fn(async () => Promise.reject(new Error('boom'))));
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByText('No he podido transcribirlo. Inténtalo otra vez.')).toBeTruthy();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('says so when the note is too long', async () => {
    await setup(jest.fn(async () => Promise.reject(Object.assign(new Error('x'), { code: 'too_large' }))));
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByText('La nota es demasiado larga.')).toBeTruthy();
  });

  it('says so when nobody spoke', async () => {
    await setup(jest.fn(async () => ''));
    await press('Dictar');
    await settle();
    await press('Parar y transcribir');
    await settle();
    expect(screen.getByText('No he oído nada. Inténtalo otra vez.')).toBeTruthy();
    expect(screen.getByLabelText('Escribe aquí').props.value).toBe('');
  });

  describe('with a clock', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('transcribes what is there when the recorder stops by itself', async () => {
      const onDictate = jest.fn(async () => 'cortado');
      await setup(onDictate);
      await press('Dictar');
      await settle();
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      mockRecording = false; // a phone call took the microphone
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      await settle();
      expect(onDictate).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Escribe aquí').props.value).toBe('cortado');
    });

    it('counts the seconds and stops by itself at 10:00', async () => {
      const onDictate = jest.fn(async () => 'largo');
      await setup(onDictate);
      await press('Dictar');
      await settle();
      await act(async () => {
        jest.advanceTimersByTime(65_000);
      });
      expect(screen.getByText('1:05')).toBeTruthy();
      expect(onDictate).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(535_000);
      });
      await settle();
      expect(onDictate).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Escribe aquí').props.value).toBe('largo');
    });
  });

  it('discards a recording when the screen is left', async () => {
    const onDictate = jest.fn(async () => 'x');
    await setup(onDictate);
    await press('Dictar');
    await settle();
    await screen.unmount();
    await settle();
    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(onDictate).not.toHaveBeenCalled();
  });
});
