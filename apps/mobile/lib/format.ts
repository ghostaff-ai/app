import type { DecisionAnswer } from '@ghostaff/shared';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `2026-11-07` → `7 nov`. */
export function shortDate(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split('-');
  const month = MONTHS[Number(m) - 1];
  return month && d ? `${Number(d)} ${month}` : isoDate;
}

/** One line on what was answered and whether the agent has it yet. */
export function answerLabel(a: DecisionAnswer): string {
  const what = a.answer === 'ok' ? 'OK' : 'No';
  const who = a.byName ? ` de ${a.byName}` : '';
  const where = a.source === 'app' && !a.writtenBackAt ? ' · llegando al registro' : ' · el agente la tiene';
  return `${what}${who}${where}`;
}
