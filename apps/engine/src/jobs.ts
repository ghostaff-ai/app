// Agents that run as jobs (docs/plans/ongoing/ordago-agents-in-ghostaff.md, steps 2 and 3).
//
// While Órdago's agents migrate, most of them still run as Cloud Run jobs in
// Órdago's own project (ghostaff-ai/agents), and Ghostaff is their face: when a
// person writes to one in a thread, the engine starts its job with the
// conversation, the way the Telegram webhook does, and leaves a «working»
// message in the thread. When the job ends it reports to POST /runs/report,
// proving who it is with a Google ID token for its own service account; the
// engine writes the answer into that message. A run its timetable started
// reports the same way: it lands in «Hecho sin ti», and in the agent's «Avisos»
// thread when it has something to tell people. Every report syncs the
// organisation's record, so a decision the agent opened is in the inbox at once.

import { type ChatMessage, messageText } from '@ghostaff/shared';
import type { ChatAgent, ChatDeps, ChatThreadHead } from './chat';
import { Refusal } from './connections';

/** Where an agent's job runs and who it reports as. */
export interface AgentJob {
  project: string;
  region: string;
  name: string;
  identity: string;
}

export interface RunRecord {
  id: string;
  orgId: string;
  agentId: string;
  origin: 'person' | 'schedule';
  state: 'running' | 'done' | 'failed';
  threadId: string | null;
  messageId: string | null;
}

/** The database as jobs need it (service role). */
export interface JobStore {
  job(agentId: string): Promise<AgentJob | null>;
  /** The agent whose job reports as this service account. */
  agentByIdentity(email: string): Promise<ChatAgent | null>;
  startRun(r: Omit<RunRecord, 'id' | 'state'> & { requestedBy: string | null }): Promise<string>;
  run(id: string): Promise<RunRecord | null>;
  finishRun(id: string, patch: { state: 'done' | 'failed'; summary: string | null; noteworthy: boolean; decisionsOpened: number }): Promise<void>;
  /** The agent's «Avisos» thread, created the first time. */
  noticesThread(agent: ChatAgent): Promise<ChatThreadHead>;
  /** Runs still «running» that started before `before`: their job died without reporting. */
  staleRuns(before: Date): Promise<RunRecord[]>;
  /** A finished message from the agent in a thread. */
  postAgentMessage(thread: ChatThreadHead, agent: ChatAgent, text: string): Promise<void>;
}

/** Starts one execution of a job with these environment variables. */
export type LaunchJob = (job: AgentJob, env: Record<string, string>) => Promise<void>;

export interface JobDeps {
  jobs: JobStore;
  launch: LaunchJob;
  /** Reads the organisation's record into the database (recordSync.ts); a no-op without a record. */
  syncOrg(orgId: string): Promise<void>;
}

/** What a job's runner reads as `AGENTE_CANAL`: the answer goes back through the engine, not Telegram. */
export const CHANNEL = 'ghostaff';

const MAX_INDICATION = 12_000;

/**
 * What the job is asked: the thread's recent messages, signed, newest last,
 * within what fits in an environment variable. The runner wraps it in its own
 * prompt («Esta ejecución la ha lanzado <de> para hablar contigo…»).
 */
export function indication(thread: ChatThreadHead, messages: ChatMessage[]): string {
  const lines = messages
    .filter((m) => m.authorKind === 'person' || m.state === 'done')
    .map((m) => `${m.authorName}: ${messageText(m.parts).trim()}`)
    .filter((l) => !l.endsWith(': '));
  const head = `Conversación en Ghostaff, hilo «${thread.title}». Lo último va al final; contesta a eso.`;
  const out: string[] = [];
  let size = head.length;
  for (const l of [...lines].reverse()) {
    if (size + l.length + 2 > MAX_INDICATION) break;
    out.unshift(l);
    size += l.length + 2;
  }
  return [head, '', ...out].join('\n');
}

/**
 * A person wrote to an agent that runs as a job: starts its job with the
 * conversation and leaves the agent's message «working» until it reports.
 * Never throws: a failure to start is written into the message.
 */
export async function askJob(
  chat: ChatDeps,
  deps: JobDeps,
  thread: ChatThreadHead,
  agent: ChatAgent,
  replyId: string,
  messages: ChatMessage[],
  userId: string,
): Promise<void> {
  const asker = [...messages].reverse().find((m) => m.authorKind === 'person' && m.authorUserId === userId)?.authorName ?? 'Una persona';
  try {
    const job = await deps.jobs.job(agent.id);
    if (!job) throw new Error('agent has no job');
    const runId = await deps.jobs.startRun({
      orgId: agent.orgId,
      agentId: agent.id,
      origin: 'person',
      requestedBy: userId,
      threadId: thread.id,
      messageId: replyId,
    });
    await deps.launch(job, {
      AGENTE_INDICACION: indication(thread, messages),
      AGENTE_INDICACION_DE: asker,
      AGENTE_CANAL: CHANNEL,
      GHOSTAFF_RUN: runId,
    });
    await chat.chat.updateReply(replyId, { steps: ['Trabajando en ello: tardo unos minutos'] });
  } catch (e) {
    console.error('job not started', e instanceof Error ? e.message : typeof e);
    await chat.chat
      .updateReply(replyId, { text: 'No he podido ponerme con ello. Vuelve a escribirme en un rato.', state: 'failed' })
      .catch(() => {});
  }
}

export interface RunReport {
  run: string | null;
  ok: boolean;
  text: string | null;
  noteworthy: boolean;
  decisions: { id: string; question: string }[];
}

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

/** The report's body, checked; a Refusal when it is not one. */
export function readReport(body: unknown): RunReport {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b !== 'object' || typeof b.ok !== 'boolean') throw new Refusal(400, 'bad_request', 'ok is required');
  if (b.run != null && !isUuid(b.run)) throw new Refusal(400, 'bad_request', 'run must be a uuid');
  if (b.text != null && (typeof b.text !== 'string' || b.text.length > 20_000)) throw new Refusal(400, 'bad_request', 'text up to 20000 characters');
  const decisions = Array.isArray(b.decisions) ? b.decisions : [];
  if (decisions.length > 50) throw new Refusal(400, 'bad_request', 'up to 50 decisions');
  return {
    run: (b.run as string | undefined) ?? null,
    ok: b.ok,
    text: typeof b.text === 'string' && b.text.trim() ? b.text.trim() : null,
    noteworthy: b.noteworthy === true,
    decisions: decisions.flatMap((d) => {
      const x = d as Record<string, unknown>;
      return typeof x?.id === 'string' && typeof x?.question === 'string' ? [{ id: x.id.slice(0, 200), question: x.question.slice(0, 500) }] : [];
    }),
  };
}

const decisionLines = (ds: RunReport['decisions']) =>
  ds.length ? ['', ds.length === 1 ? 'Te he dejado una decisión en Hoy:' : `Te he dejado ${ds.length} decisiones en Hoy:`, ...ds.map((d) => `• ${d.question}`)] : [];

/**
 * A job's report at the end of a run. `caller` is the service account the
 * Google ID token proved; it has to be the one registered for the run's agent.
 */
export async function reportRun(chat: ChatDeps, deps: JobDeps, caller: string, body: unknown): Promise<{ run: string; threadId: string | null }> {
  const report = readReport(body);
  const agent = await deps.jobs.agentByIdentity(caller);
  if (!agent) throw new Refusal(403, 'not_allowed', 'no agent reports as this account');

  let run: RunRecord;
  if (report.run) {
    const found = await deps.jobs.run(report.run);
    if (!found || found.agentId !== agent.id) throw new Refusal(403, 'not_allowed', 'not this agent’s run');
    if (found.state !== 'running') return { run: found.id, threadId: null }; // a retry of a report already taken
    run = found;
  } else {
    // A run its timetable started: nobody was waiting for it.
    const id = await deps.jobs.startRun({ orgId: agent.orgId, agentId: agent.id, origin: 'schedule', requestedBy: null, threadId: null, messageId: null });
    run = { id, orgId: agent.orgId, agentId: agent.id, origin: 'schedule', state: 'running', threadId: null, messageId: null };
  }

  const said = report.ok ? (report.text ?? 'He acabado sin nada que contar.') : `No he podido acabar.${report.text ? `\n\n${report.text}` : ''}`;
  const text = [said, ...decisionLines(report.decisions)].join('\n');
  const noteworthy = !report.ok || report.noteworthy || report.decisions.length > 0;

  await deps.jobs.finishRun(run.id, {
    state: report.ok ? 'done' : 'failed',
    summary: report.text,
    noteworthy,
    decisionsOpened: report.decisions.length,
  });
  // The decisions it opened, in the inbox now rather than at the next tick.
  await deps.syncOrg(agent.orgId).catch((e) => console.error('sync after report failed', e instanceof Error ? e.message : typeof e));

  if (run.messageId && run.threadId) {
    await chat.chat.updateReply(run.messageId, { text, state: report.ok ? 'done' : 'failed', steps: ['Trabajando en ello', 'Hecho'] });
    await chat.chat.touchThread(run.threadId).catch(() => {});
    return { run: run.id, threadId: run.threadId };
  }
  if (noteworthy) {
    const thread = await deps.jobs.noticesThread(agent);
    await deps.jobs.postAgentMessage(thread, agent, text);
    await chat.chat.touchThread(thread.id).catch(() => {});
  }
  return { run: run.id, threadId: null };
}

/** How long a job may run before the engine stops waiting: the longest job's timeout, with room. */
export const RUN_DEADLINE_MS = 3 * 3600_000;

/**
 * Runs whose job died without reporting (killed, out of memory, a crash in
 * the runner itself) are closed on the tick, so a thread does not wait forever.
 */
export async function expireRuns(chat: ChatDeps, deps: JobDeps, now: Date = new Date()): Promise<number> {
  const stale = await deps.jobs.staleRuns(new Date(now.getTime() - RUN_DEADLINE_MS));
  for (const r of stale) {
    await deps.jobs.finishRun(r.id, { state: 'failed', summary: null, noteworthy: true, decisionsOpened: 0 });
    if (r.messageId) {
      await chat.chat
        .updateReply(r.messageId, { text: 'No he podido acabar: el trabajo se cortó sin terminar. Vuelve a pedírmelo.', state: 'failed' })
        .catch(() => {});
    }
  }
  return stale.length;
}
