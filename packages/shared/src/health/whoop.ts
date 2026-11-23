// Whoop's records (Developer API v2, as the export script dumps them) and the
// daily metrics they give (docs/plans/ongoing/wearables.md, phase 1).
//
// Which day a record belongs to, in the record's own time zone:
// - a cycle begins when you fall asleep, so its day is the local date of
//   start + 12 h (23:30 on Monday is Tuesday's cycle);
// - a sleep counts for the day you wake up (local date of its end);
// - a recovery for its cycle's day; a workout for the day it starts;
// - the body measurement has no date, so it is dated by the export.
// Only scored records give metrics; a cycle still open (no end) gives none.

import { type DailyMetric, dailyMetric, type HealthRecord, type MetricName } from './metrics';

type Obj = Record<string, unknown>;

export interface WhoopDump {
  profile: { user_id: number | string };
  body_measurement: Obj;
  cycles: unknown[];
  recoveries: unknown[];
  sleeps: unknown[];
  workouts: unknown[];
  /** When the dump was made (ISO 8601). */
  exportedAt: string;
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** Minutes east of UTC from «+01:00» / «-05:00»; 0 when absent or odd. */
function offsetMinutes(offset: unknown): number {
  const m = typeof offset === 'string' ? /^([+-])(\d{2}):?(\d{2})$/.exec(offset) : null;
  if (!m) return 0;
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -mins : mins;
}

function localDay(iso: string, offset: unknown, shiftMs = 0): string {
  const t = Date.parse(iso) + offsetMinutes(offset) * MINUTE + shiftMs;
  return new Date(t).toISOString().slice(0, 10);
}

function scored(r: Obj): boolean {
  return r.score_state === 'SCORED';
}

export function whoopRecords(dump: WhoopDump): HealthRecord[] {
  const records: HealthRecord[] = [];
  if (Object.keys(dump.body_measurement).length > 0) {
    records.push({ kind: 'body', externalId: 'body', startsAt: dump.exportedAt, endsAt: null, payload: dump.body_measurement });
  }
  const timed = (kind: HealthRecord['kind'], list: unknown[]) => {
    for (const item of list) {
      const r = obj(item);
      if (r.id === undefined || r.id === null) continue;
      records.push({ kind, externalId: String(r.id), startsAt: str(r.start), endsAt: str(r.end), payload: r });
    }
  };
  timed('cycle', dump.cycles);
  for (const item of dump.recoveries) {
    const r = obj(item);
    if (r.cycle_id === undefined || r.cycle_id === null) continue;
    records.push({ kind: 'recovery', externalId: String(r.cycle_id), startsAt: null, endsAt: null, payload: r });
  }
  timed('sleep', dump.sleeps);
  timed('workout', dump.workouts);
  return records;
}

class Days {
  private values = new Map<string, number>();
  set(day: string, metric: MetricName, value: number | undefined) {
    if (value !== undefined) this.values.set(`${day}|${metric}`, value);
  }
  add(day: string, metric: MetricName, value: number) {
    const key = `${day}|${metric}`;
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }
  list(): DailyMetric[] {
    return [...this.values.entries()]
      .map(([key, value]) => {
        const [day, metric] = key.split('|') as [string, MetricName];
        return dailyMetric(day, metric, value);
      })
      .sort((a, b) => (a.day + a.metric).localeCompare(b.day + b.metric));
  }
}

export function whoopDailyMetrics(records: HealthRecord[]): DailyMetric[] {
  const days = new Days();
  const cycleDays = new Map<string, string>();

  for (const r of records.filter((x) => x.kind === 'cycle')) {
    const p = r.payload;
    if (!r.startsAt) continue;
    const day = localDay(r.startsAt, p.timezone_offset, 12 * HOUR);
    cycleDays.set(r.externalId, day);
    if (!scored(p) || !r.endsAt) continue;
    const s = obj(p.score);
    days.set(day, 'strain', num(s.strain));
    days.set(day, 'energy_kj', num(s.kilojoule));
    days.set(day, 'avg_hr_bpm', num(s.average_heart_rate));
    days.set(day, 'max_hr_bpm', num(s.max_heart_rate));
  }

  for (const r of records.filter((x) => x.kind === 'recovery')) {
    const day = cycleDays.get(r.externalId);
    if (!day || !scored(r.payload)) continue;
    const s = obj(r.payload.score);
    days.set(day, 'recovery_pct', num(s.recovery_score));
    days.set(day, 'resting_hr_bpm', num(s.resting_heart_rate));
    days.set(day, 'hrv_ms', num(s.hrv_rmssd_milli));
    days.set(day, 'spo2_pct', num(s.spo2_percentage));
    days.set(day, 'skin_temp_c', num(s.skin_temp_celsius));
  }

  // Night sleeps by day: durations add up, the rest comes from the longest in bed.
  const nights = new Map<string, Obj[]>();
  for (const r of records.filter((x) => x.kind === 'sleep')) {
    const p = r.payload;
    if (!scored(p) || p.nap === true || !r.endsAt) continue;
    const day = localDay(r.endsAt, p.timezone_offset);
    nights.set(day, [...(nights.get(day) ?? []), obj(p.score)]);
  }
  for (const [day, scores] of nights) {
    const total = (field: string) => scores.reduce((sum, s) => sum + (num(obj(s.stage_summary)[field]) ?? 0), 0);
    const light = total('total_light_sleep_time_milli');
    const deep = total('total_slow_wave_sleep_time_milli');
    const rem = total('total_rem_sleep_time_milli');
    days.set(day, 'sleep_minutes', Math.round((light + deep + rem) / MINUTE));
    days.set(day, 'light_sleep_minutes', Math.round(light / MINUTE));
    days.set(day, 'deep_sleep_minutes', Math.round(deep / MINUTE));
    days.set(day, 'rem_sleep_minutes', Math.round(rem / MINUTE));
    days.set(day, 'awake_minutes', Math.round(total('total_awake_time_milli') / MINUTE));
    days.set(day, 'in_bed_minutes', Math.round(total('total_in_bed_time_milli') / MINUTE));
    const longest = scores.reduce((a, b) =>
      (num(obj(b.stage_summary).total_in_bed_time_milli) ?? 0) > (num(obj(a.stage_summary).total_in_bed_time_milli) ?? 0) ? b : a,
    );
    days.set(day, 'sleep_performance_pct', num(longest.sleep_performance_percentage));
    days.set(day, 'sleep_efficiency_pct', num(longest.sleep_efficiency_percentage));
    days.set(day, 'sleep_consistency_pct', num(longest.sleep_consistency_percentage));
    days.set(day, 'respiratory_rate', num(longest.respiratory_rate));
  }

  for (const r of records.filter((x) => x.kind === 'workout')) {
    const p = r.payload;
    if (!scored(p) || !r.startsAt || !r.endsAt) continue;
    const day = localDay(r.startsAt, p.timezone_offset);
    days.add(day, 'workout_count', 1);
    days.add(day, 'workout_minutes', (Date.parse(r.endsAt) - Date.parse(r.startsAt)) / MINUTE);
  }

  for (const r of records.filter((x) => x.kind === 'body')) {
    if (!r.startsAt) continue;
    const day = r.startsAt.slice(0, 10);
    days.set(day, 'weight_kg', num(r.payload.weight_kilogram));
    days.set(day, 'height_m', num(r.payload.height_meter));
  }

  return days.list().map((m) => (m.metric === 'workout_minutes' ? { ...m, value: Math.round(m.value) } : m));
}
