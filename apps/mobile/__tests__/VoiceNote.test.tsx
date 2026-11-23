import type { ChatMessage, VoicePart } from '@ghostaff/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MessageView } from '@/components/chat/Message';
import { VoiceNote } from '@/components/chat/VoiceNote';

// A player that plays nothing, with a status the test moves.
const mockStatus = { playing: false, currentTime: 0, duration: 0, didJustFinish: false };
const mockPlayer = {
  replace: jest.fn(),
  play: jest.fn(() => {
    mockStatus.playing = true;
  }),
  pause: jest.fn(() => {
    mockStatus.playing = false;
  }),
  seekTo: jest.fn(async () => {}),
};
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => mockPlayer,
  useAudioPlayerStatus: () => ({ ...mockStatus }),
  setAudioModeAsync: jest.fn(async () => {}),
}));
const mockLink = jest.fn(async (path: string) => `https://storage.test/${path}?token=t`);
jest.mock('@/lib/hooks/useChat', () => ({ voiceNoteLink: (p: string) => mockLink(p) }));

const part = (p: Partial<VoicePart> = {}): VoicePart => ({
  type: 'voice',
  path: 'org/chat/m1.m4a',
  mediaType: 'audio/mp4',
  durationMs: 84_000,
  transcription: 'done',
  ...p,
});
const now = () => new Date().toISOString();

describe('a voice note', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockStatus, { playing: false, currentTime: 0, duration: 0, didJustFinish: false });
  });

  it('shows its length and its transcript', async () => {
    await render(<VoiceNote part={part()} transcript="Llama mañana al proveedor." createdAt={now()} />);
    expect(screen.getByText('1:24')).toBeTruthy();
    expect(screen.getByText('Llama mañana al proveedor.')).toBeTruthy();
    expect(screen.getByLabelText('Escuchar nota de voz')).toBeTruthy();
  });

  it('says it is being transcribed, then that nobody spoke', async () => {
    await render(<VoiceNote part={part({ transcription: 'pending' })} transcript="" createdAt={now()} />);
    expect(screen.getByText('Transcribiendo…')).toBeTruthy();
    await screen.rerender(<VoiceNote part={part({ transcription: 'empty' })} transcript="" createdAt={now()} />);
    expect(screen.getByText('No se ha oído nada.')).toBeTruthy();
  });

  it('offers to transcribe again when it failed, and shows it working', async () => {
    let finish: () => void = () => {};
    const onRetry = jest.fn(() => new Promise<void>((r) => (finish = r)));
    await render(<VoiceNote part={part({ transcription: 'failed' })} transcript="" createdAt={now()} onRetry={onRetry} />);
    expect(screen.getByText('No se ha podido transcribir.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Reintentar la transcripción'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Transcribiendo…')).toBeTruthy();
    await act(async () => finish());
  });

  it('offers it too for a note left «pending» long ago (the app closed before asking)', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await render(<VoiceNote part={part({ transcription: 'pending' })} transcript="" createdAt={old} onRetry={jest.fn(async () => {})} />);
    expect(screen.getByLabelText('Reintentar la transcripción')).toBeTruthy();
  });

  it('fetches the audio on the first play only, then pauses', async () => {
    await render(<VoiceNote part={part()} transcript="Hola" createdAt={now()} />);
    expect(mockLink).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Escuchar nota de voz'));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    expect(mockLink).toHaveBeenCalledWith('org/chat/m1.m4a');
    expect(mockPlayer.replace).toHaveBeenCalledWith({ uri: 'https://storage.test/org/chat/m1.m4a?token=t' });
    await screen.rerender(<VoiceNote part={part()} transcript="Hola" createdAt={now()} />);
    await fireEvent.press(screen.getByLabelText('Pausar nota de voz'));
    expect(mockPlayer.pause).toHaveBeenCalled();
    await screen.rerender(<VoiceNote part={part()} transcript="Hola" createdAt={now()} />);
    await fireEvent.press(screen.getByLabelText('Escuchar nota de voz'));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(2));
    expect(mockLink).toHaveBeenCalledTimes(1);
  });

  it('says so when the audio cannot be fetched', async () => {
    mockLink.mockRejectedValueOnce(new Error('not found'));
    await render(<VoiceNote part={part()} transcript="Hola" createdAt={now()} />);
    await fireEvent.press(screen.getByLabelText('Escuchar nota de voz'));
    await waitFor(() => expect(screen.getByText('No se puede reproducir aquí')).toBeTruthy());
    expect(mockPlayer.play).not.toHaveBeenCalled();
    expect(screen.getByText('Hola')).toBeTruthy(); // the transcript still reads
  });
});

describe('a voice note in the chat', () => {
  const message: ChatMessage = {
    id: 'm1',
    threadId: 't1',
    authorKind: 'person',
    authorUserId: 'ana',
    authorAgentId: null,
    authorName: 'Ana',
    parts: [part(), { type: 'text', text: 'Llama mañana al proveedor.' }],
    state: 'done',
    steps: [],
    createdAt: now(),
  };

  it('is drawn as its audio and transcript in your bubble, and retries through the screen', async () => {
    const onRetry = jest.fn(async () => {});
    await render(
      <MessageView
        message={{ ...message, parts: [part({ transcription: 'failed' })] }}
        mine
        showAuthor
        names={[]}
        onRetryTranscript={onRetry}
      />,
    );
    expect(screen.getByLabelText('Escuchar nota de voz')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Reintentar la transcripción'));
    expect(onRetry).toHaveBeenCalledWith('m1');
  });

  it('shows the transcript as the text of a message that is not yours', async () => {
    await render(<MessageView message={message} mine={false} showAuthor names={[]} />);
    expect(screen.getByText('Llama mañana al proveedor.')).toBeTruthy();
    expect(screen.queryByLabelText('Escuchar nota de voz')).toBeNull();
  });
});
