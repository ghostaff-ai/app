import { describe, expect, it } from 'vitest';
import { atLimit, estimateCostUsd, limitsFromEvent, limitsFromRow, limitsToRow, mergeLimits, summarizeUsage, type AiUsageDay } from '../src/aiUsage';

// The line Claude Code 2.1.330 wrote on 2026-11-22, session id left out.
const EVENT = {
  type: 'rate_limit_event',
  rate_limit_info: {
    status: 'allowed_warning',
    resetsAt: 1795582800,
    rateLimitType: 'seven_day',
    utilization: 0.98,
    overageStatus: 'rejected',
    isUsingOverage: false,
    surpassedThreshold: 0.75,
    unifiedWindows: {
      five_hour: { utilization: 0.63, resetsAt: 1795363200, status: 'allowed' },
      seven_day: { utilization: 0.98, resetsAt: 1795582800, status: 'allowed_warning', surpassedThreshold: 0.75 },
    },
  },
};

describe('a subscription’s limits', () => {
  const now = new Date('2026-11-22T12:00:00Z');

  it('come from Claude Code’s rate_limit_event, both windows', () => {
    expect(limitsFromEvent(EVENT, now)).toEqual({
      fiveHour: { utilization: 0.63, resetsAt: '2026-11-22T16:00:00.000Z', status: 'allowed' },
      sevenDay: { utilization: 0.98, resetsAt: '2026-11-25T05:00:00.000Z', status: 'allowed_warning' },
      readAt: now.toISOString(),
    });
  });

  it('without the windows, the one the event is about; anything else is not limits', () => {
    const one = { type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'five_hour', utilization: 0.2, resetsAt: 1795363200, status: 'allowed' } };
    expect(limitsFromEvent(one, now)?.fiveHour?.utilization).toBe(0.2);
    expect(limitsFromEvent({ type: 'result' }, now)).toBeNull();
    expect(limitsFromEvent({ type: 'rate_limit_event', rate_limit_info: {} }, now)).toBeNull();
  });

  it('round-trip through the database row, and later windows win', () => {
    const l = limitsFromEvent(EVENT, now)!;
    expect(limitsFromRow(limitsToRow(l))).toEqual(l);
    const later = { fiveHour: { utilization: 0.7, resetsAt: null, status: 'allowed' } };
    expect(mergeLimits(l, later)).toMatchObject({ fiveHour: later.fiveHour, sevenDay: l.sevenDay });
  });

  it('at a limit only while it has not reset', () => {
    const rejected = { sevenDay: { utilization: 1, resetsAt: '2026-11-23T00:00:00Z', status: 'rejected' } };
    expect(atLimit(rejected, now)).toBe(true);
    expect(atLimit(rejected, new Date('2026-11-23T00:00:01Z'))).toBe(false);
    expect(atLimit(limitsFromEvent(EVENT, now), now)).toBe(false);
    expect(atLimit(null, now)).toBe(false);
  });
});

describe('what an account cost', () => {
  it('at list price, cache writes at 1.25× and reads at 0.1× the input price', () => {
    expect(estimateCostUsd('claude-opus-5-5', { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 })).toBe(4 + 20 + 0.4 + 5);
    expect(estimateCostUsd('claude-opus-5-5@vertex', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(4);
    expect(estimateCostUsd('a-model-we-do-not-know', { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });
});

describe('an account’s usage added up', () => {
  const day = (p: Partial<AiUsageDay>): AiUsageDay => ({
    connectionId: 'a',
    agentId: 'finanzas',
    day: '2026-11-20',
    uses: 1,
    failures: 0,
    tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 },
    costUsd: 0.01,
    lastAt: '2026-11-20T10:00:00Z',
    ...p,
  });

  it('per day and per agent, only its own rows', () => {
    const s = summarizeUsage(
      [
        day({}),
        day({ day: '2026-11-21', agentId: 'redes', uses: 3, lastAt: '2026-11-21T09:00:00Z' }),
        day({ day: '2026-11-21', uses: 0, failures: 2, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, costUsd: null, lastAt: '2026-11-21T23:00:00Z' }),
        day({ connectionId: 'b', uses: 99 }),
      ],
      'a',
    );
    expect(s).toMatchObject({ uses: 4, failures: 2, tokens: 30, costUsd: 0.02, lastAt: '2026-11-21T09:00:00Z' });
    expect(s.byDay).toEqual([
      { day: '2026-11-20', uses: 1, tokens: 15 },
      { day: '2026-11-21', uses: 3, tokens: 15 },
    ]);
    expect(s.byAgent[0]).toEqual({ agentId: 'redes', uses: 3, tokens: 15 });
  });

  it('a subscription has no cost', () => {
    expect(summarizeUsage([day({ costUsd: null })], 'a').costUsd).toBeNull();
  });
});
