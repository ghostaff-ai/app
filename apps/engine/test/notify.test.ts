import { generateKeyPairSync } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabaseChatStore } from '../src/chatStore';
import { supabaseJobStore } from '../src/jobsStore';
import {
  type Candidate,
  type DailyRow,
  drainOutbox,
  drainSoon,
  MAX_ATTEMPTS,
  type OutboxRow,
  type OutboxStore,
  planDaily,
  pushFromEnv,
  pushTick,
  supabaseOutboxStore,
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

// Wiring ------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const quiet = (level: 'warn' | 'error') => vi.spyOn(console, level).mockImplementation(() => {});
const logged = (spy: ReturnType<typeof quiet>) => spy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');

/**
 * A Supabase client for the stores' writes: every chain answers `{ data, error }`,
 * `single` answers `row`, and each update's values are kept.
 */
function writes(opts: { row?: unknown; rpc?: unknown; error?: unknown } = {}) {
  const updates: Record<string, unknown>[] = [];
  const answer = (data: unknown) => Promise.resolve({ data, error: opts.error ?? null });
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq']) chain[m] = () => chain;
  chain.update = (values: Record<string, unknown>) => {
    updates.push(values);
    return chain;
  };
  chain.single = () => answer(opts.row ?? null);
  chain.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => answer(null).then(ok, ko);
  const client = { from: () => chain, rpc: () => answer(opts.rpc ?? 0) } as unknown as SupabaseClient;
  return { client, updates };
}

describe('drainOutbox, one row at a time', () => {
  it('logs a store failure on one row with its id but not its text, counts it retried, and drains the next', async () => {
    const error = quiet('error');
    const m = memory([row({ id: 'r1', title: 'Ana', body: 'Secreto' }), row({ id: 'r2' })], { u1: [phone('a')] });
    m.store.finish = async (id, outcome) => {
      if (id === 'r1') throw { message: 'connection reset', details: 'Secreto' };
      m.closed[id] = outcome;
    };
    expect(await drainOutbox(m.store, scripted({ a: 'delivered' }))).toEqual({ sent: 1, skipped: 0, retried: 1 });
    expect(m.closed).toEqual({ r2: 'sent' });
    expect(logged(error)).toContain('r1');
    expect(logged(error)).toContain('connection reset');
    expect(logged(error)).not.toContain('Secreto');
  });
});

describe('supabaseOutboxStore.retryLater', () => {
  it('counts the attempt and keeps the row claimed from now, so claim_pushes waits its two minutes before a retry', async () => {
    const db = writes({ row: { attempts: 2 } });
    const before = Date.now();
    await supabaseOutboxStore(db.client).retryLater('r1', 'APNs 503');
    expect(db.updates).toHaveLength(1);
    const [u] = db.updates;
    expect(u).toMatchObject({ attempts: 3, last_error: 'APNs 503' });
    expect(typeof u!.claimed_at).toBe('string');
    expect(Date.parse(u!.claimed_at as string)).toBeGreaterThanOrEqual(before);
  });
});

describe('pushFromEnv', () => {
  const p8 = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const apnsKey = JSON.stringify({ teamId: '8HWS4483VD', keyId: 'ABC123DEFG', privateKey: p8 });
  const iphone: Device = { token: 'i', platform: 'ios', apnsEnvironment: 'production', bundleId: 'ai.ghostaff.app' };
  const push: Push = { title: 'Ana', body: 'Te ha contestado', data: {}, collapseId: null };

  it('is off with neither variable, and says so', () => {
    const warn = quiet('warn');
    expect(pushFromEnv({})).toBeNull();
    expect(logged(warn)).toBe('push off: no APNS_AUTH_KEY and no FIREBASE_PROJECT');
  });

  it('keeps Android on when APNS_AUTH_KEY is malformed, and says iOS is off', async () => {
    const warn = quiet('warn');
    const transport = pushFromEnv({ APNS_AUTH_KEY: '{not json', FIREBASE_PROJECT: 'ghostaff-beta' });
    expect(transport).not.toBeNull();
    // No APNs transport: an iPhone's push waits for the config instead of going out.
    expect(await transport!.send(iphone, push)).toBe('retry');
    expect(logged(warn)).toContain('APNS_AUTH_KEY');
    expect(logged(warn)).not.toContain('PRIVATE KEY');
  });

  it('is off with only a malformed APNS_AUTH_KEY', () => {
    quiet('warn');
    expect(pushFromEnv({ APNS_AUTH_KEY: JSON.stringify({ teamId: 'x' }) })).toBeNull();
  });

  it('sends to iPhones only, with a valid APNS_AUTH_KEY and no FIREBASE_PROJECT', async () => {
    const warn = quiet('warn');
    const transport = pushFromEnv({ APNS_AUTH_KEY: apnsKey });
    expect(transport).not.toBeNull();
    expect(await transport!.send(phone('a'), push)).toBe('retry');
    expect(logged(warn)).toContain('FIREBASE_PROJECT');
    expect(logged(warn)).not.toContain('PRIVATE KEY');
  });
});

describe('pushTick', () => {
  const due: Candidate = { userId: 'u1', timeZone: 'Europe/Madrid', orgId: 'o1', orgName: 'Órdago', waiting: 2 };
  const nineInMadrid = new Date('2026-11-25T08:00:00Z');

  it('is off without a transport, and leaves the outbox alone', async () => {
    const m = memory([row()], { u1: [phone('a')] });
    const claim = vi.spyOn(m.store, 'claim');
    const candidates = vi.spyOn(m.store, 'dailyCandidates');
    expect(await pushTick(m.store, null, nineInMadrid)).toBe('off');
    expect(claim).not.toHaveBeenCalled();
    expect(candidates).not.toHaveBeenCalled();
  });

  it('queues the daily ones that are due, then drains', async () => {
    const m = memory([row()], { u1: [phone('a')] });
    const order: string[] = [];
    m.store.dailyCandidates = async () => [due];
    const queue = m.store.queueDaily;
    m.store.queueDaily = async (rows) => {
      order.push('queue');
      await queue(rows);
    };
    const claim = m.store.claim;
    m.store.claim = async (max) => {
      order.push('claim');
      return claim(max);
    };
    expect(await pushTick(m.store, scripted({ a: 'delivered' }), nineInMadrid)).toEqual({ sent: 1, skipped: 0, retried: 0 });
    expect(order).toEqual(['queue', 'claim']);
    expect(m.queued.map((r) => [r.userId, r.localDay])).toEqual([['u1', '2026-11-25']]);
  });

  it('logs a failing daily query and still drains', async () => {
    const error = quiet('error');
    const m = memory([row()], { u1: [phone('a')] });
    m.store.dailyCandidates = async () => {
      throw new Error('statement timeout');
    };
    expect(await pushTick(m.store, scripted({ a: 'delivered' }), nineInMadrid)).toEqual({ sent: 1, skipped: 0, retried: 0 });
    expect(logged(error)).toContain('statement timeout');
  });

  it('logs a failing drain and still returns', async () => {
    const error = quiet('error');
    const m = memory([], {});
    m.store.claim = async () => {
      throw new Error('connection refused');
    };
    expect(await pushTick(m.store, scripted({}), nineInMadrid)).toEqual({ sent: 0, skipped: 0, retried: 0 });
    expect(logged(error)).toContain('connection refused');
  });
});

describe('drainSoon', () => {
  it('drains once, 500 ms after the first of a burst of writes', async () => {
    vi.useFakeTimers();
    const m = memory([], {});
    const claim = vi.spyOn(m.store, 'claim');
    const soon = drainSoon(m.store, scripted({}));
    soon();
    await vi.advanceTimersByTimeAsync(300);
    soon();
    soon();
    await vi.advanceTimersByTimeAsync(199);
    expect(claim).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(claim).toHaveBeenCalledTimes(1);
    soon();
    await vi.advanceTimersByTimeAsync(500);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it('never throws into the caller: a failing drain is logged', async () => {
    vi.useFakeTimers();
    const error = quiet('error');
    const m = memory([], {});
    m.store.claim = async () => {
      throw new Error('connection refused');
    };
    const soon = drainSoon(m.store, scripted({}));
    expect(() => soon()).not.toThrow();
    await vi.advanceTimersByTimeAsync(500);
    expect(logged(error)).toContain('connection refused');
  });
});

describe('the stores call afterAgentWrite', () => {
  it('after a reply reaches a final state, and not while it is being written', async () => {
    const after = vi.fn();
    const store = supabaseChatStore(writes().client, { afterAgentWrite: after });
    await store.updateReply('m1', { text: 'Hola', state: 'working' });
    await store.updateReply('m1', { steps: ['Leyendo'] });
    expect(after).not.toHaveBeenCalled();
    await store.updateReply('m1', { text: 'Hola', state: 'done' });
    await store.updateReply('m2', { text: 'No he podido', state: 'failed' });
    expect(after).toHaveBeenCalledTimes(2);
  });

  it('not when the write failed', async () => {
    const after = vi.fn();
    const store = supabaseChatStore(writes({ error: { message: 'boom' } }).client, { afterAgentWrite: after });
    await expect(store.updateReply('m1', { text: 'Hola', state: 'done' })).rejects.toBeTruthy();
    expect(after).not.toHaveBeenCalled();
  });

  it('after an agent posts to everyone’s personal chat, and a routine’s copies', async () => {
    const after = vi.fn();
    const jobs = supabaseJobStore(writes({ rpc: 2 }).client, { afterAgentWrite: after });
    const agent = { id: 'a1', orgId: 'o1', name: 'Ana', ghost: null, department: 'ventas', runner: 'ghostaff' } as never;
    expect(await jobs.postToPersonalChats(agent, 'Te he dejado 2 decisiones')).toBe(2);
    expect(await jobs.postRoutineCopies('rt1', 'Resumen', null)).toBe(2);
    expect(after).toHaveBeenCalledTimes(2);
  });

  it('is optional', async () => {
    await expect(supabaseChatStore(writes().client).updateReply('m1', { state: 'done' })).resolves.toBeUndefined();
  });
});
