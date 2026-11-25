import type { Decision } from '@ghostaff/shared';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import DecisionScreen from '@/app/(app)/decision/[id]';

const base: Decision = {
  id: 'd1',
  orgId: 'o1',
  recordId: 'finanzas-porkbun',
  sourcePath: 'por-decidir/finanzas-porkbun.yaml',
  area: 'finanzas',
  kind: 'quien-pago',
  question: '¿Quién pagó los 49,00 € a Porkbun del 12/11?',
  context: 'El extracto no dice quién.',
  proposedBy: 'finanzas',
  createdOn: '2026-11-17',
  ruleProposal: null,
  recommendation: 'Lo pagó la empresa',
  ifYes: 'Lo apunto como gasto de Ghostaff.',
  ifNo: 'Te pregunto quién lo pagó.',
  quote: 'PORKBUN LLC · ghostaff.ai renewal · 49,00 EUR',
  sources: [{ text: 'Extracto bunq, 12/11' }, { text: 'Factura', link: 'https://example.com/f.pdf' }],
  dueOn: null,
  options: [],
  recommendedOption: null,
  highStakes: false,
  agent: null,
  answer: null,
  closedAt: null,
};

let mockCurrent: { decision: Decision | null; streak: number | null } = { decision: base, streak: 6 };
const mockAnswer = jest.fn(async () => {});
const mockTakeBack = jest.fn(async () => {});

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: 'd1' }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('@/lib/hooks/useDecisions', () => ({
  useDecision: () => ({ ...mockCurrent, loading: false, error: null, answer: mockAnswer, takeBack: mockTakeBack }),
}));
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => ({ active: { id: 'o1', displayName: 'Álvaro' } }) }));
// The page that rides on the phone's keyboard, made visible to the test.
jest.mock('@/lib/keyboard', () => {
  const { View } = require('react-native');
  return {
    KeyboardForm: ({ children, footer }: { children: unknown; footer?: unknown }) => (
      <View>
        <View testID="keyboard-page">{children}</View>
        {footer ? <View testID="keyboard-footer">{footer}</View> : null}
      </View>
    ),
  };
});

describe('DecisionScreen', () => {
  beforeEach(() => {
    mockCurrent = { decision: base, streak: 6 };
    mockAnswer.mockClear();
    mockTakeBack.mockClear();
  });

  it('lays out the five parts and puts the recommendation on the main button', async () => {
    await render(<DecisionScreen />);
    expect(screen.getByText('PORKBUN LLC · ghostaff.ai renewal · 49,00 EUR')).toBeTruthy();
    expect(screen.getByText('Extracto bunq, 12/11')).toBeTruthy();
    expect(screen.getByText('Lo apunto como gasto de Ghostaff.')).toBeTruthy();
    expect(screen.getByText('Te pregunto quién lo pagó.')).toBeTruthy();
    expect(screen.getByText('6 de 10 OK seguidos sin corregir a Finanzas en esto.')).toBeTruthy();
    // The prose context is folded when the parts are there.
    expect(screen.queryByText('El extracto no dice quién.')).toBeNull();
    await fireEvent.press(screen.getByText('Todo el contexto'));
    expect(screen.getByText('El extracto no dice quién.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Lo pagó la empresa'));
    expect(mockAnswer).toHaveBeenCalledWith({ answer: 'ok', note: '' });
  });

  // The note is typed at the bottom of the page: unless the page is a
  // KeyboardForm with the buttons as its footer, the keyboard covers the note
  // and the buttons, and you can't see what you type.
  it('rides the answer buttons on the keyboard, the decision scrolling above them', async () => {
    await render(<DecisionScreen />);
    expect(within(screen.getByTestId('keyboard-page')).getByText(base.question)).toBeTruthy();
    expect(within(screen.getByTestId('keyboard-footer')).getByText('Lo pagó la empresa')).toBeTruthy();
  });

  it('shows the context directly for a decision written as prose, with OK', async () => {
    mockCurrent = { decision: { ...base, recommendation: null, ifYes: null, ifNo: null, quote: null, sources: [] }, streak: 0 };
    await render(<DecisionScreen />);
    expect(screen.getByText('El extracto no dice quién.')).toBeTruthy();
    expect(screen.getByText('OK')).toBeTruthy();
    expect(screen.queryByTestId('streak')).toBeNull();
  });

  it('lets you tell the agent something with the answer, and shows it once answered', async () => {
    await render(<DecisionScreen />);
    await fireEvent.press(screen.getByText('Decirle algo a Finanzas'));
    await fireEvent.changeText(screen.getByLabelText('Qué quieres que sepa Finanzas'), 'Apúntalo a marketing');
    await fireEvent.press(screen.getByText('Lo pagó la empresa'));
    expect(mockAnswer).toHaveBeenCalledWith({ answer: 'ok', note: 'Apúntalo a marketing' });

    mockCurrent = {
      decision: { ...base, answer: { answer: 'ok', byName: 'Álvaro', at: '2026-11-17T10:00:00Z', note: 'Apúntalo a marketing', signedText: null, source: 'app', option: null, writtenBackAt: null } },
      streak: 0,
    };
    await screen.rerender(<DecisionScreen />);
    expect(screen.getByText('Le dijiste: «Apúntalo a marketing»')).toBeTruthy();
    expect(screen.getByText('OK de Álvaro · Finanzas aún no lo ha recogido')).toBeTruthy();
  });

  it('lets whoever answered take it back until the agent has it', async () => {
    mockCurrent = {
      decision: { ...base, answer: { answer: 'ok', byName: 'Álvaro', at: '2026-11-17T10:00:00Z', note: null, signedText: null, source: 'app', option: null, writtenBackAt: null } },
      streak: 6,
    };
    await render(<DecisionScreen />);
    await fireEvent.press(screen.getByText('Cambiar la respuesta'));
    expect(mockTakeBack).toHaveBeenCalled();
  });

  it('keeps the answer once the agent has it', async () => {
    mockCurrent = {
      decision: { ...base, answer: { answer: 'ok', byName: 'Álvaro', at: '2026-11-17T10:00:00Z', note: null, signedText: null, source: 'app', option: null, writtenBackAt: '2026-11-17T10:05:00Z' } },
      streak: 7,
    };
    await render(<DecisionScreen />);
    expect(screen.queryByText('Cambiar la respuesta')).toBeNull();
  });
});
