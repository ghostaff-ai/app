// Ghostaff's own agent runner, the engine's side
// (docs/plans/ongoing/ordago-agents-in-ghostaff.md, «Our runner» and step 5).
//
// An agent with runner `ghostaff` runs as one execution of the Cloud Run job
// `agent-runner` in Ghostaff's project (apps/runner): the unmodified Claude
// Code in a container. The engine starts it with only a run id and a one-time
// nonce, and stores just the nonce's hash. The run then proves who it is twice
// over, as the runner's service account (a Google ID token for the engine's
// URL) and with that nonce, and fetches its spec once: its prompt, model,
// tools and turns, the record to clone with a fresh GitHub token, and the
// organisation's Claude subscription from the vault. It reports at the end
// through POST /runs/report, like any job (jobs.ts).
//
// One service account runs every organisation's agents, so the nonce is what
// ties a call to its run: without it, one organisation's run could ask for
// another's spec or report as it.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { type ChatMessage } from '@ghostaff/shared';
import { Cron } from 'croner';
import type { ChatAgent, ChatDeps, ChatThreadHead } from './chat';
import { madridNow } from './chat';
import { Refusal } from './connections';
import type { RepoTokens } from './githubApp';
import { type AgentJob, indication, type JobDeps, type RunRecord } from './jobs';
import { secretName, type Vault } from './vault';

/** What an agent on our runner runs with (its row in `agents`). */
export interface RunnerAgent {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  description: string | null;
  task: string;
  model: string;
  tools: string[];
  maxTurns: number;
  /** Cron, Madrid time; null when it only works when asked. */
  schedule: string | null;
  lastScheduledAt: string | null;
}

/** The database as the runner needs it (service role). */
export interface RunnerStore {
  runnerAgent(agentId: string): Promise<RunnerAgent | null>;
  /** Every agent on our runner with a timetable. */
  scheduledAgents(): Promise<RunnerAgent[]>;
  /**
   * Moves the agent's `last_scheduled_at` from `prev` to `to`; false when it
   * was no longer `prev` (another tick took this fire time first).
   */
  claimSchedule(agentId: string, prev: string | null, to: Date): Promise<boolean>;
  /**
   * Marks the run's spec fetched, only if it is still running, has this nonce
   * hash and was never fetched; the run, or null when any of that fails.
   */
  claimSpec(runId: string, nonceHash: string): Promise<RunRecord | null>;
}

export interface RunnerDeps {
  store: RunnerStore;
  /** The `agent-runner` job, and the service account it runs as (env RUNNER_IDENTITY). */
  job: AgentJob;
  /** The engine's public URL: where the run fetches its spec and reports. */
  engineUrl: string;
  vault: Pick<Vault, 'get'>;
  /** The organisation's record repo, through the record connector; null without one. */
  record(orgId: string): Promise<{ repo: string; installation: number } | null>;
  tokens: RepoTokens;
  /** Who the agent's commits are by: `<agent> (Ghostaff)` and this address. */
  commitEmail: string;
  now?: () => Date;
}

/** What the run is told about its spec (POST /runs/:id/spec). Every secret in it lives only for this run. */
export interface RunSpec {
  run: string;
  slug: string;
  prompt: string;
  model: string;
  tools: string[];
  maxTurns: number;
  record: { repo: string; token: string };
  author: { name: string; email: string };
  claudeToken: string;
  decisionsDir: string;
}

/** The record's folder of open decisions (Órdago's `por-decidir/` format). */
export const DECISIONS_DIR = 'por-decidir';
/** What a scheduled run's last message is when there is nothing to tell. */
export const NOTHING_NEW = 'SIN NOVEDAD';

export const NO_SUBSCRIPTION =
  'No puedo ponerme a trabajar: esta organización no tiene conectada una suscripción de Claude. ' +
  'Quien sea propietario puede conectarla en Conexiones, en «Claude · tu suscripción».';
const NO_RECORD =
  'No puedo ponerme a trabajar: esta organización no tiene conectado su registro. Quien sea propietario puede conectarlo en Conexiones.';
const NOT_STARTED = 'No he podido ponerme con ello. Vuelve a escribirme en un rato.';

export const hashNonce = (nonce: string) => createHash('sha256').update(nonce, 'utf8').digest('hex');

/** Constant-time check of a nonce against its stored hash. */
export function nonceMatches(nonce: unknown, hash: string | null | undefined): boolean {
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce) || !hash || !/^[0-9a-f]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hashNonce(nonce), 'hex'), Buffer.from(hash, 'hex'));
}

class RunnerFailure extends Error {
  constructor(readonly said: string) {
    super('runner run cannot start');
  }
}

/** Why a run cannot work, said to people; null when it can. */
async function preflight(deps: RunnerDeps, orgId: string): Promise<string | null> {
  if (!(await deps.vault.get(secretName(orgId, 'claude')))) return NO_SUBSCRIPTION;
  if (!(await deps.record(orgId))) return NO_RECORD;
  return null;
}

/**
 * Closes a run that could not work, saying why where people will see it: in
 * the message that waits for it, or in the agent's «Avisos» for a scheduled run.
 */
async function failRun(chat: ChatDeps, deps: JobDeps, run: Pick<RunRecord, 'id' | 'messageId' | 'threadId'>, agent: ChatAgent, said: string) {
  const took = await deps.jobs.finishRun(run.id, { state: 'failed', summary: said, noteworthy: true, decisionsOpened: 0 }).catch(() => false);
  if (!took) return;
  if (run.messageId) {
    await chat.chat.updateReply(run.messageId, { text: said, state: 'failed' }).catch(() => {});
    if (run.threadId) await chat.chat.touchThread(run.threadId).catch(() => {});
    return;
  }
  try {
    const thread = await deps.jobs.noticesThread(agent);
    await deps.jobs.postAgentMessage(thread, agent, said);
    await chat.chat.touchThread(thread.id).catch(() => {});
  } catch (e) {
    console.error('notice not posted', e instanceof Error ? e.message : typeof e);
  }
}

/** Starts one run on our runner: a run row with the nonce's hash, then the job with the run id and the nonce. */
async function launch(
  deps: JobDeps & { runner: RunnerDeps },
  agent: ChatAgent,
  r: { origin: 'person' | 'schedule'; requestedBy: string | null; threadId: string | null; messageId: string | null },
): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');
  const runId = await deps.jobs.startRun({ orgId: agent.orgId, agentId: agent.id, ...r, nonceHash: hashNonce(nonce) });
  try {
    await deps.launch(deps.runner.job, { GHOSTAFF_RUN: runId, GHOSTAFF_NONCE: nonce, ENGINE_URL: deps.runner.engineUrl });
  } catch (e) {
    throw Object.assign(e instanceof Error ? e : new Error('launch failed'), { runId });
  }
  return runId;
}

/**
 * A person wrote to an agent on our runner: starts a run, and its message
 * waits «working» until the run reports. Never throws: why it could not start
 * is written into the message.
 */
export async function askRunner(chat: ChatDeps, deps: JobDeps, thread: ChatThreadHead, agent: ChatAgent, replyId: string, userId: string): Promise<void> {
  let runId: string | null = null;
  try {
    const runner = deps.runner;
    if (!runner) throw new Error('our runner is not configured');
    const why = await preflight(runner, agent.orgId);
    if (why) throw new RunnerFailure(why);
    runId = await launch({ ...deps, runner }, agent, { origin: 'person', requestedBy: userId, threadId: thread.id, messageId: replyId });
    await chat.chat.updateReply(replyId, { steps: ['Trabajando en ello: tardo unos minutos'] });
  } catch (e) {
    runId = runId ?? (e as { runId?: string }).runId ?? null;
    const said = e instanceof RunnerFailure ? e.said : NOT_STARTED;
    if (!(e instanceof RunnerFailure)) console.error('runner not started', e instanceof Error ? e.message : typeof e);
    if (runId) await deps.jobs.finishRun(runId, { state: 'failed', summary: said, noteworthy: false, decisionsOpened: 0 }).catch(() => false);
    await chat.chat.updateReply(replyId, { text: said, state: 'failed' }).catch(() => {});
  }
}

/** Whether a timetable had a fire time in (`since`, `now`]. A bad cron never fires. */
export function firedBetween(schedule: string, since: Date, now: Date): boolean {
  try {
    const next = new Cron(schedule, { timezone: 'Europe/Madrid', paused: true }).nextRun(since);
    return next !== null && next.getTime() <= now.getTime();
  } catch {
    return false;
  }
}

/**
 * On the tick: starts every agent on our runner whose timetable fired since it
 * last started it. Several fire times missed (the engine was down) start one
 * run, not a backlog. `last_scheduled_at` moves first and atomically, so two
 * ticks at once never start the same run twice. An agent never started yet
 * only takes now as its starting point.
 */
export async function startScheduled(chat: ChatDeps, deps: JobDeps): Promise<number> {
  const runner = deps.runner;
  if (!runner) return 0;
  const now = runner.now ? runner.now() : new Date();
  let started = 0;
  for (const a of await runner.store.scheduledAgents()) {
    if (!a.schedule) continue;
    if (a.lastScheduledAt === null) {
      await runner.store.claimSchedule(a.id, null, now);
      continue;
    }
    if (!firedBetween(a.schedule, new Date(a.lastScheduledAt), now)) continue;
    if (!(await runner.store.claimSchedule(a.id, a.lastScheduledAt, now))) continue;
    const agent = await chat.chat.agent(a.id);
    if (!agent) continue;
    try {
      const why = await preflight(runner, a.orgId);
      if (why) {
        const runId = await deps.jobs.startRun({ orgId: a.orgId, agentId: a.id, origin: 'schedule', requestedBy: null, threadId: null, messageId: null });
        await failRun(chat, deps, { id: runId, messageId: null, threadId: null }, agent, why);
        continue;
      }
      await launch({ ...deps, runner }, agent, { origin: 'schedule', requestedBy: null, threadId: null, messageId: null });
      started += 1;
    } catch (e) {
      console.error('scheduled run not started', e instanceof Error ? e.message : typeof e);
      const runId = (e as { runId?: string }).runId;
      if (runId) await failRun(chat, deps, { id: runId, messageId: null, threadId: null }, agent, NOT_STARTED);
    }
  }
  return started;
}

/** The run's prompt, in the spirit of ghostaff-ai/agents' componer_prompt. */
export function composePrompt(p: {
  agent: RunnerAgent;
  orgName: string;
  repo: string;
  now: Date;
  /** What a person asked (indication(): every message in its escaped mark), and who. */
  request: { text: string; from: string } | null;
}): string {
  const { agent, orgName } = p;
  const parts = [
    `Eres el agente «${agent.name}» de ${orgName}${agent.description ? `: ${agent.description}` : '.'}`,
    'Corres solo, en un container y sin nadie delante: nadie va a contestar preguntas. Decide, y deja escrito por qué.',
    `El registro de ${orgName}, el repo \`${p.repo}\`, está clonado en tu directorio de trabajo, y es tu directorio de trabajo. ` +
      `Antes de nada lee su AGENTS.md y, si existe, la carpeta agentes/${agent.slug}/.`,
    'Lo que cambies en el registro, guárdalo con commit y push a su rama principal: es el registro, y es el único sitio donde puedes hacer push. ' +
      'Nunca fuerces un push ni te saltes sus hooks.',
    `Si necesitas a una persona (un OK, una decisión), abre una en \`${DECISIONS_DIR}/\` (formato en su README) con \`propone: ${agent.slug}\`, ` +
      'haz commit y push, y sigue con lo que no dependa de ella: le llega sola a Hoy, en Ghostaff.',
    `Ahora es ${madridNow(p.now)}, hora de Madrid.`,
  ];
  if (p.request) {
    parts.push(
      `Esta ejecución la ha lanzado ${p.request.from} para hablar contigo desde Ghostaff. Atiende lo que pide: contesta, corrige o haz ` +
        'lo que pida. Tu tarea habitual (abajo) es tu contexto; no la hagas entera salvo que te lo pida.\n' +
        'Antes de acabar, mira qué de lo hablado debe seguir siendo verdad mañana y escríbelo, con commit y push, donde te toca según el ' +
        'AGENTS.md del registro. Si no sale nada duradero, no escribas nada.\n' +
        'Tu último mensaje es lo que le llega en su hilo de Ghostaff: escríbelo para esa persona, corto y con las cifras que importen.\n' +
        `<indicacion>\n${p.request.text}\n</indicacion>`,
    );
  } else {
    parts.push(
      'Te ha lanzado tu horario. Tu último mensaje llega a las personas en tu hilo «Avisos» de Ghostaff: escríbelo para ellas. ' +
        `Si no hay nada que contarles, tu último mensaje es exactamente \`${NOTHING_NEW}\`, sin nada más, y no les llega nada.`,
    );
  }
  parts.push(`Tu tarea:\n${agent.task}`);
  return parts.join('\n\n');
}

/** The conversation that started a run: the thread's messages before the run's own, and who asked. */
function requestOf(messages: ChatMessage[], thread: ChatThreadHead, run: RunRecord): { text: string; from: string } {
  const at = messages.findIndex((m) => m.id === run.messageId);
  const before = at >= 0 ? messages.slice(0, at) : messages;
  const from = [...before].reverse().find((m) => m.authorKind === 'person' && m.authorUserId === run.requestedBy)?.authorName ?? 'Una persona';
  return { text: indication(thread, before), from };
}

/** The caller is our runner's service account, with its run's nonce. */
function checkRunner(deps: JobDeps, caller: string | null): RunnerDeps {
  const runner = deps.runner;
  if (!runner || !caller || caller !== runner.job.identity.toLowerCase()) throw new Refusal(403, 'not_allowed', 'not our runner');
  return runner;
}

/**
 * POST /runs/:id/spec, once per run, while it is running. A run whose
 * organisation lost its subscription or record meanwhile is closed here, with
 * why, and the runner is told so (409).
 */
export async function runSpec(chat: ChatDeps, deps: JobDeps, caller: string | null, runId: string, body: unknown): Promise<RunSpec> {
  const runner = checkRunner(deps, caller);
  const nonce = (body as { nonce?: unknown } | null)?.nonce;
  if (!/^[0-9a-f-]{36}$/i.test(runId) || typeof nonce !== 'string') throw new Refusal(400, 'bad_request', 'run and nonce are required');
  const found = await deps.jobs.run(runId);
  if (!found || !nonceMatches(nonce, found.nonceHash)) throw new Refusal(403, 'not_allowed', 'not this run');
  const run = await runner.store.claimSpec(runId, found.nonceHash!);
  if (!run) throw new Refusal(409, 'already_taken', 'this run’s spec was already fetched, or the run is over');

  const [agent, chatAgent] = await Promise.all([runner.store.runnerAgent(run.agentId), chat.chat.agent(run.agentId)]);
  if (!agent || !chatAgent || agent.orgId !== run.orgId) throw new Refusal(409, 'gone', 'the agent no longer runs here');
  const [claudeToken, record] = await Promise.all([runner.vault.get(secretName(run.orgId, 'claude')), runner.record(run.orgId)]);
  if (!claudeToken || !record) {
    await failRun(chat, deps, run, chatAgent, claudeToken ? NO_RECORD : NO_SUBSCRIPTION);
    throw new Refusal(409, claudeToken ? 'no_record' : 'no_subscription', 'the organisation cannot run this agent now');
  }

  let request: { text: string; from: string } | null = null;
  if (run.origin === 'person' && run.threadId) {
    const thread = await chat.chat.thread(run.threadId);
    if (thread) request = requestOf(await chat.chat.recentMessages(thread.id, 40), thread, run);
  }
  const token = await runner.tokens(record.installation, record.repo);
  return {
    run: run.id,
    slug: agent.slug,
    prompt: composePrompt({
      agent,
      orgName: await chat.chat.orgName(run.orgId),
      repo: record.repo,
      now: runner.now ? runner.now() : new Date(),
      request,
    }),
    model: agent.model,
    tools: agent.tools,
    maxTurns: agent.maxTurns,
    record: { repo: record.repo, token },
    author: { name: `${agent.name} (Ghostaff)`, email: runner.commitEmail },
    claudeToken,
    decisionsDir: DECISIONS_DIR,
  };
}

/**
 * POST /runs/:id/record-token: a fresh record token for a run that has its
 * spec and still works (a record token lasts an hour; a run up to three).
 */
export async function runRecordToken(deps: JobDeps, caller: string | null, runId: string, body: unknown): Promise<{ token: string }> {
  const runner = checkRunner(deps, caller);
  const nonce = (body as { nonce?: unknown } | null)?.nonce;
  const run = /^[0-9a-f-]{36}$/i.test(runId) ? await deps.jobs.run(runId) : null;
  if (!run || !nonceMatches(nonce, run.nonceHash) || run.state !== 'running' || !run.specFetched) throw new Refusal(403, 'not_allowed', 'not this run');
  const record = await runner.record(run.orgId);
  if (!record) throw new Refusal(409, 'no_record', 'the organisation has no record');
  return { token: await runner.tokens(record.installation, record.repo) };
}

/** For reportRun: the agent of a run our runner reports for, checked by its nonce; a Refusal when it does not match. */
export async function runnerReporter(chat: ChatDeps, deps: JobDeps, runId: string | null, nonce: unknown): Promise<{ agent: ChatAgent; run: RunRecord }> {
  if (!runId) throw new Refusal(400, 'bad_request', 'our runner reports with its run');
  const run = await deps.jobs.run(runId);
  if (!run || !nonceMatches(nonce, run.nonceHash)) throw new Refusal(403, 'not_allowed', 'not this run');
  const agent = await chat.chat.agent(run.agentId);
  if (!agent || agent.orgId !== run.orgId) throw new Refusal(403, 'not_allowed', 'not this run');
  return { agent, run };
}
