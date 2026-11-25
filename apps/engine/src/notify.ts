// Push notifications, the engine's side: drain the outbox to the phones, and
// once a day queue the one that says what waits. Only names leave in a payload
// (the agent's, the organisation's), never message or card text.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient } from '@supabase/supabase-js';
import { apnsTransport, parseApnsSecret } from './push/apns';
import { fcmTransport } from './push/fcm';
import { byPlatform, type Device, type Outcome, type Push, type PushTransport } from './push/transport';

export interface OutboxRow {
  id: string;
  userId: string;
  orgId: string | null;
  kind: 'reply' | 'daily';
  title: string;
  body: string;
  data: Record<string, string>;
  collapseId: string | null;
  attempts: number;
}

export interface Candidate {
  userId: string;
  timeZone: string;
  orgId: string;
  orgName: string;
  waiting: number;
}

export interface DailyRow {
  userId: string;
  localDay: string;
  orgId: string | null;
  title: string;
  body: string;
  data: Record<string, string>;
}

export interface OutboxStore {
  claim(max: number): Promise<OutboxRow[]>;
  devicesOf(userId: string): Promise<Device[]>;
  finish(id: string, outcome: 'sent' | 'no_device' | 'gave_up', error?: string): Promise<void>;
  /**
   * attempts + 1, and hold the claim from now: `claim_pushes` takes the row
   * again two minutes later, which is the wait before the retry.
   */
  retryLater(id: string, error: string): Promise<void>;
  forgetToken(token: string): Promise<void>;
  dailyCandidates(): Promise<Candidate[]>;
  /** Insert, skipping a person's day that already has its row. */
  queueDaily(rows: DailyRow[]): Promise<void>;
}

/** Failures a row may take before it is closed as `gave_up`. */
export const MAX_ATTEMPTS = 5;

const DEFAULT_ZONE = 'Europe/Madrid';
const DAILY_FROM_HOUR = 9;
const DAILY_UNTIL_HOUR = 12;
const UNIQUE_VIOLATION = '23505';
const DRAIN_SOON_MS = 500;
/** The longest a request waits for its pushes; what is still sending then goes on, or the reclaim and the tick retry it. */
const REQUEST_WAIT_MS = 3_000;

export interface DrainResult {
  sent: number;
  skipped: number;
  retried: number;
}

/** An error's message: an `Error`'s, or a Supabase error's (a plain object), never the whole object. */
function messageOf(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') return e.message;
  return String(e);
}

// Configuration -----------------------------------------------------------------

/**
 * The transport the environment configures: `APNS_AUTH_KEY` (the secret
 * `{ teamId, keyId, privateKey }`) for iPhones, `FIREBASE_PROJECT` for Android.
 * Neither: `null`, and push is off. Says once which half is off and why.
 */
export function pushFromEnv(env: NodeJS.ProcessEnv): PushTransport | null {
  const apnsSecret = env.APNS_AUTH_KEY?.trim();
  const firebaseProject = env.FIREBASE_PROJECT?.trim();
  if (!apnsSecret && !firebaseProject) {
    console.warn('push off: no APNS_AUTH_KEY and no FIREBASE_PROJECT');
    return null;
  }

  const apns = apnsSecret ? parseApnsSecret(apnsSecret) : null;
  if (!apnsSecret) console.warn('iOS push off: no APNS_AUTH_KEY');
  else if (!apns) console.warn('iOS push off: APNS_AUTH_KEY is not JSON {teamId, keyId, privateKey}');
  if (!firebaseProject) console.warn('Android push off: no FIREBASE_PROJECT');

  if (!apns && !firebaseProject) return null;
  return byPlatform(apns ? apnsTransport(apns) : null, firebaseProject ? fcmTransport(firebaseProject) : null);
}

// Drain -------------------------------------------------------------------------

export async function drainOutbox(store: OutboxStore, transport: PushTransport, opts: { max?: number } = {}): Promise<DrainResult> {
  const rows = await store.claim(opts.max ?? 100);
  const result: DrainResult = { sent: 0, skipped: 0, retried: 0 };

  for (const row of rows) {
    try {
      result[await drainRow(store, transport, row)] += 1;
    } catch (e) {
      // The row stays claimed, so the reclaim two minutes on retries it; counted, so that ends at
      // MAX_ATTEMPTS even when the store keeps failing on it. Its id only: never its text.
      const error = messageOf(e);
      console.error(`push ${row.id} not drained:`, error);
      await store.retryLater(row.id, error).catch((e2) => console.error(`push ${row.id} not counted for a retry:`, messageOf(e2)));
      result.retried += 1;
    }
  }
  return result;
}

async function drainRow(store: OutboxStore, transport: PushTransport, row: OutboxRow): Promise<keyof DrainResult> {
  // Failures counted by the store-failure path above can reach the cap without a verdict here.
  if (row.attempts >= MAX_ATTEMPTS) {
    await store.finish(row.id, 'gave_up', 'too many attempts');
    return 'skipped';
  }
  const devices = await store.devicesOf(row.userId);
  if (devices.length === 0) {
    await store.finish(row.id, 'no_device');
    return 'skipped';
  }

  const push: Push = { title: row.title, body: row.body, data: row.data, collapseId: row.collapseId };
  const outcomes = await Promise.all(
    devices.map(async (device) => {
      try {
        return { device, outcome: await transport.send(device, push), error: '' };
      } catch (e) {
        return { device, outcome: 'retry' as const, error: messageOf(e) };
      }
    }),
  );

  // The row's verdict first: a push that went out must be closed even if pruning a token then fails.
  const verdict = await closeRow(store, row, outcomes);
  for (const o of outcomes) {
    if (o.outcome !== 'dead') continue;
    // Best effort, and never the token in a log: the next push to it is `dead` again and retries this.
    await store.forgetToken(o.device.token).catch((e) => console.error('a dead device not forgotten:', messageOf(e)));
  }
  return verdict;
}

async function closeRow(
  store: OutboxStore,
  row: OutboxRow,
  outcomes: { outcome: Outcome; error: string }[],
): Promise<keyof DrainResult> {
  if (outcomes.some((o) => o.outcome === 'delivered')) {
    await store.finish(row.id, 'sent');
    return 'sent';
  }
  const error = outcomes.find((o) => o.error)?.error || 'no device accepted the push';
  if (row.attempts + 1 >= MAX_ATTEMPTS) {
    await store.finish(row.id, 'gave_up', error);
    return 'skipped';
  }
  await store.retryLater(row.id, error);
  return 'retried';
}

/** The drain after the engine's own writes of agent messages (see `drainSoon`). */
export interface PushDrain {
  /** After a write that queued pushes: a drain 500 ms on, and the request it happened in waits for it (3 s at most). */
  poke(): void;
  /** Fires a pending drain now and waits for every drain running. Never throws: a failure is logged. */
  settle(): Promise<void>;
  /** Handles a request: when it poked, waits for its pushes before answering, 3 s at most. */
  request<T>(handle: () => Promise<T>): Promise<T>;
}

/**
 * For the engine's writes: a drain 500 ms after the first write of a burst, so
 * one drain sends a burst's pushes. The timer is not pushed back by later
 * writes, so a busy engine still drains. A request that wrote waits for its
 * drain before answering, as Cloud Run gives an instance no CPU between
 * requests, but never past `waitMs`: a person is waiting on it, and a drain
 * held up by a provider is finished by the reclaim and the tick. A write outside
 * any request (work a request left running) has only the timer. Nothing here
 * throws: a failure is logged and the tick sends what was missed.
 */
export function drainSoon(
  store: OutboxStore,
  transport: PushTransport,
  { delayMs = DRAIN_SOON_MS, waitMs = REQUEST_WAIT_MS }: { delayMs?: number; waitMs?: number } = {},
): PushDrain {
  const requests = new AsyncLocalStorage<{ answering: boolean; poked: boolean }>();
  const running = new Set<Promise<void>>();
  let pending: ReturnType<typeof setTimeout> | null = null;

  const fire = () => {
    if (pending) clearTimeout(pending);
    pending = null;
    const drain = drainOutbox(store, transport).then(
      () => undefined,
      (e) => console.error('pushes not drained:', messageOf(e)),
    );
    running.add(drain);
    void drain.finally(() => running.delete(drain));
  };

  const settle = async () => {
    if (pending) fire();
    await Promise.all(running);
  };

  return {
    poke() {
      const req = requests.getStore();
      if (req?.answering) req.poked = true;
      if (!pending) pending = setTimeout(fire, delayMs);
    },
    settle,
    async request(handle) {
      const req = { answering: true, poked: false };
      try {
        return await requests.run(req, handle);
      } finally {
        req.answering = false;
        if (req.poked) {
          let cap: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([settle(), new Promise<void>((r) => (cap = setTimeout(r, waitMs)))]);
          clearTimeout(cap);
        }
      }
    },
  };
}

/**
 * The tick's part: queue the daily pushes that are due, then drain. `off`
 * without a transport, the outbox untouched. Never throws: a failure is
 * logged, and a failing daily query does not hold back the drain.
 */
export async function pushTick(store: OutboxStore, transport: PushTransport | null, now: Date = new Date()): Promise<DrainResult | 'off'> {
  if (!transport) return 'off';
  try {
    await store.queueDaily(planDaily(now, await store.dailyCandidates()));
  } catch (e) {
    console.error('daily pushes not queued:', messageOf(e));
  }
  try {
    return await drainOutbox(store, transport);
  } catch (e) {
    console.error('pushes not drained:', messageOf(e));
    return { sent: 0, skipped: 0, retried: 0 };
  }
}

// Daily -------------------------------------------------------------------------

/** The person's local date (`YYYY-MM-DD`) and hour at `now`; an unknown zone reads as Madrid. */
function localClock(now: Date, timeZone: string): { day: string; hour: number } {
  const read = (zone: string) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
  };
  try {
    return read(timeZone);
  } catch {
    return read(DEFAULT_ZONE);
  }
}

/** One row per person whose morning it is (09:00 to 11:59 local), summing what waits across their organisations. */
export function planDaily(now: Date, candidates: Candidate[]): DailyRow[] {
  const byPerson = new Map<string, Candidate[]>();
  for (const c of candidates) byPerson.set(c.userId, [...(byPerson.get(c.userId) ?? []), c]);

  const rows: DailyRow[] = [];
  for (const [userId, orgs] of byPerson) {
    const { day, hour } = localClock(now, orgs[0]!.timeZone);
    if (hour < DAILY_FROM_HOUR || hour >= DAILY_UNTIL_HOUR) continue;

    const waiting = orgs.reduce((sum, o) => sum + o.waiting, 0);
    const route = '/decisiones';
    if (orgs.length === 1) {
      const org = orgs[0]!;
      rows.push({
        userId,
        localDay: day,
        orgId: org.orgId,
        title: org.orgName,
        body: waiting === 1 ? '1 decisión te espera' : `${waiting} decisiones te esperan`,
        data: { kind: 'daily', orgId: org.orgId, route },
      });
    } else {
      rows.push({
        userId,
        localDay: day,
        orgId: null,
        title: 'Ghostaff',
        body: `${waiting} decisiones te esperan en ${orgs.length} organizaciones`,
        data: { kind: 'daily', route },
      });
    }
  }
  return rows;
}

// Supabase ----------------------------------------------------------------------

function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

type Raw = Record<string, unknown>;

const toRow = (r: Raw): OutboxRow => ({
  id: r.id as string,
  userId: r.user_id as string,
  orgId: (r.org_id as string | null) ?? null,
  kind: r.kind as OutboxRow['kind'],
  title: r.title as string,
  body: r.body as string,
  data: (r.data as Record<string, string>) ?? {},
  collapseId: (r.collapse_id as string | null) ?? null,
  attempts: r.attempts as number,
});

export function supabaseOutboxStore(admin: SupabaseClient): OutboxStore {
  return {
    async claim(max) {
      const rows = check(await admin.rpc('claim_pushes', { max_rows: max })) as Raw[] | null;
      return (rows ?? []).map(toRow);
    },
    async devicesOf(userId) {
      const rows = check(
        await admin.from('device_tokens').select('token, platform, apns_environment, bundle_id').eq('user_id', userId),
      ) as Raw[];
      return rows.map((r) => ({
        token: r.token as string,
        platform: r.platform as Device['platform'],
        apnsEnvironment: (r.apns_environment as Device['apnsEnvironment']) ?? null,
        bundleId: r.bundle_id as string,
      }));
    },
    async finish(id, outcome, error) {
      check(
        await admin
          .from('push_outbox')
          .update({ outcome, sent_at: new Date().toISOString(), ...(error === undefined ? {} : { last_error: error }) })
          .eq('id', id),
      );
    },
    async retryLater(id, error) {
      // Nothing in SQL counts attempts. The row is ours (claimed), so read-then-write cannot race a second drain.
      // The claim is renewed, not released: claim_pushes skips the row for two minutes, the wait before a retry.
      const current = check(await admin.from('push_outbox').select('attempts').eq('id', id).single()) as Raw;
      check(
        await admin
          .from('push_outbox')
          .update({ attempts: (current.attempts as number) + 1, claimed_at: new Date().toISOString(), last_error: error })
          .eq('id', id),
      );
    },
    async forgetToken(token) {
      check(await admin.from('device_tokens').delete().eq('token', token));
    },
    async dailyCandidates() {
      const rows = check(await admin.rpc('daily_push_candidates')) as Raw[] | null;
      return (rows ?? []).map((r) => ({
        userId: r.user_id as string,
        timeZone: r.time_zone as string,
        orgId: r.org_id as string,
        orgName: r.org_name as string,
        waiting: r.waiting as number,
      }));
    },
    async queueDaily(rows) {
      // One insert each: the uniqueness is a partial index, which PostgREST's
      // on-conflict cannot target, and a duplicate must not sink the others.
      for (const r of rows) {
        const { error } = await admin.from('push_outbox').insert({
          user_id: r.userId,
          org_id: r.orgId,
          kind: 'daily',
          local_day: r.localDay,
          title: r.title,
          body: r.body,
          data: r.data,
          collapse_id: null,
        });
        if (error && error.code !== UNIQUE_VIOLATION) throw error;
      }
    },
  };
}
