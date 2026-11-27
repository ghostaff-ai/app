import type { ChatMessage } from '@ghostaff/shared';
import { reactionChips } from '@ghostaff/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MessageView } from '@/components/chat/Message';
import { actionsFor, MessageMenu } from '@/components/chat/MessageMenu';

// What you do with a message, as in WhatsApp (chat-like-whatsapp.md, phase 2).

jest.mock('@/components/chat/DecisionInChat', () => ({ DecisionInChat: () => null, DecisionQuote: () => null }));
jest.mock('@/lib/hooks/useChat', () => ({ voiceNoteLink: async () => 'x' }));
jest.mock('expo-audio', () => ({ useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0 }), setAudioModeAsync: jest.fn() }));

const msg = (p: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1',
  threadId: 't1',
  authorKind: 'person',
  authorUserId: 'ana',
  authorAgentId: null,
  authorName: 'Ana',
  parts: [{ type: 'text', text: 'Mañana abro yo' }],
  state: 'done',
  steps: [],
  createdAt: new Date().toISOString(),
  ...p,
});

describe('the message menu', () => {
  it('offers to edit and delete only your own, editing text within 15 minutes', () => {
    const base = { canWrite: true, pinned: false, canForward: true };
    expect(actionsFor(msg(), { ...base, me: 'ana' })).toEqual(['reply', 'copy', 'forward', 'pin', 'edit', 'delete']);
    expect(actionsFor(msg(), { ...base, me: 'bea' })).toEqual(['reply', 'copy', 'forward', 'pin']);
    const old = msg({ createdAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    expect(actionsFor(old, { ...base, me: 'ana' })).not.toContain('edit');
    const voice = msg({ parts: [{ type: 'voice', path: 'p', mediaType: 'audio/mp4', durationMs: 1000, transcription: 'done' }] });
    expect(actionsFor(voice, { ...base, me: 'ana' })).toEqual(['reply', 'forward', 'pin', 'delete']);
    expect(actionsFor(msg(), { ...base, me: 'ana', pinned: true })).toContain('unpin');
    expect(actionsFor(msg({ deletedAt: new Date().toISOString() }), { ...base, me: 'ana' })).toEqual([]);
    expect(actionsFor(msg(), { canWrite: false, pinned: false, canForward: false, me: 'bea' })).toEqual(['copy']);
  });

  it('reacts, takes your reaction away when picked again, and asks before deleting', async () => {
    const onReact = jest.fn();
    const onAction = jest.fn();
    await render(<MessageMenu message={msg()} actions={['reply', 'delete']} myReaction="👍" canReact onReact={onReact} onAction={onAction} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Reaccionar con ❤️'));
    expect(onReact).toHaveBeenLastCalledWith('❤️');
    await render(<MessageMenu message={msg()} actions={['reply', 'delete']} myReaction="👍" canReact onReact={onReact} onAction={onAction} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Reaccionar con 👍'));
    expect(onReact).toHaveBeenLastCalledWith(null);
    await render(<MessageMenu message={msg()} actions={['reply', 'delete']} myReaction={null} canReact onReact={onReact} onAction={onAction} onClose={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Eliminar'));
    expect(onAction).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Eliminar para todos'));
    expect(onAction).toHaveBeenCalledWith('delete');
  });
});

describe('a message with what happened to it', () => {
  it('shows the quote it replies to, and goes to it on a tap', async () => {
    const onQuotePress = jest.fn();
    const reply = msg({ id: 'm2', parts: [{ type: 'quote', messageId: 'm1', authorName: 'Bea', kind: 'text', text: '¿Quién abre?' }, { type: 'text', text: 'Yo' }] });
    await render(<MessageView message={reply} mine={false} showAuthor names={[]} onQuotePress={onQuotePress} />);
    expect(screen.getByText('¿Quién abre?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Responde a Bea: ¿Quién abre?'));
    expect(onQuotePress).toHaveBeenCalledWith('m1');
  });

  it('says a deleted message was deleted, and an edited one was edited', async () => {
    await render(<MessageView message={msg({ parts: [], deletedAt: new Date().toISOString() })} mine={false} showAuthor names={[]} />);
    expect(screen.getByText(/Se eliminó este mensaje/)).toBeTruthy();
    await render(<MessageView message={msg({ editedAt: new Date().toISOString() })} mine={false} showAuthor names={[]} />);
    expect(screen.getAllByText(/editado/).length).toBeGreaterThan(0);
  });

  it('draws its reactions with how many, yours toggling away', async () => {
    const onReact = jest.fn();
    const reactions = [
      { messageId: 'm1', userId: 'ana', emoji: '👍' },
      { messageId: 'm1', userId: 'bea', emoji: '👍' },
      { messageId: 'm1', userId: 'carla', emoji: '😂' },
    ];
    expect(reactionChips(reactions, 'ana')).toEqual([
      { emoji: '👍', count: 2, mine: true },
      { emoji: '😂', count: 1, mine: false },
    ]);
    await render(<MessageView message={msg()} mine={false} showAuthor names={[]} me="ana" reactions={reactions} onReact={onReact} />);
    await fireEvent.press(screen.getByLabelText('👍 2, tuya'));
    expect(onReact).toHaveBeenCalledWith(null);
    await fireEvent.press(screen.getByLabelText('😂 1'));
    expect(onReact).toHaveBeenCalledWith('😂');
  });

  it('a forwarded message says where it came from', async () => {
    const fwd = msg({ parts: [{ type: 'forward', messageId: 'm0', authorName: 'Álvaro', kind: 'voice', text: 'Lo de la feria', from: 'General', at: new Date().toISOString() }] });
    await render(<MessageView message={fwd} mine showAuthor names={[]} />);
    expect(screen.getByText('Reenviado desde General')).toBeTruthy();
    expect(screen.getByText('Lo de la feria')).toBeTruthy();
  });
});
