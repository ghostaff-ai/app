import { MAX_ROUTINES_PER_PERSON } from '@ghostaff/shared';

// The routine form's small rules (agent-routines.md), apart so they are tested.

/** «9», «9:30», «09:05» → hour and minute; null when it is not an hour. */
export function parseClock(raw: string): { hour: number; minute: number } | null {
  const m = /^\s*(\d{1,2})(?:[:.h](\d{2}))?\s*$/.exec(raw);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** A routine's name from what it does, when the person gives none: its first words. */
export function titleFrom(instruction: string): string {
  const clean = instruction.trim().replace(/\s+/g, ' ');
  if (clean.length <= 40) return clean;
  const cut = clean.slice(0, 40);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20))}…`;
}

export function routineRefusal(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === '54000') return `Ya tienes ${MAX_ROUTINES_PER_PERSON} tareas programadas, el máximo. Borra alguna para crear otra.`;
  if (code === '42501') return 'No puedes cambiar esta tarea programada: la de todo el equipo solo la cambia quien es propietario.';
  if (code === '23514' || code === '22023') return 'Revisa los datos: algo no es válido.';
  return 'No se ha guardado. Vuelve a intentarlo en un momento.';
}

