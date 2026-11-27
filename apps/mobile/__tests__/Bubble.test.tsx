import type { ChatMessage } from '@ghostaff/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MessageView } from '@/components/chat/Message';
import { LIGHT } from '@/lib/palette';

// The decision card reads the database; these tests are about the bubble.
jest.mock('@/components/chat/DecisionInChat', () => ({ DecisionInChat: () => null, DecisionQuote: () => null }));
// A link's preview comes from the engine; here it is a fixed one.
jest.mock('@/lib/hooks/useConnections', () => ({ useEngine: () => ({}) }));
jest.mock('@ghostaff/shared/services', () => ({
  ...jest.requireActual('@ghostaff/shared/services'),
  linkPreview: jest.fn(async () => ({ site: 'example.com', title: 'Un título', description: 'Una descripción', image: null })),
}));

const base: ChatMessage = {
  id: 'm1',
  threadId: 't1',
  authorKind: 'person',
  authorUserId: 'ana',
  authorAgentId: null,
  authorName: 'Ana',
  parts: [{ type: 'text', text: 'Hola' }],
  state: 'done',
  steps: [],
  createdAt: new Date().toISOString(),
};

const classOf = (label: string) => String(screen.getByLabelText(label).props.className);

describe('a message bubble', () => {
  it('draws your bubble in lavender with ink text', async () => {
    await render(<MessageView message={base} mine showAuthor names={[]} />);
    const bubble = classOf('Tú: Hola');
    expect(bubble).toContain('bg-mine');
    expect(bubble).not.toContain('bg-accent');
    expect(String(screen.getByText('Hola').props.className)).toContain('text-ink');
  });

  it('draws theirs white without a border', async () => {
    await render(<MessageView message={base} mine={false} showAuthor names={[]} />);
    const bubble = classOf('Ana: Hola');
    expect(bubble).toContain('bg-theirs');
    expect(bubble).not.toContain('border');
  });

  it('draws the tail on the first of a run only', async () => {
    const { rerender } = await render(<MessageView message={base} mine showAuthor names={[]} />);
    expect(screen.getByTestId('bubble-tail')).toBeTruthy();
    await rerender(<MessageView message={base} mine showAuthor={false} names={[]} />);
    expect(screen.queryByTestId('bubble-tail')).toBeNull();
  });

  it('leaves nothing in on-accent inside your bubble', async () => {
    const parts = [
      { type: 'quote', messageId: 'q1', authorName: 'Luis', kind: 'text', text: 'Citado' },
      { type: 'forward', messageId: 'f1', authorName: 'Marta', kind: 'voice', text: '', from: 'General', at: new Date().toISOString() },
      { type: 'document', path: 'org/t/m/a.pdf', mediaType: 'application/pdf', name: 'a.pdf', size: 2048 },
      { type: 'text', text: 'Mira https://example.com/x' },
    ] as ChatMessage['parts'];
    await render(<MessageView message={{ ...base, parts }} mine showAuthor names={[]} />);
    await waitFor(() => expect(screen.getByText('Un título')).toBeTruthy());
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).not.toContain('on-accent');
    expect(tree).not.toContain(`"color":"${LIGHT.onAccent}"`);
  });

  it('leaves nothing in on-accent inside your deleted message', async () => {
    await render(<MessageView message={{ ...base, deletedAt: new Date().toISOString() }} mine showAuthor names={[]} me="ana" />);
    expect(screen.getByText('Eliminaste este mensaje')).toBeTruthy();
    const tree = JSON.stringify(screen.toJSON());
    expect(tree).not.toContain('on-accent');
    expect(tree).not.toContain(`"color":"${LIGHT.onAccent}"`);
  });

  it('draws a message of only emoji big, without a bubble, and holding it opens the menu', async () => {
    const onMenu = jest.fn();
    const message = { ...base, parts: [{ type: 'text', text: '😆😁' }] as ChatMessage['parts'] };
    await render(<MessageView message={message} mine showAuthor names={[]} onMenu={onMenu} />);
    const emoji = screen.getByTestId('emoji-message');
    expect(String(emoji.props.className)).not.toContain('bg-mine');
    expect(String(screen.getByText('😆😁').props.className)).not.toContain('bg-mine');
    expect(JSON.stringify(screen.getByText('😆😁').props.style)).toMatch(/"fontSize":(4\d|[5-9]\d)/);
    expect(screen.getByLabelText('Tú: 😆😁')).toBeTruthy();
    expect(screen.queryByTestId('bubble-tail')).toBeNull();
    await fireEvent(emoji, 'longPress');
    expect(onMenu).toHaveBeenCalledTimes(1);
  });

  it('keeps a message with emoji and words in its bubble', async () => {
    const message = { ...base, parts: [{ type: 'text', text: '😀 hola' }] as ChatMessage['parts'] };
    await render(<MessageView message={message} mine showAuthor names={[]} />);
    expect(screen.queryByTestId('emoji-message')).toBeNull();
  });
});
