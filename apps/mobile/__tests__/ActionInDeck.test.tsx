import type { Decision } from '@ghostaff/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { DecisionDeck, DeckToast } from '@/components/DecisionDeck';

// An agent's action waiting for an OK, as a card of the deck (decision-model.md, PR 3).
const card: Decision = {
  id: 'a1',
  orgId: 'o',
  recordId: '',
  sourcePath: '',
  area: '',
  kind: 'accion',
  question: 'Publicar en Instagram',
  context: 'texto: Hola a todos',
  proposedBy: 'Redes',
  createdOn: '2026-11-25',
  ruleProposal: null,
  recommendation: 'Aprobar',
  ifYes: null,
  ifNo: null,
  quote: null,
  sources: [],
  dueOn: null,
  options: [],
  recommendedOption: null,
  highStakes: false,
  agent: { id: 'g1', name: 'Redes', ghost: 'redes' },
  answer: null,
  closedAt: null,
  action: { id: 'a1', threadId: 't1' },
};

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  NotificationFeedbackType: { Success: 'success' },
}));

describe('an action in the deck', () => {
  it('shows what it will do, and opens its conversation on a tap', async () => {
    await render(<DecisionDeck cards={[card]} onMove={jest.fn()} />);
    expect(screen.getByText('texto: Hola a todos')).toBeTruthy();
    expect(screen.getByText('Al aprobarlo se hace enseguida y no se puede deshacer')).toBeTruthy();
    fireEvent.press(screen.getByTestId('deck-card'));
    expect(router.push).toHaveBeenCalledWith('/conversacion/t1');
  });

  it('is approved with «Aprobar», turned down with «No», or left for later', async () => {
    const onMove = jest.fn();
    await render(<DecisionDeck cards={[card]} onMove={onMove} />);
    expect(screen.getByTestId('deck-ok')).toHaveTextContent('Aprobar');
    fireEvent.press(screen.getByTestId('deck-no'));
    expect(onMove).toHaveBeenCalledWith(card, 'no', undefined);
  });

  it('cannot be undone once approved, only once left for later', async () => {
    await render(<DeckToast move={{ decision: card, kind: 'ok' }} onUndo={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByText('Aprobado: se está haciendo')).toBeTruthy();
    expect(screen.queryByTestId('deck-undo')).toBeNull();
    await render(<DeckToast move={{ decision: card, kind: 'later' }} onUndo={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByTestId('deck-undo')).toBeTruthy();
  });
});
