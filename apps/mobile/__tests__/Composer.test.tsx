import { AppState } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Composer } from '@/components/chat/Composer';

// expo-audio is a native module: a recorder that records nothing and a permission we can flip.
let mockRecording = false;
let mockStartedAt = 0;
/** What the recorder reports at least, so a quick test isn't a too-short note. */
let mockMinMillis = 4200;
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
  getStatus: () => ({ isRecording: mockRecording, durationMillis: mockRecording ? Math.max(mockMinMillis, Date.now() - mockStartedAt) : 0 }),
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

const names = ['Ana', 'Secretaría'];
const onSend = jest.fn(() => Promise.resolve());

type Note = { audio: Blob; mimeType: string; durationMs: number };
const setup = async (onVoiceNote?: (note: Note, tagged: string[]) => Promise<void>) => {
  await render(<Composer placeholder="Escribe aquí" names={names} onSend={onSend} onVoiceNote={onVoiceNote} />);
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

const record = async () => {
  await press('Grabar nota de voz');
  await settle();
};

const recordAndSend = async () => {
  await record();
  await press('Enviar nota de voz');
  await settle();
};

const backgroundOnDemand = () => {
  let onChange: (s: string) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
    onChange = h;
    return { remove: jest.fn() };
  }) as never);
  return (s: string) => act(async () => onChange(s));
};

describe('Composer voice notes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRecording = false;
    mockMinMillis = 4200;
    mockPermission.mockResolvedValue({ granted: true });
    mockRecorder.uri = 'file:///cache/ExpoAudio/note.m4a';
    globalThis.fetch = jest.fn(async () => ({ blob: async () => new Blob(['voz'], { type: '' }) })) as unknown as typeof fetch;
  });

  it('has no mic without onVoiceNote', async () => {
    await setup();
    expect(screen.queryByLabelText('Grabar nota de voz')).toBeNull();
    expect(screen.getByLabelText('Enviar')).toBeTruthy();
  });

  it('keeps the mic beside send, with or without text', async () => {
    await setup(jest.fn());
    expect(screen.getByLabelText('Grabar nota de voz')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Escribe aquí'), 'Hola');
    expect(screen.getByLabelText('Grabar nota de voz')).toBeTruthy();
    expect(screen.getByLabelText('Enviar')).toBeTruthy();
  });

  it('records and sends the note as audio, with its length, leaving the text box alone', async () => {
    const onVoiceNote = jest.fn(async (_: Note) => {});
    await setup(onVoiceNote);
    await fireEvent.changeText(screen.getByLabelText('Escribe aquí'), 'a medias');
    await record();
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByText('Cancelar')).toBeTruthy();
    await press('Enviar nota de voz');
    await settle();
    expect(onVoiceNote).toHaveBeenCalledTimes(1);
    const note = onVoiceNote.mock.calls[0]![0];
    expect(note.audio).toBeInstanceOf(Blob);
    expect(note.mimeType).toBe('audio/mp4');
    expect(note.durationMs).toBeGreaterThanOrEqual(4200);
    expect(onSend).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalled();
    expect(screen.getByLabelText('Escribe aquí').props.value).toBe('a medias');
  });

  it('with only @mentions in the box, the note goes tagged to them and the box empties (general-chat.md)', async () => {
    const onVoiceNote = jest.fn(async (_: Note, _tagged: string[]) => {});
    await setup(onVoiceNote);
    await fireEvent.changeText(screen.getByLabelText('Escribe aquí'), '@Secretaría ');
    expect(screen.getByLabelText('Grabar nota de voz para Secretaría')).toBeTruthy();
    await press('Grabar nota de voz para Secretaría');
    await settle();
    await press('Enviar nota de voz');
    await settle();
    expect(onVoiceNote.mock.calls[0]![1]).toEqual(['Secretaría']);
    expect(screen.getByLabelText('Escribe aquí').props.value).toBe('');
  });

  it('sends audio/mp4 for a phone recording whatever type the file read gives', async () => {
    globalThis.fetch = jest.fn(async () => ({ blob: async () => new Blob(['voz'], { type: 'audio/x-m4a' }) })) as unknown as typeof fetch;
    const onVoiceNote = jest.fn(async (_: Note) => {});
    await setup(onVoiceNote);
    await recordAndSend();
    expect(onVoiceNote.mock.calls[0]![0].mimeType).toBe('audio/mp4');
  });

  it('sends the browser’s own type for a web recording and releases it', async () => {
    mockRecorder.uri = 'blob:http://localhost/1';
    const revoke = jest.fn();
    const URLWithRevoke = URL as unknown as { revokeObjectURL?: (u: string) => void };
    const saved = URLWithRevoke.revokeObjectURL;
    URLWithRevoke.revokeObjectURL = revoke;
    globalThis.fetch = jest.fn(async () => ({ blob: async () => new Blob(['voz'], { type: 'audio/webm' }) })) as unknown as typeof fetch;
    const onVoiceNote = jest.fn(async (_: Note) => {});
    await setup(onVoiceNote);
    await recordAndSend();
    expect(onVoiceNote.mock.calls[0]![0].mimeType).toBe('audio/webm');
    expect(revoke).toHaveBeenCalledWith('blob:http://localhost/1');
    URLWithRevoke.revokeObjectURL = saved;
  });

  it('a double press of send sends once', async () => {
    const onVoiceNote = jest.fn(async (_: Note) => {});
    await setup(onVoiceNote);
    await record();
    const send = screen.getByLabelText('Enviar nota de voz');
    await fireEvent.press(send);
    await fireEvent.press(send);
    await settle();
    expect(onVoiceNote).toHaveBeenCalledTimes(1);
  });

  it('shows «Enviando…» and a spinner while it goes', async () => {
    let done: () => void = () => {};
    await setup(() => new Promise<void>((r) => (done = r)));
    await recordAndSend();
    expect(screen.getByText('Enviando…')).toBeTruthy();
    expect(screen.queryByLabelText('Enviar nota de voz')).toBeNull();
    expect(JSON.stringify(screen.toJSON()).match(/ActivityIndicator/g)).toHaveLength(2); // the bar's and the button's
    await act(async () => done());
    expect(screen.queryByText('Enviando…')).toBeNull();
    expect(screen.getByLabelText('Escribe aquí')).toBeTruthy();
  });

  it('keeps a note that did not go, and sends the same recording again', async () => {
    const onVoiceNote = jest.fn<Promise<void>, [Note]>().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    await setup(onVoiceNote);
    await recordAndSend();
    expect(screen.getByText('No se ha enviado la nota.')).toBeTruthy();
    expect(mockDelete).toHaveBeenCalledTimes(1); // the file is gone; the note is in memory
    await press('Enviar la nota');
    await settle();
    expect(onVoiceNote).toHaveBeenCalledTimes(2);
    expect(onVoiceNote.mock.calls[1]![0]).toBe(onVoiceNote.mock.calls[0]![0]);
    expect(screen.queryByText('No se ha enviado la nota.')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1); // not read again
  });

  it('discards a note that did not go', async () => {
    const onVoiceNote = jest.fn<Promise<void>, [Note]>().mockRejectedValue(new Error('boom'));
    await setup(onVoiceNote);
    await recordAndSend();
    await press('Descartar la nota');
    expect(screen.queryByText('No se ha enviado la nota.')).toBeNull();
    expect(screen.queryByLabelText('Enviar la nota')).toBeNull();
  });

  it('typing keeps a waiting note’s line, and clears a passing message', async () => {
    await setup(jest.fn<Promise<void>, [Note]>().mockRejectedValue(new Error('boom')));
    await recordAndSend();
    await fireEvent.changeText(screen.getByLabelText('Escribe aquí'), 'a');
    expect(screen.getByText('No se ha enviado la nota.')).toBeTruthy();
    await press('Descartar la nota');
    mockPermission.mockResolvedValue({ granted: false });
    await record();
    expect(screen.getByText(/no tiene permiso/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Escribe aquí'), 'ab');
    expect(screen.queryByText(/no tiene permiso/)).toBeNull();
  });

  it('says so when too many notes were sent, and keeps the note for later', async () => {
    await setup(jest.fn(async () => Promise.reject(Object.assign(new Error('x'), { code: 'too_many' }))));
    await recordAndSend();
    expect(screen.getByText('Has enviado muchas notas de voz en la última hora. Espera un poco.')).toBeTruthy();
    expect(screen.getByLabelText('Enviar la nota')).toBeTruthy();
  });

  it('says so when the note is too long, with nothing to send again', async () => {
    await setup(jest.fn(async () => Promise.reject(Object.assign(new Error('x'), { code: 'too_large' }))));
    await recordAndSend();
    expect(screen.getByText('La nota es demasiado larga.')).toBeTruthy();
    expect(screen.queryByLabelText('Enviar la nota')).toBeNull();
  });

  it('sends nothing for a tap by mistake', async () => {
    mockMinMillis = 300;
    const onVoiceNote = jest.fn(async (_: Note) => {});
    await setup(onVoiceNote);
    await recordAndSend();
    expect(onVoiceNote).not.toHaveBeenCalled();
    expect(screen.getByText('La nota es demasiado corta.')).toBeTruthy();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('cancelling goes back to the box and never sends', async () => {
    const onVoiceNote = jest.fn(async (_: Note) => {});
    await setup(onVoiceNote);
    await record();
    await press('Cancelar');
    await settle();
    expect(screen.getByLabelText('Escribe aquí')).toBeTruthy();
    expect(screen.getByLabelText('Grabar nota de voz')).toBeTruthy();
    expect(onVoiceNote).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says so when the microphone is not allowed', async () => {
    mockPermission.mockResolvedValue({ granted: false });
    await setup(jest.fn());
    await record();
    expect(screen.getByText('Ghostaff no tiene permiso para usar el micrófono. Actívalo en los ajustes.')).toBeTruthy();
    expect(mockRecorder.record).not.toHaveBeenCalled();
  });

  it('going to the background stops the note and keeps it unsent', async () => {
    const goTo = backgroundOnDemand();
    const onVoiceNote = jest.fn(async (_: Note) => {});
    await setup(onVoiceNote);
    await record();
    await goTo('active');
    expect(screen.getByText('Cancelar')).toBeTruthy();
    await goTo('background');
    await settle();
    expect(onVoiceNote).not.toHaveBeenCalled();
    expect(screen.getByText('La nota se ha parado sin enviar.')).toBeTruthy();
    await press('Enviar la nota');
    await settle();
    expect(onVoiceNote).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('survives the permission dialog sending the app to the background', async () => {
    const goTo = backgroundOnDemand();
    let allow: (r: { granted: boolean }) => void = () => {};
    mockPermission.mockImplementationOnce(() => new Promise((r) => (allow = r)));
    const onVoiceNote = jest.fn(async (_: Note) => {});
    await setup(onVoiceNote);
    await press('Grabar nota de voz');
    await goTo('background'); // Android's dialog
    await act(async () => allow({ granted: true }));
    await settle();
    expect(screen.getByText('Cancelar')).toBeTruthy();
    await press('Enviar nota de voz');
    await settle();
    expect(onVoiceNote).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  describe('with a clock', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('keeps the note unsent when the recorder stops by itself (a call took the microphone)', async () => {
      const onVoiceNote = jest.fn(async (_: Note) => {});
      await setup(onVoiceNote);
      await record();
      await act(async () => {
        jest.advanceTimersByTime(3000);
      });
      mockRecording = false;
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      await settle();
      expect(onVoiceNote).not.toHaveBeenCalled();
      expect(screen.getByText('La nota se ha parado sin enviar.')).toBeTruthy();
    });

    it('counts the seconds and sends by itself at 10:00', async () => {
      mockMinMillis = 0;
      const onVoiceNote = jest.fn(async (_: Note) => {});
      await setup(onVoiceNote);
      await record();
      await act(async () => {
        jest.advanceTimersByTime(65_000);
      });
      expect(screen.getByText('1:05')).toBeTruthy();
      expect(onVoiceNote).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(535_000);
      });
      await settle();
      expect(onVoiceNote).toHaveBeenCalledTimes(1);
      expect(onVoiceNote.mock.calls[0]![0].durationMs).toBeGreaterThanOrEqual(600_000);
    });
  });

  it('discards a recording when the screen is left', async () => {
    const onVoiceNote = jest.fn(async (_: Note) => {});
    await setup(onVoiceNote);
    await record();
    await screen.unmount();
    await settle();
    expect(mockRecorder.stop).toHaveBeenCalled();
    expect(onVoiceNote).not.toHaveBeenCalled();
  });
});
