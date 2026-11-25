// Push notifications, the engine's side: drain the outbox to the phones, and
// once a day queue the one that says what waits. Only names leave in a payload
// (the agent's, the organisation's), never message or card text.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Device, Push, PushTransport } from './push/transport';

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
  /** attempts + 1, and release the claim so the next drain takes it. */
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

// Drain -------------------------------------------------------------------------

export async function drainOutbox(
  store: OutboxStore,
  transport: PushTransport,
  opts: { max?: number } = {},
): Promise<{ sent: number; skipped: number; retried: number }> {
  const rows = await store.claim(opts.max ?? 100);
  const result = { sent: 0, skipped: 0, retried: 0 };

  for (const row of rows) {
    const devices = await store.devicesOf(row.userId);
    if (devices.length === 0) {
      await store.finish(row.id, 'no_device');
      result.skipped += 1;
      continue;
    }

    const push: Push = { title: row.title, body: row.body, data: row.data, collapseId: row.collapseId };
    const outcomes = await Promise.all(
      devices.map(async (device) => {
        try {
          return { device, outcome: await transport.send(device, push), error: '' };
        } catch (e) {
          return { device, outcome: 'retry' as const, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );

    for (const o of outcomes) if (o.outcome === 'dead') await store.forgetToken(o.device.token);

    if (outcomes.some((o) => o.outcome === 'delivered')) {
      await store.finish(row.id, 'sent');
      result.sent += 1;
      continue;
    }

    const error = outcomes.find((o) => o.error)?.error || 'no device accepted the push';
    if (row.attempts + 1 >= MAX_ATTEMPTS) {
      await store.finish(row.id, 'gave_up', error);
      result.skipped += 1;
    } else {
      await store.retryLater(row.id, error);
      result.retried += 1;
    }
  }
  return result;
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
      const current = check(await admin.from('push_outbox').select('attempts').eq('id', id).single()) as Raw;
      check(
        await admin
          .from('push_outbox')
          .update({ attempts: (current.attempts as number) + 1, claimed_at: null, last_error: error })
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
