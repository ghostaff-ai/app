import type { Decision } from '@ghostaff/shared';
import { todayIso } from './format';

// What Secretaría says on top of Hoy (app-design.md, «The idea»): one sentence,
// in the first person and with «tú» (decision 17). Written here from what the
// app already knows; when the engine can talk, Secretaría writes it herself.

const WORDS = ['cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];
const count = (n: number) => WORDS[n] ?? String(n);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function greeting(hour: number): string {
  if (hour >= 6 && hour < 14) return 'Buenos días';
  if (hour >= 14 && hour < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

/** «Buenos días, Álvaro.» with the person's first name, if we have it. */
export function hello(fullName: string | null | undefined, now = new Date()): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0];
  return first ? `${greeting(now.getHours())}, ${first}.` : `${greeting(now.getHours())}.`;
}

/** What waits, in one sentence: how many, and how many are due today or overdue. */
export function waitingSentence(decisions: Decision[], today = todayIso()): string {
  const waiting = decisions.filter((d) => !d.answer);
  if (waiting.length === 0) return 'No te espera nada. Cuando algo necesite tu OK, te lo traigo aquí.';
  const due = waiting.filter((d) => d.dueOn && d.dueOn <= today).length;
  const head = waiting.length === 1 ? 'Una cosa te espera.' : `${capital(count(waiting.length))} cosas te esperan.`;
  if (due === 0) return head;
  if (waiting.length === 1) return 'Una cosa te espera, y vence hoy.';
  return `${head} ${due === 1 ? 'Una vence hoy.' : `${capital(count(due))} vencen hoy.`}`;
}
