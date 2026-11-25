import { describe, expect, it } from 'vitest';
import {
  type Candidate,
  type DailyRow,
  drainOutbox,
  MAX_ATTEMPTS,
  type OutboxRow,
  type OutboxStore,
  planDaily,
} from '../src/notify';
import type { Device, Outcome, Push, PushTransport } from '../src/push/transport';

const phone = (token: string): Device => ({ token, platform: 'android', apnsEnvironment: null, bundleId: 'club.ordago.ghostaff' });

const row = (p: Partial<OutboxRow> = {}): OutboxRow => ({
  id: 'r1',
  userId: 'u1',
  orgId: 'o1',
  kind: 'reply',
  title: 'Ana',
  body: 'Te ha contestado',
  data: { kind: 'reply' },
  collapseId: 't1',
  attempts: 0,
  ...p,
});

interface Memory {
  store: OutboxStore;
  closed: Record<string, string>;
  retried: Record<string, string>;
  forgotten: string[];
  queued: DailyRow[];
}

function memory(rows: OutboxRow[], devices: Record<string, Device[]>): Memory {
  const m: Memory = {
    closed: {},
    retried: {},
    forgotten: [],
    queued: [],
    store: {
      claim: async (max) => rows.slice(0, max),
      devicesOf: async (userId) => devices[userId] ?? [],
      finish: async (id, outcome) => {
        m.closed[id] = outcome;
      },
      retryLater: async (id, error) => {
        m.retried[id] = error;
      },
      forgetToken: async (token) => {
        m.forgotten.push(token);
      },
      dailyCandidates: async () => [],
      queueDaily: async (r) => {
        m.queued.push(...r);
      },
    },
  };
  return m;
}

/** A transport that answers per token, and remembers what it was asked to send. */
function scripted(byToken: Record<string, Outcome>): PushTransport & { sent: { device: Device; push: Push }[] } {
  const sent: { device: Device; push: Push }[] = [];
  return {
    sent,
    send: async (device, push) => {
      sent.push({ device, push });
      return byToken[device.token] ?? 'retry';
    },
  };
}

describe('drainOutbox', () => {
  it('sends to every device and closes the row as sent', async () => {
    const m = memory([row()], { u1: [phone('a'), phone('b')] });
    const t = scripted({ a: 'delivered', b: 'delivered' });
    expect(await drainOutbox(m.store, t)).toEqual({ sent: 1, skipped: 0, retried: 0 });
    expect(m.closed).toEqual({ r1: 'sent' });
    expect(t.sent.map((s) => s.device.token)).toEqual(['a', 'b']);
    expect(t.sent[0]!.push).toEqual({ title: 'Ana', body: 'Te ha contestado', data: { kind: 'reply' }, collapseId: 't1' });
  });

  it('closes a row as no_device when the person has no phone', async () => {
    const m = memory([row()], {});
    const t = scripted({});
    expect(await drainOutbox(m.store, t)).toEqual({ sent: 0, skipped: 1, retried: 0 });
    expect(m.closed).toEqual({ r1: 'no_device' });
    expect(t.sent).toEqual([]);
  });

  it('forgets a dead token and still counts the row sent when another device got it', async () => {
    const m = memory([row()], { u1: [phone('dead'), phone('ok')] });
    expect(await drainOutbox(m.store, scripted({ dead: 'dead', ok: 'delivered' }))).toEqual({ sent: 1, skipped: 0, retried: 0 });
    expect(m.forgotten).toEqual(['dead']);
    expect(m.closed).toEqual({ r1: 'sent' });
  });

  it('retries later when nothing was delivered, and does not close the row', async () => {
    const m = memory([row({ attempts: 1 })], { u1: [phone('a')] });
    expect(await drainOutbox(m.store, scripted({ a: 'retry' }))).toEqual({ sent: 0, skipped: 0, retried: 1 });
    expect(Object.keys(m.retried)).toEqual(['r1']);
    expect(m.closed).toEqual({});
  });

  it('retries when the only device is dead: the row has nobody left, but dead is not a delivery', async () => {
    const m = memory([row()], { u1: [phone('dead')] });
    expect(await drainOutbox(m.store, scripted({ dead: 'dead' }))).toEqual({ sent: 0, skipped: 0, retried: 1 });
    expect(m.forgotten).toEqual(['dead']);
  });

  it('gives up on the fifth failure', async () => {
    const m = memory([row({ attempts: MAX_ATTEMPTS - 1 })], { u1: [phone('a')] });
    expect(await drainOutbox(m.store, scripted({ a: 'retry' }))).toEqual({ sent: 0, skipped: 1, retried: 0 });
    expect(m.closed).toEqual({ r1: 'gave_up' });
    expect(m.retried).toEqual({});
  });

  it('treats a transport that throws as a retry, and carries on with the next row', async () => {
    const m = memory([row({ id: 'r1' }), row({ id: 'r2', userId: 'u2' })], { u1: [phone('boom')], u2: [phone('ok')] });
    const t: PushTransport = {
      send: async (d) => {
        if (d.token === 'boom') throw new Error('socket hang up');
        return 'delivered';
      },
    };
    expect(await drainOutbox(m.store, t)).toEqual({ sent: 1, skipped: 0, retried: 1 });
    expect(m.retried.r1).toContain('socket hang up');
    expect(m.closed).toEqual({ r2: 'sent' });
  });

  it('claims at most max rows, 100 by default', async () => {
    let asked = 0;
    const m = memory([], {});
    m.store.claim = async (max) => {
      asked = max;
      return [];
    };
    await drainOutbox(m.store, scripted({}));
    expect(asked).toBe(100);
    await drainOutbox(m.store, scripted({}), { max: 7 });
    expect(asked).toBe(7);
  });
});

describe('planDaily', () => {
  const cand = (p: Partial<Candidate> = {}): Candidate => ({
    userId: 'u1',
    timeZone: 'Europe/Madrid',
    orgId: 'o1',
    orgName: 'Órdago',
    waiting: 3,
    ...p,
  });
  // November: Madrid is UTC+1, New York UTC-5.
  const at = (iso: string) => new Date(iso);

  it('plans nothing before 09:00 local', () => {
    expect(planDaily(at('2026-11-25T07:59:00Z'), [cand()])).toEqual([]);
  });

  it('plans one row at 09:00 local, for Madrid’s date', () => {
    expect(planDaily(at('2026-11-25T08:00:00Z'), [cand()])).toEqual([
      {
        userId: 'u1',
        localDay: '2026-11-25',
        orgId: 'o1',
        title: 'Órdago',
        body: '3 decisiones te esperan',
        data: { kind: 'daily', orgId: 'o1', route: '/decisiones' },
      },
    ]);
  });

  it('uses the person’s own zone: the same instant is 03:00 in New York', () => {
    expect(planDaily(at('2026-11-25T08:00:00Z'), [cand({ timeZone: 'America/New_York' })])).toEqual([]);
    expect(planDaily(at('2026-11-25T14:00:00Z'), [cand({ timeZone: 'America/New_York' })])).toHaveLength(1);
  });

  it('is still due at 11:59 and no longer at 12:00', () => {
    expect(planDaily(at('2026-11-25T10:59:00Z'), [cand()])).toHaveLength(1);
    expect(planDaily(at('2026-11-25T11:00:00Z'), [cand()])).toEqual([]);
  });

  it('takes the date from the local clock, not UTC', () => {
    const [r] = planDaily(at('2026-11-25T20:30:00Z'), [cand({ timeZone: 'Pacific/Auckland' })]);
    expect(r!.localDay).toBe('2026-11-26');
  });

  it('uses the singular for one decision', () => {
    expect(planDaily(at('2026-11-25T08:00:00Z'), [cand({ waiting: 1 })])[0]!.body).toBe('1 decisión te espera');
  });

  it('sums several organisations into one row without an orgId', () => {
    const rows = planDaily(at('2026-11-25T08:00:00Z'), [
      cand({ orgId: 'o1', orgName: 'Órdago', waiting: 2 }),
      cand({ orgId: 'o2', orgName: 'Zoo', waiting: 3 }),
    ]);
    expect(rows).toEqual([
      {
        userId: 'u1',
        localDay: '2026-11-25',
        orgId: null,
        title: 'Ghostaff',
        body: '5 decisiones te esperan en 2 organizaciones',
        data: { kind: 'daily', route: '/decisiones' },
      },
    ]);
  });

  it('plans per person, each by their own clock', () => {
    const rows = planDaily(at('2026-11-25T08:00:00Z'), [cand({ userId: 'u1' }), cand({ userId: 'u2', timeZone: 'America/New_York' })]);
    expect(rows.map((r) => r.userId)).toEqual(['u1']);
  });

  it('falls back to Madrid for an invalid time zone', () => {
    expect(planDaily(at('2026-11-25T08:00:00Z'), [cand({ timeZone: 'Not/AZone' })])).toHaveLength(1);
    expect(planDaily(at('2026-11-25T07:00:00Z'), [cand({ timeZone: 'Not/AZone' })])).toEqual([]);
  });
});
