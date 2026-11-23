import { describe, expect, it } from 'vitest';
import { type DailyMetric, METRICS, type WhoopDump, whoopDailyMetrics, whoopRecords } from '../src/health';

const H = 3_600_000;

function dump(over: Partial<WhoopDump> = {}): WhoopDump {
  return {
    profile: { user_id: 42 },
    body_measurement: {},
    cycles: [],
    recoveries: [],
    sleeps: [],
    workouts: [],
    exportedAt: '2026-11-23T10:10:10Z',
    ...over,
  };
}

function cycle(id: number, start: string, end: string | null, offset: string, score: object | null, state = 'SCORED') {
  return { id, user_id: 42, start, end, timezone_offset: offset, score_state: state, score };
}

function sleep(id: string, start: string, end: string, offset: string, stages: Record<string, number>, extra: object = {}) {
  return {
    id,
    user_id: 42,
    start,
    end,
    timezone_offset: offset,
    nap: false,
    score_state: 'SCORED',
    score: {
      stage_summary: {
        total_in_bed_time_milli: 0,
        total_awake_time_milli: 0,
        total_light_sleep_time_milli: 0,
        total_slow_wave_sleep_time_milli: 0,
        total_rem_sleep_time_milli: 0,
        ...stages,
      },
      respiratory_rate: 15,
      sleep_performance_percentage: 90,
      sleep_efficiency_percentage: 92,
      sleep_consistency_percentage: 80,
    },
    ...extra,
  };
}

function metrics(d: WhoopDump): DailyMetric[] {
  return whoopDailyMetrics(whoopRecords(d));
}

function find(ms: DailyMetric[], day: string, metric: string) {
  return ms.find((m) => m.day === day && m.metric === metric);
}

describe('Whoop daily metrics', () => {
  it('cycle day is the wake day', () => {
    const ms = metrics(dump({
      cycles: [cycle(1, '2026-11-09T22:30:00.000Z', '2026-11-10T21:00:00.000Z', '+01:00', { strain: 12.3, kilojoule: 9000, average_heart_rate: 70, max_heart_rate: 160 })],
    }));
    expect(find(ms, '2026-11-10', 'strain')).toEqual({ day: '2026-11-10', metric: 'strain', value: 12.3, unit: 'score' });
    expect(find(ms, '2026-11-10', 'energy_kj')?.value).toBe(9000);
    expect(ms.some((m) => m.day === '2026-11-09')).toBe(false);
  });

  it('negative offset', () => {
    const ms = metrics(dump({
      sleeps: [sleep('a', '2026-11-09T21:00:00.000Z', '2026-11-10T04:30:00.000Z', '-05:00', { total_light_sleep_time_milli: 4 * H })],
    }));
    expect(find(ms, '2026-11-09', 'sleep_minutes')?.value).toBe(240);
    expect(ms.some((m) => m.day === '2026-11-10')).toBe(false);
  });

  it('recovery takes its cycle\'s day', () => {
    const ms = metrics(dump({
      cycles: [cycle(1, '2026-11-09T22:30:00.000Z', '2026-11-10T21:00:00.000Z', '+01:00', { strain: 12.3 })],
      recoveries: [{ cycle_id: 1, sleep_id: 'a', user_id: 42, score_state: 'SCORED', score: { recovery_score: 66, resting_heart_rate: 52, hrv_rmssd_milli: 54.2 } }],
    }));
    expect(find(ms, '2026-11-10', 'hrv_ms')).toEqual({ day: '2026-11-10', metric: 'hrv_ms', value: 54.2, unit: 'ms' });
    expect(find(ms, '2026-11-10', 'recovery_pct')?.value).toBe(66);
    expect(find(ms, '2026-11-10', 'spo2_pct')).toBeUndefined();
  });

  it('skips unscored and open', () => {
    const d = dump({
      cycles: [cycle(2, '2026-11-20T22:00:00.000Z', null, '+01:00', { strain: 3 })],
      sleeps: [{ ...sleep('p', '2026-11-20T22:00:00.000Z', '2026-11-21T06:00:00.000Z', '+01:00', { total_light_sleep_time_milli: 8 * H }), score_state: 'PENDING_SCORE' }],
    });
    expect(whoopRecords(d).map((r) => r.kind).sort()).toEqual(['cycle', 'sleep']);
    expect(metrics(d)).toEqual([]);
  });

  it('naps are not the night', () => {
    const ms = metrics(dump({
      sleeps: [
        sleep('n', '2026-11-09T23:00:00.000Z', '2026-11-10T07:00:00.000Z', '+00:00', { total_light_sleep_time_milli: 7 * H }),
        sleep('z', '2026-11-10T14:00:00.000Z', '2026-11-10T14:30:00.000Z', '+00:00', { total_light_sleep_time_milli: 0.5 * H }, { nap: true }),
      ],
    }));
    expect(find(ms, '2026-11-10', 'sleep_minutes')?.value).toBe(420);
  });

  it('two night sleeps add up', () => {
    const ms = metrics(dump({
      sleeps: [
        sleep('s1', '2026-11-09T23:00:00.000Z', '2026-11-10T04:00:00.000Z', '+00:00',
          { total_light_sleep_time_milli: 5 * H, total_in_bed_time_milli: 5.2 * H }, {}),
        { ...sleep('s2', '2026-11-10T05:00:00.000Z', '2026-11-10T07:00:00.000Z', '+00:00',
          { total_light_sleep_time_milli: 2 * H, total_in_bed_time_milli: 2.1 * H }),
          score: { ...sleep('x', '', '', '+00:00', { total_light_sleep_time_milli: 2 * H, total_in_bed_time_milli: 2.1 * H }).score, sleep_performance_percentage: 40 } },
      ],
    }));
    expect(find(ms, '2026-11-10', 'sleep_minutes')?.value).toBe(420);
    expect(find(ms, '2026-11-10', 'in_bed_minutes')?.value).toBe(438);
    expect(find(ms, '2026-11-10', 'sleep_performance_pct')?.value).toBe(90);
  });

  it('workouts count per day', () => {
    const ms = metrics(dump({
      workouts: [
        { id: 'w1', start: '2026-11-10T08:00:00.000Z', end: '2026-11-10T08:45:00.000Z', timezone_offset: '+01:00', score_state: 'SCORED', score: { strain: 8 } },
        { id: 'w2', start: '2026-11-10T18:00:00.000Z', end: '2026-11-10T18:30:00.000Z', timezone_offset: '+01:00', score_state: 'SCORED', score: { strain: 5 } },
      ],
    }));
    expect(find(ms, '2026-11-10', 'workout_count')?.value).toBe(2);
    expect(find(ms, '2026-11-10', 'workout_minutes')?.value).toBe(75);
  });

  it('body is dated by the export', () => {
    const ms = metrics(dump({ body_measurement: { weight_kilogram: 78.4, height_meter: 1.8, max_heart_rate: 190 } }));
    expect(find(ms, '2026-11-23', 'weight_kg')?.value).toBe(78.4);
    expect(find(ms, '2026-11-23', 'height_m')?.value).toBe(1.8);
  });

  it('keeps external ids the way the import upserts them', () => {
    const recs = whoopRecords(dump({
      cycles: [cycle(7, '2026-11-09T22:30:00.000Z', '2026-11-10T21:00:00.000Z', '+01:00', { strain: 1 })],
      recoveries: [{ cycle_id: 7, sleep_id: 'a', score_state: 'SCORED', score: {} }],
      body_measurement: { weight_kilogram: 78.4 },
    }));
    expect(recs.map((r) => [r.kind, r.externalId])).toEqual([['body', 'body:2026-11-23'], ['cycle', '7'], ['recovery', '7']]);
    expect(recs[0]?.startsAt).toBe('2026-11-23T10:10:10Z');
  });

  it('units come from the catalogue', () => {
    const ms = metrics(dump({
      cycles: [cycle(1, '2026-11-09T22:30:00.000Z', '2026-11-10T21:00:00.000Z', '+01:00', { strain: 12.3, kilojoule: 9000, average_heart_rate: 70, max_heart_rate: 160 })],
      recoveries: [{ cycle_id: 1, score_state: 'SCORED', score: { recovery_score: 66, resting_heart_rate: 52, hrv_rmssd_milli: 54.2, spo2_percentage: 96, skin_temp_celsius: 33.1 } }],
      sleeps: [sleep('a', '2026-11-09T22:30:00.000Z', '2026-11-10T06:30:00.000Z', '+01:00', { total_light_sleep_time_milli: 4 * H, total_slow_wave_sleep_time_milli: H, total_rem_sleep_time_milli: H, total_awake_time_milli: 0.5 * H, total_in_bed_time_milli: 6.5 * H })],
      body_measurement: { weight_kilogram: 78.4 },
    }));
    expect(ms.length).toBeGreaterThan(15);
    for (const m of ms) expect(m.unit).toBe(METRICS[m.metric].unit);
  });
});
