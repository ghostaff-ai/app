// The health metrics every band maps into (docs/plans/ongoing/wearables.md):
// our names, shared by every brand, so an agent or a page reads «hrv_ms» the
// same whether it came from Whoop or Google. A brand that lacks one simply has
// no row for it.

export const METRICS = {
  strain: { unit: 'score' },
  energy_kj: { unit: 'kJ' },
  avg_hr_bpm: { unit: 'bpm' },
  max_hr_bpm: { unit: 'bpm' },
  resting_hr_bpm: { unit: 'bpm' },
  recovery_pct: { unit: '%' },
  spo2_pct: { unit: '%' },
  sleep_performance_pct: { unit: '%' },
  sleep_efficiency_pct: { unit: '%' },
  sleep_consistency_pct: { unit: '%' },
  hrv_ms: { unit: 'ms' },
  skin_temp_c: { unit: '°C' },
  respiratory_rate: { unit: 'breaths/min' },
  sleep_minutes: { unit: 'min' },
  in_bed_minutes: { unit: 'min' },
  light_sleep_minutes: { unit: 'min' },
  deep_sleep_minutes: { unit: 'min' },
  rem_sleep_minutes: { unit: 'min' },
  awake_minutes: { unit: 'min' },
  workout_minutes: { unit: 'min' },
  workout_count: { unit: 'count' },
  weight_kg: { unit: 'kg' },
  height_m: { unit: 'm' },
} as const satisfies Record<string, { unit: string }>;

export type MetricName = keyof typeof METRICS;

/** A maker's record as it came, ready for `health.records`. */
export interface HealthRecord {
  kind: 'cycle' | 'recovery' | 'sleep' | 'workout' | 'body';
  externalId: string;
  startsAt: string | null;
  endsAt: string | null;
  payload: Record<string, unknown>;
}

/** One value for one day, ready for `health.metrics`. */
export interface DailyMetric {
  day: string;
  metric: MetricName;
  value: number;
  unit: string;
}

export function dailyMetric(day: string, metric: MetricName, value: number): DailyMetric {
  return { day, metric, value, unit: METRICS[metric].unit };
}
