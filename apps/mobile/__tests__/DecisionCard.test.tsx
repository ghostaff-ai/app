import type { Decision } from '@ghostaff/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DecisionCard } from '@/components/DecisionCard';
import { answerLabel, shortDate } from '@/lib/format';
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
  answer: null,
  closedAt: null,
};

describe('DecisionCard', () => {
  it('shows the question, who asks and a dot while it waits', () => {
    const onPress = jest.fn();
    render(<DecisionCard decision={decision} onPress={onPress} />);
    expect(screen.getByText('¿Vuelves a publicar el título nuevo?')).toBeTruthy();
    expect(screen.getByText('seo · seo · 9 nov')).toBeTruthy();
    expect(screen.getByTestId('waiting-dot')).toBeTruthy();
    fireEvent.press(screen.getByRole('button'));
    expect(onPress).toHaveBeenCalled();
  });

  it('drops the dot once answered and says whether the agent has it', () => {
    const answered: Decision = {
      ...decision,
      answer: { answer: 'ok', byName: 'Álvaro', at: '2026-11-12T09:00:00Z', note: null, signedText: null, source: 'app', writtenBackAt: null },
    };
    render(<DecisionCard decision={answered} onPress={() => {}} />);
    expect(screen.queryByTestId('waiting-dot')).toBeNull();
    expect(screen.getByText('OK de Álvaro · llegando al registro')).toBeTruthy();
  });
});

describe('format', () => {
  it('writes short Spanish dates', () => {
    expect(shortDate('2026-01-03')).toBe('3 ene');
  });

  it('says an answer from the record is with the agent', () => {
    expect(answerLabel({ answer: 'no', byName: 'Jaime', at: '', note: null, signedText: null, source: 'record', writtenBackAt: '' })).toBe(
      'No de Jaime · el agente la tiene',
    );
  });

  it('explains a sign-in by someone nobody added', () => {
    expect(friendlyAuthError(new Error('Signups not allowed for otp'))).toMatch(/no está en ninguna organización/);
  });
});
