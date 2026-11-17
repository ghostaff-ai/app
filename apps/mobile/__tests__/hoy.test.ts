import type { Decision } from '@ghostaff/shared';
import { greeting, hello, waitingSentence } from '@/lib/hoy';

const d = (over: Partial<Decision>): Decision => ({ id: Math.random().toString(), answer: null, dueOn: null, ...over }) as Decision;

describe('Secretaría on Hoy', () => {
  it('greets by the hour', () => {
    expect(greeting(9)).toBe('Buenos días');
    expect(greeting(16)).toBe('Buenas tardes');
    expect(greeting(23)).toBe('Buenas noches');
    expect(greeting(3)).toBe('Buenas noches');
  });

  it('uses the first name only, or none', () => {
    const nine = new Date(2026, 10, 17, 9);
    expect(hello('Álvaro Francisco Gil', nine)).toBe('Buenos días, Álvaro.');
    expect(hello(null, nine)).toBe('Buenos días.');
  });

  it('counts what waits and what is due today', () => {
    const today = '2026-11-17';
    expect(waitingSentence([], today)).toMatch(/^No te espera nada/);
    expect(waitingSentence([d({})], today)).toBe('Una cosa te espera.');
    expect(waitingSentence([d({ dueOn: today })], today)).toBe('Una cosa te espera, y vence hoy.');
    expect(waitingSentence([d({}), d({ dueOn: '2026-11-16' }), d({ dueOn: '2026-12-01' })], today)).toBe('Tres cosas te esperan. Una vence hoy.');
    expect(waitingSentence([d({ answer: { answer: 'ok' } as Decision['answer'] })], today)).toMatch(/^No te espera nada/);
  });
});
