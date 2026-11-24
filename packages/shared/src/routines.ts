// Routines (docs/plans/ongoing/agent-routines.md): what a person asks an
// agent to do on its own at an hour. The timetable is fields, never cron
// (supabase/migrations/20261126000000_agent_routines.sql); this file is the
// one place that turns them into the next time it fires, for the engine's
// tick and the app's clock, and into the words people read («Cada viernes, 9:00»).

export const ROUTINE_AUDIENCES = ['me', 'team'] as const;
export type RoutineAudience = (typeof ROUTINE_AUDIENCES)[number];

export const ROUTINE_KINDS = ['days', 'monthly'] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];

/** ISO weekdays: 1 Monday … 7 Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const ALL_WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

/** How many routines one person may have in one organisation (decision 2). */
export const MAX_ROUTINES_PER_PERSON = 10;

/** When a routine fires: on some weekdays (all seven is every day), or on one day of each month. */
export interface RoutineWhen {
  kind: RoutineKind;
  /** For `days`. */
  weekdays: Weekday[];
  /** For `monthly`: 1 to 28, so every month has it. */
  monthDay: number | null;
  hour: number;
  minute: number;
}

export interface Routine extends RoutineWhen {
  id: string;
  orgId: string;
  agentId: string;
  createdBy: string | null;
  audience: RoutineAudience;
  /** A few words: «Resumen de ventas». */
  title: string;
  /** What the agent is asked, as the person would write it. */
  instruction: string;
  /** IANA zone the hours are in; the organisation's, Madrid by default. */
  timezone: string;
  paused: boolean;
  /** Why the engine paused it: its creator left, or can no longer talk to the agent. */
  pausedReason: 'creator_gone' | null;
  lastFiredAt: string;
  createdAt: string;
}

export const DEFAULT_TIMEZONE = 'Europe/Madrid';

/** Why a timetable is not valid, in words a person reads; null when it is. */
export function invalidWhen(w: RoutineWhen): string | null {
  if (!ROUTINE_KINDS.includes(w.kind)) return 'Elige cada cuánto.';
  if (!Number.isInteger(w.hour) || w.hour < 0 || w.hour > 23) return 'La hora tiene que estar entre 0 y 23.';
  if (!Number.isInteger(w.minute) || w.minute < 0 || w.minute > 59) return 'Los minutos tienen que estar entre 0 y 59.';
  if (w.kind === 'days') {
    if (w.weekdays.length === 0) return 'Elige al menos un día.';
    if (w.weekdays.some((d) => !ALL_WEEKDAYS.includes(d))) return 'Los días van del lunes (1) al domingo (7).';
  }
  if (w.kind === 'monthly' && (w.monthDay === null || !Number.isInteger(w.monthDay) || w.monthDay < 1 || w.monthDay > 28)) {
    return 'El día del mes tiene que estar entre 1 y 28.';
  }
  return null;
}

const sortedDays = (days: readonly Weekday[]): Weekday[] => [...new Set(days)].sort((a, b) => a - b) as Weekday[];

const DAY_NAMES: Record<Weekday, string> = { 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábado', 7: 'domingo' };
export const DAY_SHORT: Record<Weekday, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' };
/** One letter per day, as the day picker shows them. */
export const DAY_LETTER: Record<Weekday, string> = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 7: 'D' };

export const clock = (hour: number, minute: number) => `${hour}:${String(minute).padStart(2, '0')}`;

function joinEs(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} y ${words[words.length - 1]}`;
}

/** «Cada día, 9:00», «De lunes a viernes, 8:30», «Cada viernes, 9:00», «Lunes y jueves, 8:00», «El día 2 de cada mes, 9:30». */
export function describeWhen(w: RoutineWhen): string {
  const at = clock(w.hour, w.minute);
  if (w.kind === 'monthly') return `El día ${w.monthDay} de cada mes, ${at}`;
  const days = sortedDays(w.weekdays);
  if (days.length === 7) return `Cada día, ${at}`;
  if (days.join() === '1,2,3,4,5') return `De lunes a viernes, ${at}`;
  if (days.join() === '6,7') return `Los fines de semana, ${at}`;
  if (days.length === 1) return `Cada ${DAY_NAMES[days[0]!]}, ${at}`;
  const text = joinEs(days.map((d) => DAY_NAMES[d]));
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}, ${at}`;
}

/** The wall-clock parts of an instant in a zone. */
function partsIn(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const weekdays: Record<string, Weekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: weekdays[get('weekday')] ?? 1,
  };
}

/** The instant a wall-clock time in a zone is (around a change of hour, the first that matches). */
function instantOf(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = partsIn(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    if (seen === wanted) break;
    guess += wanted - seen;
  }
  return new Date(guess);
}

/** The first time the routine fires strictly after `after`. */
export function nextFire(w: RoutineWhen, after: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  const start = partsIn(after, timeZone);
  // Walk day by day in the zone's calendar, from the day of `after`: a month has every day ≤ 28.
  for (let i = 0; i < 62; i++) {
    const day = new Date(Date.UTC(start.year, start.month - 1, start.day + i));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const weekday = (((day.getUTCDay() + 6) % 7) + 1) as Weekday;
    const fits = w.kind === 'monthly' ? d === w.monthDay : w.weekdays.includes(weekday);
    if (!fits) continue;
    const at = instantOf(y, m, d, w.hour, w.minute, timeZone);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('a routine fires at least once every two months');
}

/** Whether the routine had a fire time in (`since`, `now`]. Several missed start one run, not a backlog. */
export function firedBetween(w: RoutineWhen, since: Date, now: Date, timeZone: string = DEFAULT_TIMEZONE): boolean {
  if (invalidWhen(w)) return false;
  return nextFire(w, since, timeZone).getTime() <= now.getTime();
}

/** «Vie 9:00» for the clock on the chat; «Hoy 9:00» or «Mañana 9:00» when it is that close. */
export function shortNext(w: RoutineWhen, now: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const at = nextFire(w, now, timeZone);
  const a = partsIn(at, timeZone);
  const n = partsIn(now, timeZone);
  const dayDiff = Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(n.year, n.month - 1, n.day)) / 86_400_000);
  const day = dayDiff === 0 ? 'Hoy' : dayDiff === 1 ? 'Mañana' : DAY_SHORT[a.weekday];
  return `${day} ${clock(a.hour, a.minute)}`;
}

/** The routine that fires first among the live ones, or null. */
export function soonest<T extends RoutineWhen & { paused: boolean; timezone: string }>(routines: readonly T[], now: Date): T | null {
  let best: { r: T; at: number } | null = null;
  for (const r of routines) {
    if (r.paused || invalidWhen(r)) continue;
    const at = nextFire(r, now, r.timezone).getTime();
    if (!best || at < best.at) best = { r, at };
  }
  return best?.r ?? null;
}
