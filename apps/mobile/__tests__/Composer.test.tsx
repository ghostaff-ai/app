import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Composer } from '@/components/chat/Composer';

// expo-audio is a native module: a recorder that records nothing and a permission we can flip.
const mockRecorder = {
  uri: 'file:///cache/ExpoAudio/note.m4a' as string | null,
  prepareToRecordAsync: jest.fn(async () => {}),
  record: jest.fn(),
  stop: jest.fn(async () => {}),
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
    mockPermission.mockResolvedValue({ granted: true });
    mockRecorder.uri = 'file:///cache/ExpoAudio/note.m4a';
    globalThis.fetch = jest.fn(async () => ({ blob: async () => new Blob(['voz'], { type: '' }) })) as unknown as typeof fetch;
  });

  it('has no mic without onDictate', async () => {
    await setup();
    expect(screen.queryByLabelText('Dictar')).toBeNull();
    expect(screen.getByLabelText('Enviar')).toBeTruthy();
  });

  it('is the mic while the box is empty and send once there is text', async () => {
    await setup(jest.fn());
    expect(screen.getByLabelText('Dictar')).toBeTruthy();
    expect(screen.queryByLabelText('Enviar')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Escribe aquí'), 'Hola');
    expect(screen.getByLabelText('Enviar')).toBeTruthy();
    expect(screen.queryByLabelText('Dictar')).toBeNull();
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
