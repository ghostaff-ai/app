import type { DecisionAnswer } from '@ghostaff/shared';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `2026-11-07` → `7 nov`. */
export function shortDate(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split('-');
  const month = MONTHS[Number(m) - 1];
  return month && d ? `${Number(d)} ${month}` : isoDate;
}

/** One line on what was answered and whether the agent has it yet. */
export function answerLabel(a: DecisionAnswer, agent: string): string {
  const what = a.answer === 'ok' ? 'OK' : 'No';
  const who = a.byName ? ` de ${a.byName}` : '';
  const where = a.source === 'app' && !a.writtenBackAt ? ` · ${agent} aún no lo ha recogido` : ` · ${agent} ya lo tiene`;
  return `${what}${who}${where}`;
}

/** A local `YYYY-MM-DD` for today, to compare with a decision's `dueOn`. */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000;

/** When a decision stops being useful, in words, and whether that is today or past. */
export function dueLabel(dueOn: string, today = todayIso()): { text: string; urgent: boolean } {
  const days = dayNumber(dueOn) - dayNumber(today);
  if (days < 0) return { text: `Venció el ${shortDate(dueOn)}`, urgent: true };
  if (days === 0) return { text: 'Vence hoy', urgent: true };
  if (days === 1) return { text: 'Vence mañana', urgent: false };
  return { text: `Vence el ${shortDate(dueOn)}`, urgent: false };
}

/** `quien-pago` → `Quien pago`: a decision kind as a person reads it. */
export function kindLabel(kind: string): string {
  const words = kind.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An instant as «10:30» today, else «7 nov». */
export function whenLabel(iso: string, now = new Date()): string {
  const at = new Date(iso);
  if (todayIso(at) === todayIso(now)) return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  return shortDate(todayIso(at));
}

/** The first line an agent said, without markdown marks: what a folded row shows. */
export function firstLine(text: string | null): string {
  const line = (text ?? '').split('\n').map((l) => l.replace(/^[#>*\-•\s]+/, '').replace(/\*\*/g, '').trim()).find(Boolean);
  return line ?? 'Hecho.';
}
