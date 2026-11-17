import type { Decision } from '@ghostaff/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DecisionCard } from '@/components/DecisionCard';
import { answerLabel, dueLabel, kindLabel, shortDate } from '@/lib/format';
import { friendlyAuthError } from '@/lib/auth/errors';

const decision: Decision = {
  id: 'd1',
  orgId: 'o1',
  recordId: 'seo-envites',
  sourcePath: 'por-decidir/seo-envites.yaml',
  area: 'seo',
  kind: 'publicar-web',
  question: '¿Vuelves a publicar el título nuevo?',
  context: 'Porque la release lo quitó.',
  proposedBy: 'seo',
  createdOn: '2026-11-09',
  ruleProposal: null,
  recommendation: null,
  ifYes: null,
  ifNo: null,
  quote: null,
  sources: [],
  dueOn: null,
  answer: null,
  closedAt: null,
};

describe('DecisionCard', () => {
  it('shows the question, who asks and a dot while it waits', async () => {
    const onPress = jest.fn();
    await render(<DecisionCard decision={decision} onPress={onPress} />);
    expect(screen.getByText('¿Vuelves a publicar el título nuevo?')).toBeTruthy();
    expect(screen.getByText('Redes · ')).toBeTruthy();
    expect(screen.getByText('9 nov')).toBeTruthy();
    expect(screen.getByTestId('waiting-dot')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalled();
  });

  it('drops the dot once answered and says whether the agent has it', async () => {
    const answered: Decision = {
      ...decision,
      answer: { answer: 'ok', byName: 'Álvaro', at: '2026-11-12T09:00:00Z', note: null, signedText: null, source: 'app', writtenBackAt: null },
    };
    await render(<DecisionCard decision={answered} onPress={() => {}} />);
    expect(screen.queryByTestId('waiting-dot')).toBeNull();
    expect(screen.getByText('OK de Álvaro · llegando al registro')).toBeTruthy();
  });
});

describe('format', () => {
  it('says when a decision is due, and whether it is urgent', () => {
    expect(dueLabel('2026-11-17', '2026-11-17')).toEqual({ text: 'Vence hoy', urgent: true });
    expect(dueLabel('2026-11-18', '2026-11-17')).toEqual({ text: 'Vence mañana', urgent: false });
    expect(dueLabel('2026-11-30', '2026-11-17')).toEqual({ text: 'Vence el 30 nov', urgent: false });
    expect(dueLabel('2026-11-10', '2026-11-17')).toEqual({ text: 'Venció el 10 nov', urgent: true });
  });

  it('reads a decision kind', () => {
    expect(kindLabel('quien-pago')).toBe('Quien pago');
  });

  it('writes short Spanish dates', () => {
    expect(shortDate('2026-01-03')).toBe('3 ene');
  });

  it('says an answer from the record is with the agent', () => {
    expect(answerLabel({ answer: 'no', byName: 'Jaime', at: '', note: null, signedText: null, source: 'record', writtenBackAt: '' })).toBe(
      'No de Jaime · el agente la tiene',
    );
  });

  it('explains a sign-up while sign-ups are closed', () => {
    expect(friendlyAuthError(new Error('Signups not allowed for otp'))).toMatch(/no se pueden crear cuentas/);
  });
});
