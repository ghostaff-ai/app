// Jobs' database side and their launcher: Supabase with the service role, and
// Cloud Run's API as the engine's own service account, which Órdago's project
// lets start each agent's job (`lanzan` in ghostaff-ai/agents' proyecto.yaml).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoogleAuth } from 'google-auth-library';
import type { ChatAgent } from './chat';
import type { JobStore, LaunchJob, RunRecord } from './jobs';
import type { RunnerAgent, RunnerStore } from './runner';

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

const RUN = 'id, org_id, agent_id, origin, state, thread_id, message_id, requested_by, nonce_hash, spec_fetched_at, connection_id, routine_id';
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
      const r = check(
        await admin
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
          })
          .select('id')
          .single(),
      );
      return (r as { id: string }).id;
    },
    async run(id) {
      const r = check(await admin.from('agent_runs').select(RUN).eq('id', id).maybeSingle());
      return r ? toRun(r) : null;
    },
    async finishRun(id, p) {
      const rows = check(
        await admin
          .from('agent_runs')
          .update({ state: p.state, summary: p.summary?.slice(0, 20_000) ?? null, noteworthy: p.noteworthy, decisions_opened: p.decisionsOpened, finished_at: new Date().toISOString() })
          .eq('id', id)
          .eq('state', 'running')
          .select('id'),
      );
      return (rows ?? []).length > 0;
    },
    async staleRuns(before) {
      const rows = check(
        await admin
          .from('agent_runs')
          .select('id, org_id, agent_id, origin, state, thread_id, message_id')
          .eq('state', 'running')
          .lt('started_at', before.toISOString())
          .limit(100),
      ) ?? [];
      return rows.map((r) => ({ id: r.id, orgId: r.org_id, agentId: r.agent_id, origin: r.origin, state: r.state, threadId: r.thread_id, messageId: r.message_id }));
    },
    async postToPersonalChats(agent, text) {
      const reached = check(await admin.rpc('post_to_personal_chats', { target_agent: agent.id, body: text })) as number;
      opts.afterAgentWrite?.();
      return reached;
    },
    async postRoutineCopies(routineId, text, except) {
      const reached = check(await admin.rpc('post_routine_copies', { target_routine: routineId, body: text, except_user: except })) as number;
      opts.afterAgentWrite?.();
      return reached;
    },
  };
}

const RUNNER_AGENT = 'id, org_id, slug, name, description, task, task_in_record, model, tools, max_turns, schedule, last_scheduled_at';
type RunnerAgentRow = {
  id: string;
  org_id: string;
  slug: string | null;
  name: string;
  description: string | null;
  task: string;
  task_in_record: boolean;
  model: string;
  tools: string[];
  max_turns: number;
  schedule: string | null;
  last_scheduled_at: string | null;
};
const toRunnerAgent = (r: RunnerAgentRow): RunnerAgent => ({
  id: r.id,
  orgId: r.org_id,
  slug: r.slug ?? r.id,
  name: r.name,
  description: r.description,
  task: r.task,
  taskInRecord: r.task_in_record ?? false,
  model: r.model,
  tools: r.tools ?? [],
  maxTurns: r.max_turns,
  schedule: r.schedule,
  lastScheduledAt: r.last_scheduled_at,
});

/** Our runner's database side (runner.ts), with the service role. */
export function supabaseRunnerStore(admin: SupabaseClient): RunnerStore {
  return {
    async runnerAgent(agentId) {
      const r = check(await admin.from('agents').select(RUNNER_AGENT).eq('id', agentId).eq('runner', 'ghostaff').maybeSingle<RunnerAgentRow>());
      return r ? toRunnerAgent(r) : null;
    },
    async scheduledAgents() {
      const rows = check(
        await admin.from('agents').select(RUNNER_AGENT).eq('runner', 'ghostaff').not('schedule', 'is', null).returns<RunnerAgentRow[]>(),
      );
      return (rows ?? []).map(toRunnerAgent);
    },
    async claimSchedule(agentId, prev, to) {
      // Compare-and-set: only the tick that still sees `prev` moves it.
      const q = admin.from('agents').update({ last_scheduled_at: to.toISOString() }).eq('id', agentId).eq('runner', 'ghostaff');
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
    async useConnection(runId, connectionId) {
      check(await admin.from('agent_runs').update({ connection_id: connectionId }).eq('id', runId));
    },
    async routineAsk(routineId) {
      const r = check(
        await admin.from('agent_routines').select('org_id, created_by, audience, title, instruction').eq('id', routineId).maybeSingle(),
      ) as { org_id: string; created_by: string | null; audience: 'me' | 'team'; title: string; instruction: string } | null;
      if (!r) return null;
      const m = r.created_by
        ? (check(await admin.from('memberships').select('display_name').eq('org_id', r.org_id).eq('user_id', r.created_by).maybeSingle()) as {
            display_name: string;
          } | null)
        : null;
      return { title: r.title, instruction: r.instruction, audience: r.audience, from: m?.display_name ?? 'una persona del equipo' };
    },
  };
}

/** Starts one execution of a Cloud Run job with environment overrides (the same call the Telegram webhook makes). */
export function cloudRunLauncher(auth: GoogleAuth): LaunchJob {
  return async (job, env) => {
    const client = await auth.getClient();
    const res = await client.request({
      url: `https://run.googleapis.com/v2/projects/${job.project}/locations/${job.region}/jobs/${job.name}:run`,
      method: 'POST',
      data: { overrides: { containerOverrides: [{ env: Object.entries(env).map(([name, value]) => ({ name, value })) }] } },
      validateStatus: () => true,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`Cloud Run ${res.status} starting ${job.name}`);
  };
}
