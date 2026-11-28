// Jobs' database side and their launcher: Supabase with the service role, and
// Cloud Run's API as the engine's own service account, which Órdago's project
// lets start each agent's job (`lanzan` in ghostaff-ai/agents' proyecto.yaml).

import type { AgentRepo, AgentSecrets } from '@ghostaff/shared/record';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoogleAuth } from 'google-auth-library';
import type { ChatAgent } from './chat';
import { type JobStore, type LaunchJob, RunBusy, type RunRecord } from './jobs';
import { MAIN_AGENT_RUN, type RunnerAgent, type RunnerStore } from './runner';

function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

const AGENT = 'id, org_id, name, ghost, department, runner';
const toAgent = (r: Record<string, string>): ChatAgent => ({
  id: r.id!,
  orgId: r.org_id!,
  name: r.name!,
  ghost: r.ghost as ChatAgent['ghost'],
  department: r.department!,
  runner: r.runner as ChatAgent['runner'],
});

const RUN = 'id, org_id, agent_id, origin, state, thread_id, message_id, requested_by, nonce_hash, spec_fetched_at, connection_id, routine_id, transcript_path, brief';
const toRun = (r: Record<string, string | null>): RunRecord => ({
  id: r.id!,
  orgId: r.org_id!,
  agentId: r.agent_id!,
  origin: r.origin as RunRecord['origin'],
  state: r.state as RunRecord['state'],
  threadId: r.thread_id ?? null,
  messageId: r.message_id ?? null,
  requestedBy: r.requested_by ?? null,
  nonceHash: r.nonce_hash ?? null,
  specFetched: !!r.spec_fetched_at,
  connectionId: r.connection_id ?? null,
  routineId: r.routine_id ?? null,
  transcriptPath: r.transcript_path ?? null,
  brief: r.brief ?? null,
});

/** `afterAgentWrite` runs after each post of agent messages, as in `supabaseChatStore`. */
export function supabaseJobStore(admin: SupabaseClient, opts: { afterAgentWrite?: () => void } = {}): JobStore {
  return {
    async job(agentId) {
      const r = check(
        await admin.from('agents').select('runner, job_project, job_region, job_name, job_identity').eq('id', agentId).maybeSingle(),
      );
      return r?.runner === 'ordago_job' ? { project: r.job_project, region: r.job_region, name: r.job_name, identity: r.job_identity } : null;
    },
    async agentByIdentity(email) {
      const r = check(
        await admin.from('agents').select(AGENT).eq('job_identity', email.toLowerCase()).eq('runner', 'ordago_job').maybeSingle(),
      );
      return r ? toAgent(r) : null;
    },
    async startRun(x) {
      const res = await admin
        .from('agent_runs')
        .insert({
          org_id: x.orgId,
          agent_id: x.agentId,
          origin: x.origin,
          requested_by: x.requestedBy,
          thread_id: x.threadId,
          message_id: x.messageId,
          nonce_hash: x.nonceHash ?? null,
          routine_id: x.routineId ?? null,
          deadline_at: x.deadlineAt ?? null,
          brief: x.brief ?? null,
        })
        .select('id')
        .single();
      // One run of an agent on our runner at a time (20261127200000_runner_limits.sql).
      if ((res.error as { code?: string; message?: string } | null)?.code === '23505' && res.error?.message.includes('agent_runs_one_running')) {
        throw new RunBusy();
      }
      return (check(res) as { id: string }).id;
    },
    async run(id) {
      const r = check(await admin.from('agent_runs').select(RUN).eq('id', id).maybeSingle());
      return r ? toRun(r) : null;
    },
    async finishRun(id, p) {
      const rows = check(
        await admin
          .from('agent_runs')
          .update({
            state: p.state,
            summary: p.summary?.slice(0, 20_000) ?? null,
            noteworthy: p.noteworthy,
            decisions_opened: p.decisionsOpened,
            finished_at: new Date().toISOString(),
            ...(p.turns != null ? { turns: p.turns } : {}),
            ...(p.ending ? { ending: p.ending } : {}),
          })
          .eq('id', id)
          .eq('state', 'running')
          .select('id'),
      );
      return (rows ?? []).length > 0;
    },
    async staleRuns(before, now) {
      const rows = check(
        await admin
          .from('agent_runs')
          .select('id, org_id, agent_id, origin, state, thread_id, message_id, brief')
          .eq('state', 'running')
          .or(`deadline_at.lt.${now.toISOString()},and(deadline_at.is.null,started_at.lt.${before.toISOString()})`)
          .limit(100),
      ) ?? [];
      return rows.map((r) => ({
        id: r.id,
        orgId: r.org_id,
        agentId: r.agent_id,
        origin: r.origin,
        state: r.state,
        threadId: r.thread_id,
        messageId: r.message_id,
        brief: r.brief,
      }));
    },
    async postToAgentChat(agent, text) {
      check(await admin.rpc('post_to_agent_chat', { target_agent: agent.id, body: text }));
      opts.afterAgentWrite?.();
    },
    async postInThread(threadId, agent, text) {
      check(await admin.rpc('post_in_thread', { target_thread: threadId, target_agent: agent.id, body: text }));
      opts.afterAgentWrite?.();
    },
  };
}

const RUNNER_AGENT =
  'id, org_id, slug, name, description, task, task_in_record, repos, secrets, model, tools, max_turns, schedule, last_scheduled_at, reads_org_runs, ' +
  'timeout_seconds, size, max_runs_per_day, ci_repo, max_ci_queued, is_main';
/** Who runs on our runner: its own agents, and the organisation's main agent whatever its runner (direccion-main-agent.md). */
const ON_RUNNER = 'runner.eq.ghostaff,is_main.eq.true';
type RunnerAgentRow = {
  id: string;
  org_id: string;
  slug: string | null;
  name: string;
  description: string | null;
  task: string | null;
  task_in_record: boolean;
  repos: AgentRepo[] | null;
  secrets: AgentSecrets | null;
  model: string | null;
  tools: string[] | null;
  max_turns: number | null;
  schedule: string | null;
  last_scheduled_at: string | null;
  reads_org_runs: boolean | null;
  timeout_seconds: number;
  size: RunnerAgent['size'];
  max_runs_per_day: number | null;
  ci_repo: string | null;
  max_ci_queued: number | null;
  is_main: boolean | null;
};
// A main agent that only answered in chat has no runner fields: it runs with MAIN_AGENT_RUN's.
const toRunnerAgent = (r: RunnerAgentRow): RunnerAgent => ({
  id: r.id,
  orgId: r.org_id,
  slug: r.slug ?? r.id,
  name: r.name,
  description: r.description,
  task: r.task ?? (r.is_main ? MAIN_AGENT_RUN.task : ''),
  taskInRecord: r.task_in_record ?? false,
  repos: r.repos ?? [],
  secrets: r.secrets ?? {},
  model: r.model ?? MAIN_AGENT_RUN.model,
  tools: r.tools ?? (r.is_main ? [...MAIN_AGENT_RUN.tools] : []),
  maxTurns: r.max_turns ?? MAIN_AGENT_RUN.maxTurns,
  schedule: r.schedule,
  lastScheduledAt: r.last_scheduled_at,
  // The main agent reads every run of its organisation (direccion-main-agent.md).
  readsOrgRuns: (r.reads_org_runs ?? false) || !!r.is_main,
  isMain: !!r.is_main,
  timeoutSeconds: r.timeout_seconds,
  size: r.size,
  maxRunsPerDay: r.max_runs_per_day,
  ci: r.ci_repo && r.max_ci_queued != null ? { repo: r.ci_repo, maxQueued: r.max_ci_queued } : null,
});

/** Our runner's database side (runner.ts), with the service role. */
export function supabaseRunnerStore(admin: SupabaseClient): RunnerStore {
  return {
    async noteSecrets(orgId, used, missing) {
      const now = new Date().toISOString();
      // Only rows with a stored value: a member's first value, still waiting, is not what the run missed.
      if (used.length) check(await admin.from('org_secrets').update({ last_used_at: now, status: 'ok' }).eq('org_id', orgId).in('name', used).select('id'));
      if (missing.length)
        check(await admin.from('org_secrets').update({ status: 'missing' }).eq('org_id', orgId).in('name', missing).not('stored_at', 'is', null).select('id'));
    },
    async runnerAgent(agentId) {
      const r = check(await admin.from('agents').select(RUNNER_AGENT).eq('id', agentId).or(ON_RUNNER).maybeSingle<RunnerAgentRow>());
      return r ? toRunnerAgent(r) : null;
    },
    async scheduledAgents() {
      const rows = check(
        await admin.from('agents').select(RUNNER_AGENT).or(ON_RUNNER).not('schedule', 'is', null).returns<RunnerAgentRow[]>(),
      );
      return (rows ?? []).map(toRunnerAgent);
    },
    async claimSchedule(agentId, prev, to) {
      // Compare-and-set: only the tick that still sees `prev` moves it.
      const q = admin.from('agents').update({ last_scheduled_at: to.toISOString() }).eq('id', agentId).or(ON_RUNNER);
      const rows = check(await (prev === null ? q.is('last_scheduled_at', null) : q.eq('last_scheduled_at', prev)).select('id'));
      return (rows ?? []).length > 0;
    },
    async claimSpec(runId, nonceHash) {
      const r = check(
        await admin
          .from('agent_runs')
          .update({ spec_fetched_at: new Date().toISOString() })
          .eq('id', runId)
          .eq('nonce_hash', nonceHash)
          .eq('state', 'running')
          .is('spec_fetched_at', null)
          .select(RUN)
          .maybeSingle(),
      );
      return r ? toRun(r) : null;
    },
    async runningSince(agentId) {
      const r = check(
        await admin.from('agent_runs').select('started_at').eq('agent_id', agentId).eq('state', 'running').not('nonce_hash', 'is', null).maybeSingle(),
      ) as { started_at: string } | null;
      return r?.started_at ?? null;
    },
    async scheduledRunsSince(agentId, since) {
      const { count, error } = await admin
        .from('agent_runs')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .eq('origin', 'schedule')
        .not('nonce_hash', 'is', null)
        .gte('started_at', since.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
    async skipFire(x) {
      const at = new Date().toISOString();
      check(
        await admin
          .from('agent_runs')
          .insert({ org_id: x.orgId, agent_id: x.agentId, origin: 'schedule', state: 'skipped', skip_reason: x.reason, started_at: at, finished_at: at }),
      );
    },
    async useConnection(runId, connectionId) {
      check(await admin.from('agent_runs').update({ connection_id: connectionId }).eq('id', runId));
    },
    async routineAsk(routineId) {
      const r = check(
        await admin.from('agent_routines').select('org_id, created_by, title, instruction').eq('id', routineId).maybeSingle(),
      ) as { org_id: string; created_by: string | null; title: string; instruction: string } | null;
      if (!r) return null;
      const m = r.created_by
        ? (check(await admin.from('memberships').select('display_name').eq('org_id', r.org_id).eq('user_id', r.created_by).maybeSingle()) as {
            display_name: string;
          } | null)
        : null;
      return { title: r.title, instruction: r.instruction, from: m?.display_name ?? 'una persona del equipo' };
    },
    async setTranscript(runId, path) {
      check(await admin.from('agent_runs').update({ transcript_path: path }).eq('id', runId));
    },
    async teamRepos(orgId, exceptAgentId) {
      const rows = check(await admin.from('agents').select('repos').eq('org_id', orgId).neq('id', exceptAgentId)) as { repos: AgentRepo[] | null }[] | null;
      return (rows ?? []).flatMap((r) => r.repos ?? []);
    },
    async agentBySlug(orgId, slug) {
      const r = check(await admin.from('agents').select('id, slug').eq('org_id', orgId).eq('slug', slug).maybeSingle()) as { id: string; slug: string } | null;
      return r ? { id: r.id, slug: r.slug } : null;
    },
    async pastRuns(orgId, agentId, limit) {
      const rows = (check(
        await admin
          .from('agent_runs')
          .select('id, origin, state, started_at, finished_at, summary, transcript_path')
          .eq('org_id', orgId)
          .eq('agent_id', agentId)
          .order('started_at', { ascending: false })
          .limit(limit),
      ) ?? []) as {
        id: string;
        origin: RunRecord['origin'];
        state: RunRecord['state'];
        started_at: string;
        finished_at: string | null;
        summary: string | null;
        transcript_path: string | null;
      }[];
      return rows.map((r) => ({
        id: r.id,
        origin: r.origin,
        state: r.state,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        summary: r.summary,
        transcript: !!r.transcript_path,
      }));
    },
  };
}

/** Starts one execution of a Cloud Run job with environment overrides (the same call the Telegram webhook makes). */
export function cloudRunLauncher(auth: GoogleAuth): LaunchJob {
  return async (job, env, opts) => {
    const client = await auth.getClient();
    const res = await client.request({
      url: `https://run.googleapis.com/v2/projects/${job.project}/locations/${job.region}/jobs/${job.name}:run`,
      method: 'POST',
      data: {
        overrides: {
          containerOverrides: [{ env: Object.entries(env).map(([name, value]) => ({ name, value })) }],
          // The execution's own task timeout, in place of the job's (RunJobRequest.Overrides.timeout).
          ...(opts?.timeoutSeconds ? { timeout: `${opts.timeoutSeconds}s` } : {}),
        },
      },
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`Cloud Run ${res.status} starting ${job.name}`);
  };
}
