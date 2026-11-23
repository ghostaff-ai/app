import type { Decision } from '@ghostaff/shared';
import { asideCount, canSwipe, deckOf, pickLabel, tomorrowMorning } from '@/lib/deck';

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
  answer: null,
  closedAt: null,
  ...more,
});

const answered: NonNullable<Decision['answer']> = { answer: 'ok', byName: 'Ana', at: '2026-11-21T10:00:00Z', note: null, signedText: null, source: 'app', writtenBackAt: null };

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
});
