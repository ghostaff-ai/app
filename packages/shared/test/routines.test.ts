import { describe, expect, it } from 'vitest';
import { describeWhen, firedBetween, invalidWhen, nextFire, type RoutineWhen, shortNext, soonest } from '../src/routines';

const fridays: RoutineWhen = { kind: 'days', weekdays: [5], monthDay: null, hour: 9, minute: 0 };
const weekdays: RoutineWhen = { kind: 'days', weekdays: [1, 2, 3, 4, 5], monthDay: null, hour: 8, minute: 30 };
const monthly: RoutineWhen = { kind: 'monthly', weekdays: [1, 2, 3, 4, 5, 6, 7], monthDay: 2, hour: 9, minute: 30 };

describe('a routine in words', () => {
  it('reads as people say it', () => {
    expect(describeWhen(fridays)).toBe('Cada viernes, 9:00');
    expect(describeWhen(weekdays)).toBe('De lunes a viernes, 8:30');
    expect(describeWhen({ ...fridays, weekdays: [1, 2, 3, 4, 5, 6, 7] })).toBe('Cada día, 9:00');
    expect(describeWhen({ ...fridays, weekdays: [4, 1] })).toBe('Lunes y jueves, 9:00');
    expect(describeWhen({ ...fridays, weekdays: [1, 3, 5] })).toBe('Lunes, miércoles y viernes, 9:00');
    expect(describeWhen({ ...fridays, weekdays: [6, 7] })).toBe('Los fines de semana, 9:00');
    expect(describeWhen(monthly)).toBe('El día 2 de cada mes, 9:30');
  });

  it('says what is wrong with a timetable', () => {
    expect(invalidWhen(fridays)).toBeNull();
    expect(invalidWhen({ ...fridays, weekdays: [] })).toBe('Elige al menos un día.');
    expect(invalidWhen({ ...fridays, hour: 24 })).toMatch(/hora/);
    expect(invalidWhen({ ...monthly, monthDay: 31 })).toMatch(/entre 1 y 28/);
  });
});

describe('when a routine fires', () => {
  // Tuesday 24 November 2026, 10:00 in Madrid (UTC+1).
  const tuesday = new Date('2026-11-24T09:00:00Z');

  it('is its next hour in its own zone', () => {
    expect(nextFire(fridays, tuesday).toISOString()).toBe('2026-11-27T08:00:00.000Z');
    expect(nextFire(weekdays, tuesday).toISOString()).toBe('2026-11-25T07:30:00.000Z');
    expect(nextFire(monthly, tuesday).toISOString()).toBe('2026-12-02T08:30:00.000Z');
    expect(nextFire(fridays, tuesday, 'America/New_York').toISOString()).toBe('2026-11-27T14:00:00.000Z');
  });

  it('follows the change of hour', () => {
    // Summer time in Madrid (UTC+2) from 29 March 2026.
    expect(nextFire(fridays, new Date('2026-03-30T00:00:00Z')).toISOString()).toBe('2026-04-03T07:00:00.000Z');
  });

  it('fires once for the hours it missed, never twice for the same one', () => {
    const at = nextFire(fridays, tuesday);
    expect(firedBetween(fridays, tuesday, new Date(at.getTime() - 1))).toBe(false);
    expect(firedBetween(fridays, tuesday, at)).toBe(true);
    expect(firedBetween(fridays, at, new Date(at.getTime() + 3600_000))).toBe(false);
  });

  it('shows the next one short, for the clock', () => {
    expect(shortNext(fridays, tuesday)).toBe('Vie 9:00');
    expect(shortNext(weekdays, tuesday)).toBe('Mañana 8:30');
    expect(shortNext({ ...fridays, weekdays: [2], hour: 18 }, tuesday)).toBe('Hoy 18:00');
  });

  it('knows which live routine comes first', () => {
    const tz = 'Europe/Madrid';
    const list = [
      { ...fridays, paused: false, timezone: tz, id: 'f' },
      { ...weekdays, paused: true, timezone: tz, id: 'w' },
      { ...monthly, paused: false, timezone: tz, id: 'm' },
    ];
    expect(soonest(list, tuesday)?.id).toBe('f');
    expect(soonest([list[1]!], tuesday)).toBeNull();
  });
});
