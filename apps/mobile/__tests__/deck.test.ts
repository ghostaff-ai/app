import type { Decision } from '@ghostaff/shared';
import { answeredLabel, asideCount, canSwipe, choicesOf, deckOf, pickLabel, tomorrowMorning } from '@/lib/deck';
import { askerOf } from '@/lib/team';

const d = (id: string, more: Partial<Decision> = {}): Decision => ({
  id,
  orgId: 'o',
  recordId: id,
  sourcePath: `por-decidir/${id}.yaml`,
  area: 'finanzas',
  kind: 'precio',
  question: `¿${id}?`,
  context: 'ctx',
  proposedBy: 'finanzas',
  createdOn: '2026-11-20',
  ruleProposal: null,
  recommendation: null,
  ifYes: null,
  ifNo: null,
  quote: null,
  sources: [],
  dueOn: null,
  options: [],
  recommendedOption: null,
  highStakes: false,
  agent: null,
  answer: null,
  closedAt: null,
  ...more,
});

const answered: NonNullable<Decision['answer']> = { answer: 'ok', byName: 'Ana', at: '2026-11-21T10:00:00Z', note: null, signedText: null, source: 'app', option: null, writtenBackAt: null };

describe('the decision deck', () => {
  it('brings a card back tomorrow at 8:00', () => {
    const t = tomorrowMorning(new Date(2026, 10, 30, 22, 15));
    expect([t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes()]).toEqual([2026, 11, 1, 8, 0]);
  });

  it('holds what waits, without what was answered, closed, put aside or just gone', () => {
    const all = [d('a'), d('b', { answer: answered }), d('c', { closedAt: '2026-11-21' }), d('e'), d('f')];
    const aside = { e: '2026-11-25T07:00:00Z' };
    expect(deckOf(all, aside).map((x) => x.id)).toEqual(['a', 'f']);
    expect(deckOf(all, aside, { gone: new Set(['a']) }).map((x) => x.id)).toEqual(['f']);
    expect(deckOf(all, aside, { showAside: true }).map((x) => x.id)).toEqual(['a', 'e', 'f']);
    expect(asideCount(all, aside)).toBe(1);
  });

  it('names the main button after the agent\'s pick, and keeps rules off the swipe', () => {
    expect(pickLabel(d('a', { recommendation: ' Subir a 4,20 € ' }))).toBe('Subir a 4,20 €');
    expect(pickLabel(d('a'))).toBe('OK');
    expect(pickLabel(d('r', { kind: 'regla' }))).toBe('Revisar la regla');
    expect(canSwipe(d('a'))).toBe(true);
    expect(canSwipe(d('r', { kind: 'regla' }))).toBe(false);
  });

  const options = {
    options: [
      { id: 'lunes', text: 'El lunes', if: 'Más visitas.' },
      { id: 'viernes', text: 'El viernes' },
    ],
    recommendedOption: 'lunes',
  };

  it('offers each option, the pick marked, and names the pick after it', () => {
    const c = d('o', options);
    expect(choicesOf(c)).toEqual([
      { label: 'El lunes', answer: 'ok', option: 'lunes', pick: true, if: 'Más visitas.' },
      { label: 'El viernes', answer: 'no', option: 'viernes', pick: false },
    ]);
    expect(pickLabel(c)).toBe('El lunes');
    expect(answeredLabel(c, { answer: 'no', option: 'viernes' })).toBe('El viernes');
  });

  it('offers no and the pick for a yes-or-no card, and Sí when the stakes are high', () => {
    expect(choicesOf(d('a', { recommendation: 'Subir', ifYes: 'Más margen.' })).map((c) => [c.label, c.answer, c.if])).toEqual([
      ['No', 'no', undefined],
      ['Subir', 'ok', 'Más margen.'],
    ]);
    expect(choicesOf(d('a', { recommendation: 'Subir', highStakes: true })).map((c) => c.label)).toEqual(['No', 'Sí']);
    expect(canSwipe(d('a', { highStakes: true }))).toBe(false);
  });

  it('shows the agent row that asked, else what propone says', () => {
    expect(askerOf(d('a', { agent: { id: 'x', name: 'Pepa', ghost: 'redes' } }))).toEqual({ name: 'Pepa', ghost: 'redes' });
    expect(askerOf(d('a', { agent: { id: 'x', name: 'Pepa', ghost: 'nope' } })).ghost).toBe('base');
    expect(askerOf(d('a'))).toEqual({ name: 'Finanzas', ghost: 'finanzas' });
  });
});
