import type { ChatMessage, VoicePart } from '@ghostaff/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MessageView } from '@/components/chat/Message';
import { VoiceNote } from '@/components/chat/VoiceNote';

// The decision card reads the database; these tests are about other parts.
jest.mock('@/components/chat/DecisionInChat', () => ({ DecisionInChat: () => null, DecisionQuote: () => null }));

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
  setPlaybackRate: jest.fn(),
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

  const note = (p: Partial<Parameters<typeof VoiceNote>[0]> = {}) => (
    <VoiceNote part={part()} messageId="m1" transcript="Llama mañana al proveedor." createdAt={now()} {...p} />
  );

  it('shows its length, with the transcript one tap away', async () => {
    await render(note());
    expect(screen.getByText('1:24')).toBeTruthy();
    expect(screen.getByLabelText('Escuchar nota de voz')).toBeTruthy();
    expect(screen.queryByText('Llama mañana al proveedor.')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Ver transcripción'));
    expect(screen.getByText('Llama mañana al proveedor.')).toBeTruthy();
  });

  it('keeps the transcript out of sight in General (chat-like-whatsapp.md, decision 5)', async () => {
    await render(note({ transcript: null }));
    expect(screen.queryByLabelText('Ver transcripción')).toBeNull();
    expect(screen.queryByText('Llama mañana al proveedor.')).toBeNull();
  });

  it('says, once opened, that it is being transcribed, then that nobody spoke', async () => {
    await render(note({ part: part({ transcription: 'pending' }), transcript: '' }));
    await fireEvent.press(screen.getByLabelText('Ver transcripción'));
    expect(screen.getByText('Transcribiendo…')).toBeTruthy();
    await screen.rerender(note({ part: part({ transcription: 'empty' }), transcript: '' }));
    expect(screen.getByText('No se ha oído nada.')).toBeTruthy();
  });

  it('offers to transcribe again when it failed, and shows it working', async () => {
    let finish: () => void = () => {};
    const onRetry = jest.fn(() => new Promise<void>((r) => (finish = r)));
    await render(note({ part: part({ transcription: 'failed' }), transcript: '', onRetry }));
    expect(screen.getByText('No se ha podido transcribir.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Reintentar la transcripción'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it('offers it too for a note left «pending» long ago (the app closed before asking)', async () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    await render(note({ part: part({ transcription: 'pending' }), transcript: '', createdAt: old, onRetry: jest.fn(async () => {}) }));
    expect(screen.getByLabelText('Reintentar la transcripción')).toBeTruthy();
  });

  it('fetches the audio on the first play only, then pauses', async () => {
    await render(note());
    expect(mockLink).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Escuchar nota de voz'));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    expect(mockLink).toHaveBeenCalledWith('org/chat/m1.m4a');
    expect(mockPlayer.replace).toHaveBeenCalledWith({ uri: 'https://storage.test/org/chat/m1.m4a?token=t' });
    expect(mockPlayer.setPlaybackRate).toHaveBeenCalledWith(1);
    await screen.rerender(note());
    await fireEvent.press(screen.getByLabelText('Pausar nota de voz'));
    expect(mockPlayer.pause).toHaveBeenCalled();
    await screen.rerender(note());
    await fireEvent.press(screen.getByLabelText('Escuchar nota de voz'));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(2));
    expect(mockLink).toHaveBeenCalledTimes(1);
  });

  it('changes speed, 1× → 1,5× → 2×, once playing', async () => {
    await render(note());
    expect(screen.queryByLabelText(/Velocidad/)).toBeNull();
    await fireEvent.press(screen.getByLabelText('Escuchar nota de voz'));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalled());
    await screen.rerender(note());
    await fireEvent.press(screen.getByLabelText('Velocidad 1×, cambiar'));
    expect(mockPlayer.setPlaybackRate).toHaveBeenLastCalledWith(1.5);
    expect(screen.getByText('1,5×')).toBeTruthy();
  });

  it('marks someone else’s new note until it is played', async () => {
    await render(note({ messageId: 'new-1', part: part({ path: 'org/chat/new-1.m4a' }), tone: 'theirs', unplayed: true }));
    expect(screen.getByTestId('voice-unplayed')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Escuchar nota de voz'));
    await waitFor(() => expect(screen.queryByTestId('voice-unplayed')).toBeNull());
  });

  it('says so when the audio cannot be fetched', async () => {
    mockLink.mockRejectedValueOnce(new Error('not found'));
    await render(note({ messageId: 'm9' }));
    await fireEvent.press(screen.getByLabelText('Escuchar nota de voz'));
    await waitFor(() => expect(screen.getByText('No se puede reproducir aquí')).toBeTruthy());
    expect(mockPlayer.play).not.toHaveBeenCalled();
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

  it('is drawn as its audio in your bubble, and retries through the screen', async () => {
    const onRetry = jest.fn(async () => {});
    await render(<MessageView message={{ ...message, parts: [part({ transcription: 'failed' })] }} mine showAuthor names={[]} onRetryTranscript={onRetry} />);
    expect(screen.getByLabelText('Escuchar nota de voz')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Reintentar la transcripción'));
    expect(onRetry).toHaveBeenCalledWith('m1');
  });

  it('draws a colleague’s note as audio too, with their name', async () => {
    await render(<MessageView message={message} mine={false} showAuthor names={[]} />);
    expect(screen.getByText('Ana')).toBeTruthy();
    expect(screen.getByLabelText('Escuchar nota de voz')).toBeTruthy();
  });

  it('in General, shows no transcript at all', async () => {
    await render(<MessageView message={message} mine={false} showAuthor names={[]} transcript="none" />);
    expect(screen.queryByText('Llama mañana al proveedor.')).toBeNull();
    expect(screen.queryByLabelText('Ver transcripción')).toBeNull();
  });

  it('shows the agents a note was tagged for above it', async () => {
    const tagged = { ...message, parts: [{ type: 'text', text: '@Secretaría' }, ...message.parts] } as typeof message;
    await render(<MessageView message={tagged} mine showAuthor names={['Secretaría']} transcript="none" />);
    expect(screen.getByText('@Secretaría')).toBeTruthy();
  });
});

describe('an agent’s audio in the chat (agent-audio.md)', () => {
  const audio = { type: 'audio', path: 'org/chat/m2.mp3', mediaType: 'audio/mpeg', durationMs: null, title: 'La Mesa 2026-11-30 (ES)' };
  const message: ChatMessage = {
    id: 'm2',
    threadId: 't1',
    authorKind: 'agent',
    authorUserId: null,
    authorAgentId: 'lamesa',
    authorName: 'La Mesa',
    parts: [audio],
    state: 'done',
    steps: [],
    createdAt: now(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockStatus, { playing: false, currentTime: 0, duration: 0, didJustFinish: false });
  });

  it('shows its title over the player, with no length until it loads, and no transcript', async () => {
    await render(<MessageView message={message} mine={false} showAuthor names={[]} />);
    expect(screen.getByText('La Mesa 2026-11-30 (ES)')).toBeTruthy();
    expect(screen.getByText('–:––')).toBeTruthy();
    expect(screen.queryByText('Transcribiendo…')).toBeNull();
    expect(screen.getByLabelText('La Mesa: audio «La Mesa 2026-11-30 (ES)»')).toBeTruthy();
  });

  it('plays from its own link in the bucket, and then knows its length', async () => {
    await render(<MessageView message={message} mine={false} showAuthor names={[]} />);
    await fireEvent.press(screen.getByLabelText('Escuchar «La Mesa 2026-11-30 (ES)»'));
    await waitFor(() => expect(mockPlayer.play).toHaveBeenCalledTimes(1));
    expect(mockLink).toHaveBeenCalledWith('org/chat/m2.mp3');
    Object.assign(mockStatus, { playing: false, duration: 1_260 });
    await screen.rerender(<MessageView message={message} mine={false} showAuthor names={[]} />);
    expect(screen.getByText('21:00')).toBeTruthy();
  });
});
