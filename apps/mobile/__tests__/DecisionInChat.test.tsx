import type { Decision } from '@ghostaff/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { DecisionInChat } from '@/components/chat/DecisionInChat';

const base: Decision = {
  id: 'd1',
  orgId: 'o',
  recordId: 'redes-x',
  sourcePath: 'por-decidir/redes-x.yaml',
  area: 'marketing',
  kind: 'cuando-publicar',
  question: '¿Cuándo publico?',
  context: 'ctx',
  proposedBy: 'redes',
  createdOn: '2026-11-25',
  ruleProposal: null,
  recommendation: 'El lunes',
  ifYes: null,
  ifNo: null,
  quote: null,
  sources: [],
  dueOn: null,
  options: [
    { id: 'lunes', text: 'El lunes' },
    { id: 'viernes', text: 'El viernes' },
  ],
  recommendedOption: 'lunes',
  highStakes: false,
  agent: { id: 'a1', name: 'Redes', ghost: 'redes' },
  answer: null,
  closedAt: null,
};

let mockDecision: Decision | null = base;
const mockAnswer = jest.fn(async () => {});
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('@/lib/hooks/useDecisions', () => ({
  useDecision: () => ({ decision: mockDecision, loading: false, answer: mockAnswer }),
}));

describe('a decision in the agent\'s message', () => {
  beforeEach(() => {
    mockDecision = base;
    mockAnswer.mockClear();
  });

  it('answers with one of its options, here as in the deck', async () => {
    await render(<DecisionInChat part={{ type: 'decision', decisionId: 'd1', question: '¿Cuándo publico?' }} writing={false} />);
    await fireEvent.press(screen.getByTestId('chat-choice-viernes'));
    await waitFor(() => expect(mockAnswer).toHaveBeenCalledWith({ option: 'viernes' }));
  });

  it('says what was answered once it is', async () => {
    mockDecision = {
      ...base,
      answer: { answer: 'no', option: 'viernes', byName: 'Ana', at: '2026-11-25T10:00:00Z', note: null, signedText: null, source: 'app', writtenBackAt: null },
    };
    await render(<DecisionInChat part={{ type: 'decision', decisionId: 'd1', question: '¿Cuándo publico?' }} writing={false} />);
    expect(screen.getByTestId('chat-decision-answered')).toHaveTextContent(/«El viernes» de Ana/);
    expect(screen.queryByTestId('chat-choice-lunes')).toBeNull();
  });

  it('sends a high-stakes one to its own screen, with the pick hidden', async () => {
    mockDecision = { ...base, highStakes: true };
    await render(<DecisionInChat part={{ type: 'decision', decisionId: 'd1', question: '¿Cuándo publico?' }} writing={false} />);
    expect(screen.getByText('Elegir')).toBeTruthy();
    expect(screen.queryByTestId('chat-choice-lunes')).toBeNull();
  });
});
