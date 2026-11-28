import type { ChatMessage } from '@ghostaff/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { MessageView } from '@/components/chat/Message';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/components/chat/DecisionInChat', () => ({ DecisionInChat: () => null, DecisionQuote: () => null }));
jest.mock('@/lib/hooks/useConnections', () => ({ useEngine: () => ({}) }));

const reply: ChatMessage = {
  id: 'm1',
  threadId: 't1',
  authorKind: 'agent',
  authorUserId: null,
  authorAgentId: 'agent-1',
  authorName: 'Secretaría',
  parts: [{ type: 'text', text: 'Lo preparo esta tarde' }],
  state: 'done',
  steps: [],
  createdAt: new Date().toISOString(),
};

describe("an agent's ghost beside its message", () => {
  it('opens its page', async () => {
    await render(<MessageView message={reply} mine={false} ghost="base" showAuthor names={[]} />);
    expect(screen.getByText('Lo preparo esta tarde')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Ver la ficha de Secretaría'));
    expect(router.push).toHaveBeenCalledWith('/agente/agent-1');
  });

  it('is only a picture when the agent is unknown', async () => {
    await render(<MessageView message={{ ...reply, authorAgentId: null }} mine={false} showAuthor names={[]} />);
    expect(screen.getByText('Lo preparo esta tarde')).toBeTruthy();
    expect(screen.queryByLabelText('Ver la ficha de Secretaría')).toBeNull();
  });
});
