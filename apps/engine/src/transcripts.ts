// Each run's transcript on our runner, and an agent reading earlier runs
// (docs/plans/ongoing/ordago-agents-in-ghostaff.md, «What Ghostaff builds for
// it», item 4).
//
// At the end of a run, before it reports, the runner sends Claude Code's
// stream-json, redacted of every secret the run held and gzipped, to
// POST /runs/:id/transcript; the engine keeps it in the private bucket
// `run-transcripts` at <org>/<agent>/<run>.jsonl.gz, 90 days.
//
// While it works, a run lists and reads earlier runs through the engine, never
// the bucket: the runner (root) asks with the run's nonce on the agent's behalf,
// so the agent never holds a credential. The engine answers only with runs of
// the reader's own organisation (invariant 1), and of its own agent unless the
// agent's row says it reads its organisation's runs (`reads_org_runs`:
// Órdago's Dirección, for its weekly review).

import type { SupabaseClient } from '@supabase/supabase-js';
import { Refusal } from './connections';
import type { JobDeps, RunRecord } from './jobs';
import { nonceMatches, type RunnerAgent, type RunnerDeps } from './runner';

export const TRANSCRIPT_BUCKET = 'run-transcripts';
/** How long a transcript is kept, as the old system's bucket did. */
export const TRANSCRIPT_DAYS = 90;
/** The largest gzipped transcript taken: the bucket's own limit. The runner stops writing at 20 MB before gzip. */
export const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024;
/** The most runs one listing returns. */
export const MAX_PAST_RUNS = 50;
const SUMMARY_CHARS = 1000;

/** The bucket, with the service role. */
export interface TranscriptStore {
  /** Stores a transcript; fails when one is already there (a run sends its own once). */
  put(path: string, gz: Uint8Array): Promise<void>;
  /** A stored transcript, or null when there is none (never stored, or past its 90 days). */
  get(path: string): Promise<Uint8Array | null>;
  /** Transcripts stored before `before`, oldest first, at most a batch. */
  expired(before: Date): Promise<string[]>;
  remove(paths: string[]): Promise<void>;
}

/** An earlier run as a reader is told it. */
export interface PastRun {
  id: string;
  agent: string;
  origin: RunRecord['origin'];
  state: RunRecord['state'];
  startedAt: string;
  finishedAt: string | null;
  /** What it said at the end, as people got it. */
  summary: string | null;
  /** Whether its transcript can be read. */
  transcript: boolean;
}

export const transcriptPath = (run: Pick<RunRecord, 'id' | 'orgId' | 'agentId'>) => `${run.orgId}/${run.agentId}/${run.id}.jsonl.gz`;

const isRunId = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

/** The caller is our runner's account, for a run that has its spec and still works, with its nonce. */
async function workingRun(deps: JobDeps, caller: string | null, runId: string, nonce: unknown): Promise<{ runner: RunnerDeps; run: RunRecord }> {
  const runner = deps.runner;
  if (!runner || !caller || caller !== runner.job.identity.toLowerCase()) throw new Refusal(403, 'not_allowed', 'not our runner');
  const run = isRunId(runId) ? await deps.jobs.run(runId) : null;
  if (!run || !nonceMatches(nonce, run.nonceHash) || run.state !== 'running' || !run.specFetched) throw new Refusal(403, 'not_allowed', 'not this run');
  return { runner, run };
}

function bucket(runner: RunnerDeps): TranscriptStore {
  if (!runner.transcripts) throw new Refusal(409, 'no_transcripts', 'this environment keeps no transcripts');
  return runner.transcripts;
}

/** POST /runs/:id/transcript: the run's own transcript, gzipped, once, before it reports. */
export async function runTranscript(deps: JobDeps, caller: string | null, runId: string, nonce: unknown, gz: Uint8Array): Promise<{ path: string }> {
  const { runner, run } = await workingRun(deps, caller, runId, nonce);
  const store = bucket(runner);
  if (gz.byteLength < 18 || gz[0] !== 0x1f || gz[1] !== 0x8b) throw new Refusal(400, 'bad_request', 'a transcript is gzip');
  if (gz.byteLength > MAX_TRANSCRIPT_BYTES) throw new Refusal(413, 'too_big', 'the transcript is too big');
  const path = transcriptPath(run);
  try {
    await store.put(path, gz);
  } catch (e) {
    console.error('transcript not stored', run.id, e instanceof Error ? e.message : typeof e);
    throw new Refusal(409, 'not_stored', 'the transcript was not stored (sent already?)');
  }
  await runner.store.setTranscript(run.id, path);
  return { path };
}

/** The reading run's agent, on our runner and of the run's organisation. */
async function reader(runner: RunnerDeps, run: RunRecord): Promise<RunnerAgent> {
  const agent = await runner.store.runnerAgent(run.agentId);
  if (!agent || agent.orgId !== run.orgId) throw new Refusal(403, 'not_allowed', 'the agent no longer runs here');
  return agent;
}

/**
 * Whether `agent` may read a run of `target`: never another organisation's (invariant 1); its own agent's,
 * always; another agent's of its organisation, only when its row says so.
 */
export function mayRead(agent: Pick<RunnerAgent, 'id' | 'orgId' | 'readsOrgRuns'>, target: Pick<RunRecord, 'orgId' | 'agentId'>): boolean {
  if (target.orgId !== agent.orgId) return false;
  return target.agentId === agent.id || agent.readsOrgRuns;
}

const NOT_YOURS = 'solo puedes leer tus propias ejecuciones: leer las de otros agentes lo decide quien sea propietario';

/**
 * POST /runs/:id/past-runs: an agent's recent runs, newest first. `agent` is a slug of the reader's
 * organisation (its own when left out); `limit` up to 50.
 */
export async function pastRuns(deps: JobDeps, caller: string | null, runId: string, body: unknown): Promise<{ agent: string; runs: PastRun[] }> {
  const b = (body ?? {}) as { nonce?: unknown; agent?: unknown; limit?: unknown };
  const { runner, run } = await workingRun(deps, caller, runId, b.nonce);
  const me = await reader(runner, run);
  if (b.agent !== undefined && (typeof b.agent !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(b.agent))) {
    throw new Refusal(400, 'bad_request', 'agent is an agent’s slug');
  }
  const limit = b.limit === undefined ? 10 : Number(b.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAST_RUNS) throw new Refusal(400, 'bad_request', `limit is 1 to ${MAX_PAST_RUNS}`);
  // Looked up within the reader's organisation only: another organisation's slug is no agent at all.
  const target = b.agent === undefined || b.agent === me.slug ? { id: me.id, slug: me.slug } : await runner.store.agentBySlug(run.orgId, b.agent);
  if (!target) throw new Refusal(404, 'no_agent', `no agent «${b.agent as string}» here`);
  if (!mayRead(me, { orgId: run.orgId, agentId: target.id })) throw new Refusal(403, 'not_allowed', NOT_YOURS);
  const since = new Date((runner.now ? runner.now() : new Date()).getTime() - TRANSCRIPT_DAYS * 86_400_000);
  const runs = await runner.store.pastRuns(run.orgId, target.id, limit);
  return {
    agent: target.slug,
    runs: runs.map((r) => ({
      ...r,
      agent: target.slug,
      summary: r.summary ? r.summary.slice(0, SUMMARY_CHARS) : null,
      transcript: r.transcript && Date.parse(r.startedAt) > since.getTime(),
    })),
  };
}

/** POST /runs/:id/past-runs/:other: that run's transcript, gzipped as stored. */
export async function pastTranscript(deps: JobDeps, caller: string | null, runId: string, other: string, body: unknown): Promise<Uint8Array> {
  const { runner, run } = await workingRun(deps, caller, runId, (body as { nonce?: unknown } | null)?.nonce);
  const me = await reader(runner, run);
  const target = isRunId(other) ? await deps.jobs.run(other) : null;
  // Another organisation's run reads as no run: its existence is not told either.
  if (!target || target.orgId !== run.orgId) throw new Refusal(404, 'no_run', 'no such run here');
  if (!mayRead(me, target)) throw new Refusal(403, 'not_allowed', NOT_YOURS);
  const gz = target.transcriptPath ? await bucket(runner).get(transcriptPath(target)) : null;
  if (!gz) throw new Refusal(404, 'no_transcript', `that run has no transcript (none was kept, or it is older than ${TRANSCRIPT_DAYS} days)`);
  return gz;
}

/** On the tick: deletes the transcripts past their 90 days, a batch at a time. Never throws. */
export async function sweepTranscripts(runner: RunnerDeps | undefined, now: Date = new Date()): Promise<number> {
  if (!runner?.transcripts) return 0;
  try {
    const old = await runner.transcripts.expired(new Date(now.getTime() - TRANSCRIPT_DAYS * 86_400_000));
    if (old.length) await runner.transcripts.remove(old);
    return old.length;
  } catch (e) {
    console.error('transcripts not swept', e instanceof Error ? e.message : typeof e);
    return 0;
  }
}

export function supabaseTranscriptStore(admin: SupabaseClient): TranscriptStore {
  const files = () => admin.storage.from(TRANSCRIPT_BUCKET);
  return {
    async put(path, gz) {
      const { error } = await files().upload(path, gz, { contentType: 'application/gzip', upsert: false });
      if (error) throw error;
    },
    async get(path) {
      const { data, error } = await files().download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async expired(before) {
      const { data, error } = await admin.rpc('expired_run_transcripts', { before: before.toISOString() });
      if (error) throw error;
      return (data ?? []) as string[];
    },
    async remove(paths) {
      const { error } = await files().remove(paths);
      if (error) throw error;
    },
  };
}
