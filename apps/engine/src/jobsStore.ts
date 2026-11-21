// Jobs' database side and their launcher: Supabase with the service role, and
// Cloud Run's API as the engine's own service account, which Órdago's project
// lets start each agent's job (`lanzan` in ghostaff-ai/agents' proyecto.yaml).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoogleAuth } from 'google-auth-library';
import type { ChatAgent } from './chat';
import type { JobStore, LaunchJob } from './jobs';

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

export const NOTICES_TITLE = 'Avisos';

export function supabaseJobStore(admin: SupabaseClient): JobStore {
  return {
    async job(agentId) {
      const r = check(
        await admin.from('agents').select('runner, job_project, job_region, job_name, job_identity').eq('id', agentId).maybeSingle(),
      );
      return r?.runner === 'ordago_job' ? { project: r.job_project, region: r.job_region, name: r.job_name, identity: r.job_identity } : null;
    },
    async agentByIdentity(email) {
      const r = check(await admin.from('agents').select(AGENT).eq('job_identity', email.toLowerCase()).maybeSingle());
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
          })
          .select('id')
          .single(),
      );
      return (r as { id: string }).id;
    },
    async run(id) {
      const r = check(
        await admin.from('agent_runs').select('id, org_id, agent_id, origin, state, thread_id, message_id').eq('id', id).maybeSingle(),
      );
      return r
        ? { id: r.id, orgId: r.org_id, agentId: r.agent_id, origin: r.origin, state: r.state, threadId: r.thread_id, messageId: r.message_id }
        : null;
    },
    async finishRun(id, p) {
      check(
        await admin
          .from('agent_runs')
          .update({ state: p.state, summary: p.summary?.slice(0, 20_000) ?? null, noteworthy: p.noteworthy, decisions_opened: p.decisionsOpened, finished_at: new Date().toISOString() })
          .eq('id', id),
      );
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
    async noticesThread(agent) {
      const found = check(
        await admin.from('threads').select('id').eq('agent_id', agent.id).eq('title', NOTICES_TITLE).is('created_by', null).limit(1).maybeSingle(),
      );
      const id =
        (found as { id: string } | null)?.id ??
        (check(await admin.from('threads').insert({ org_id: agent.orgId, agent_id: agent.id, title: NOTICES_TITLE, created_by: null }).select('id').single()) as {
          id: string;
        }).id;
      return { id, orgId: agent.orgId, agentId: agent.id, title: NOTICES_TITLE };
    },
    async postAgentMessage(thread, agent, text) {
      check(
        await admin.from('messages').insert({
          thread_id: thread.id,
          org_id: thread.orgId,
          author_kind: 'agent',
          author_agent: agent.id,
          author_name: agent.name,
          parts: [{ type: 'text', text }],
          state: 'done',
          steps: [],
          finished_at: new Date().toISOString(),
        }),
      );
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
