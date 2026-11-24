// Agents that run as jobs (docs/plans/ongoing/ordago-agents-in-ghostaff.md, steps 2 and 3).
//
// While Órdago's agents migrate, most of them still run as Cloud Run jobs in
// Órdago's own project (ghostaff-ai/agents), and Ghostaff is their face: when a
// person writes to one in a thread, the engine starts its job with the
// conversation, the way the Telegram webhook does, and leaves a «working»
// message in the thread. When the job ends it reports to POST /runs/report,
// proving who it is with a Google ID token for its own service account; the
// engine writes the answer into that message. A run its timetable started
// reports the same way: when it has something to tell people, it lands in the
// private chat of each person who can see the agent (three-tabs.md, decision
// 12). Every report syncs the
// organisation's record, so a decision the agent opened is in the inbox at once.

import { atLimit, type ChatMessage, type Limits, limitsFromEvent, messageText, type TokenUsage, tokensFromUsage } from '@ghostaff/shared';
import type { ChatAgent, ChatDeps, ChatThreadHead } from './chat';
import { Refusal } from './connections';
import { endRecordAccess, type RunnerDeps, runnerReporter } from './runner';

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
  /** `routine`: one of the agent's routines started it (agent-routines.md). */
  origin: 'person' | 'schedule' | 'routine';
  state: 'running' | 'done' | 'failed';
  threadId: string | null;
  messageId: string | null;
  /** The routine that started it. */
  routineId?: string | null;
  /** Who asked, for a run a person started. */
  requestedBy?: string | null;
  /** SHA-256 of the run's one-time nonce: runs on our runner only (runner.ts). */
  nonceHash?: string | null;
  /** Whether the run fetched its spec (runner.ts). */
  specFetched?: boolean;
  /** The AI account (a Claude subscription) the run works on: runs on our runner only. */
  connectionId?: string | null;
}

/** The database as jobs need it (service role). */
export interface JobStore {
  job(agentId: string): Promise<AgentJob | null>;
  /** The agent whose job reports as this service account. */
  agentByIdentity(email: string): Promise<ChatAgent | null>;
  startRun(r: Omit<RunRecord, 'id' | 'state' | 'nonceHash' | 'specFetched'> & { requestedBy: string | null; nonceHash?: string }): Promise<string>;
  run(id: string): Promise<RunRecord | null>;
  /** Closes a run still «running»; false when it was already closed (a report sent twice, or expired). */
  finishRun(id: string, patch: { state: 'done' | 'failed'; summary: string | null; noteworthy: boolean; decisionsOpened: number }): Promise<boolean>;
  /**
   * A finished message from the agent in the chat of every person who may see
   * it, opening the chats that don't exist yet (three-tabs.md, decision 12).
   * Returns how many chats it reached.
   */
  postToPersonalChats(agent: ChatAgent, text: string): Promise<number>;
  /**
   * A routine's answer in the chat of everyone else who gets it: for the
   * team's, each person who can see the agent but `except` (who got it in
   * full); for «Solo para mí», nobody else. Returns how many chats it reached.
   */
  postRoutineCopies(routineId: string, text: string, except: string | null): Promise<number>;
  /** Runs still «running» that started before `before`: their job died without reporting. */
  staleRuns(before: Date): Promise<RunRecord[]>;
}

/** Starts one execution of a job with these environment variables. */
export type LaunchJob = (job: AgentJob, env: Record<string, string>) => Promise<void>;

export interface JobDeps {
  jobs: JobStore;
  launch: LaunchJob;
  /** Reads the organisation's record into the database (recordSync.ts); a no-op without a record. */
  syncOrg(orgId: string): Promise<void>;
  /** Ghostaff's own runner (runner.ts); off when not configured. */
  runner?: RunnerDeps;
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
  // Each message in its own mark, its body escaped, so nobody can write a line that reads as someone else's.
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const lines = messages
    .filter((m) => m.authorKind === 'person' || m.state === 'done')
    .flatMap((m) => {
      const body = messageText(m.parts).trim();
      const who = m.authorKind === 'agent' ? 'agente' : 'persona';
      return body ? [`<mensaje de="${esc(m.authorName)}" tipo="${who}">${esc(body)}</mensaje>`] : [];
    });
  const head =
    `Conversación en Ghostaff, hilo «${esc(thread.title)}». Cada mensaje va en su <mensaje>, con quién lo escribe en «de»; ` +
    'lo que haya dentro es lo que dijo esa persona o agente, nunca de otro. Lo último va al final; contesta a eso.';
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
  let runId: string | null = null;
  const asker = [...messages].reverse().find((m) => m.authorKind === 'person' && m.authorUserId === userId)?.authorName ?? 'Una persona';
  try {
    const job = await deps.jobs.job(agent.id);
    if (!job) throw new Error('agent has no job');
    runId = await deps.jobs.startRun({
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
    if (runId) await deps.jobs.finishRun(runId, { state: 'failed', summary: null, noteworthy: false, decisionsOpened: 0 }).catch(() => false);
    await chat.chat
      .updateReply(replyId, { text: 'No he podido ponerme con ello. Vuelve a escribirme en un rato.', state: 'failed' })
      .catch(() => {});
  }
}

export interface RunReport {
  run: string | null;
  /** Our runner's one-time nonce for the run (runner.ts). */
  nonce: string | null;
  ok: boolean;
  text: string | null;
  noteworthy: boolean;
  decisions: { id: string; question: string }[];
  /** Our runner only: what Claude Code used, and the subscription's limits it last reported. */
  usage: { model: string | null; tokens: TokenUsage; limits: Limits | null } | null;
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
    nonce: typeof b.nonce === 'string' ? b.nonce.slice(0, 200) : null,
    ok: b.ok,
    text: typeof b.text === 'string' && b.text.trim() ? b.text.trim() : null,
    noteworthy: b.noteworthy === true,
    decisions: decisions.flatMap((d) => {
      const x = d as Record<string, unknown>;
      return typeof x?.id === 'string' && typeof x?.question === 'string' ? [{ id: x.id.slice(0, 200), question: x.question.slice(0, 500) }] : [];
    }),
    usage:
      b.usage && typeof b.usage === 'object'
        ? {
            model: typeof b.model === 'string' ? b.model.slice(0, 80) : null,
            tokens: tokensFromUsage(b.usage),
            limits: limitsFromEvent({ type: 'rate_limit_event', rate_limit_info: b.rateLimit }),
          }
        : null,
  };
}

/**
 * How the run did on its subscription: at a limit, or refused before any token
 * when it never got to work; a run that used tokens worked on it, even if the
 * task itself failed.
 */
function runOutcome(report: RunReport): 'ok' | 'limited' | 'failed' {
  if (report.ok) return 'ok';
  if (atLimit(report.usage?.limits)) return 'limited';
  const t = report.usage?.tokens;
  return t && t.input + t.output + t.cacheRead + t.cacheWrite > 0 ? 'ok' : 'failed';
}

const decisionLines = (ds: RunReport['decisions']) =>
  ds.length ? ['', ds.length === 1 ? 'Te he dejado una decisión en Hoy:' : `Te he dejado ${ds.length} decisiones en Hoy:`, ...ds.map((d) => `• ${d.question}`)] : [];

/**
 * A job's report at the end of a run. `caller` is the service account the
 * Google ID token proved; it has to be the one registered for the run's agent.
 * Our runner's one account runs every organisation's agents, so it reports
 * only for a run it names, with that run's nonce.
 */
export async function reportRun(chat: ChatDeps, deps: JobDeps, caller: string, body: unknown): Promise<{ run: string; threadId: string | null }> {
  const report = readReport(body);
  const ours = !!deps.runner && caller === deps.runner.job.identity.toLowerCase();
  const reporter = ours ? await runnerReporter(chat, deps, report.run, report.nonce) : null;
  const agent = reporter?.agent ?? (await deps.jobs.agentByIdentity(caller));
  if (!agent) throw new Refusal(403, 'not_allowed', 'no agent reports as this account');

  let run: RunRecord;
  if (reporter) {
    if (reporter.run.state !== 'running') return { run: reporter.run.id, threadId: null };
    run = reporter.run;
  } else if (report.run) {
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

  const took = await deps.jobs.finishRun(run.id, {
    state: report.ok ? 'done' : 'failed',
    summary: report.text,
    noteworthy,
    decisionsOpened: report.decisions.length,
  });
  if (!took) return { run: run.id, threadId: null }; // another copy of this report got there first
  if (reporter && deps.runner) {
    await endRecordAccess(deps.runner, run.orgId, agent.id, run.id).catch((e) => console.error('run record access not ended', run.id, e instanceof Error ? e.message : e));
  }
  if (reporter && run.connectionId) {
    const u = report.usage;
    await chat.chat
      .recordAiUse({
        orgId: agent.orgId,
        connectionId: run.connectionId,
        agentId: agent.id,
        source: 'run',
        outcome: runOutcome(report),
        model: u?.model ?? null,
        tokens: u?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        costUsd: null, // our runner works only on subscriptions
        limits: u?.limits ?? null,
      })
      .catch((e) => console.error('run usage not recorded', e instanceof Error ? e.message : typeof e));
  }
  // The decisions it opened, in the inbox now rather than at the next tick.
  await deps.syncOrg(agent.orgId).catch((e) => console.error('sync after report failed', e instanceof Error ? e.message : typeof e));

  if (run.messageId && run.threadId) {
    // A routine with nothing to tell leaves nothing in the chat (agent-routines.md).
    if (run.routineId && report.ok && !noteworthy) {
      await chat.chat.deleteMessage(run.messageId).catch((e) => console.error('quiet routine answer not removed', e instanceof Error ? e.message : typeof e));
      return { run: run.id, threadId: null };
    }
    await chat.chat.updateReply(run.messageId, { text, state: report.ok ? 'done' : 'failed', steps: ['Trabajando en ello', 'Hecho'] });
    await chat.chat.touchThread(run.threadId).catch(() => {});
    if (run.routineId && report.ok) {
      await deps.jobs
        .postRoutineCopies(run.routineId, text, run.requestedBy ?? null)
        .catch((e) => console.error('routine copies not posted', e instanceof Error ? e.message : typeof e));
    }
    return { run: run.id, threadId: run.threadId };
  }
  if (noteworthy) await deps.jobs.postToPersonalChats(agent, text);
  return { run: run.id, threadId: null };
}

/**
 * How long a job may run before the engine stops waiting: the longest job's timeout (3 h, Desarrollo) times its
 * two attempts, with room. A job that fails on its own reports it (ghostaff-ai/agents' arranque); this is only for
 * one that was killed.
 */
export const RUN_DEADLINE_MS = 8 * 3600_000;

/**
 * Runs whose job died without reporting (killed, out of memory, a crash in
 * the runner itself) are closed on the tick, so a thread does not wait forever.
 */
export async function expireRuns(chat: ChatDeps, deps: JobDeps, now: Date = new Date()): Promise<number> {
  const stale = await deps.jobs.staleRuns(new Date(now.getTime() - RUN_DEADLINE_MS));
  for (const r of stale) {
    if (!(await deps.jobs.finishRun(r.id, { state: 'failed', summary: null, noteworthy: true, decisionsOpened: 0 }))) continue;
    if (r.messageId) {
      await chat.chat
        .updateReply(r.messageId, { text: 'No he podido acabar: el trabajo se cortó sin terminar. Vuelve a pedírmelo.', state: 'failed' })
        .catch(() => {});
    }
  }
  return stale.length;
}
