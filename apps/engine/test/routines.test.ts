import type { SupabaseClient } from '@supabase/supabase-js';
import type { Routine } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import type { ChatAgent, ChatDeps, ChatStore, ChatThreadHead, ModelTurn } from '../src/chat';
import type { AgentJob, JobDeps, JobStore, RunRecord } from '../src/jobs';
import { isNothingNew, type RoutineStore, startRoutines } from '../src/routines';
import { composePrompt, type RunnerAgent, type RunnerStore } from '../src/runner';
import { NO_TOOLS } from '../src/tools';
import { aiSecretName, MemoryVault } from '../src/vault';

const ORG = '10000000-0000-0000-0000-000000000001';
const FINANZAS = '20000000-0000-0000-0000-000000000002';
const LEGAL = '20000000-0000-0000-0000-000000000003';
const BEA = '00000000-0000-0000-0000-00000000000b';
const finanzas: ChatAgent = { id: FINANZAS, orgId: ORG, name: 'Finanzas', ghost: 'finanzas', department: 'finanzas', runner: 'chat' };
const legal: ChatAgent = { id: LEGAL, orgId: ORG, name: 'Legal', ghost: 'base', department: 'legal', runner: 'ghostaff' };
const legalOnRunner: RunnerAgent = {
  id: LEGAL,
  orgId: ORG,
  slug: 'legal',
  name: 'Legal',
  description: null,
  task: 'Revisa la ley.',
  taskInRecord: false,
  repos: [],
  secrets: {},
  model: 'm',
  tools: [],
  maxTurns: 10,
  schedule: null,
  lastScheduledAt: null,
  readsOrgRuns: false,
  timeoutSeconds: 3600,
  size: 'standard',
  maxRunsPerDay: null,
  ci: null,
};

// Tuesday 24 November 2026 10:00 in Madrid; a Friday-at-9 routine last fired a week ago.
const lastWeek = '2026-11-20T08:00:00.000Z';
const friday9 = new Date('2026-11-27T08:00:00Z');

const routine = (over: Partial<Routine> = {}): Routine => ({
  id: '50000000-0000-0000-0000-000000000001',
  orgId: ORG,
  agentId: FINANZAS,
  createdBy: BEA,
  title: 'Ventas',
  instruction: 'Mándame el resumen de ventas de la semana',
  kind: 'days',
  weekdays: [5],
  monthDay: null,
  hour: 9,
  minute: 0,
  timezone: 'Europe/Madrid',
  paused: false,
  pausedReason: null,
  lastFiredAt: lastWeek,
  createdAt: lastWeek,
  ...over,
});

function setup(opts: { routines?: Routine[]; says?: string; creator?: { name: string } | null; busy?: boolean; orgReader?: SupabaseClient } = {}) {
  const routines = new Map((opts.routines ?? [routine()]).map((r) => [r.id, { ...r }]));
  const replies: Array<{ id: string; routineId?: string; thread: string }> = [];
  const updates: Array<{ id: string; text?: string; state?: string }> = [];
  const deleted: string[] = [];
  const notices: string[] = [];
  const paused: string[] = [];
  const asked: Array<{ system: string; messages: ModelTurn[]; tools: string[] }> = [];
  const runs = new Map<string, RunRecord & { summary?: string | null; noteworthy?: boolean }>();
  const launched: Array<Record<string, string>> = [];

  const chat: ChatStore = {
    levelFor: async () => 'talk',
    threadLevelFor: async () => 'talk',
    thread: async () => null,
    agent: async (id) => (id === FINANZAS ? finanzas : id === LEGAL ? legal : null),
    orgAgents: async () => [finanzas, legal],
    orgName: async () => 'Panadería',
    memberNames: async () => ['Bea', 'Ana'],
    recentMessages: async () => [],
    conversation: async () => ({ summary: null, messages: [] }),
    saveSummary: async () => true,
    searchMessages: async () => [],
    startReply: async (thread: ChatThreadHead, _a, _s, o) => {
      if (opts.busy) return null;
      const id = `reply-${replies.length + 1}`;
      replies.push({ id, routineId: o?.routineId, thread: thread.id });
      return id;
    },
    updateReply: async (id, patch) => {
      updates.push({ id, ...patch });
    },
    deleteMessage: async (id) => {
      deleted.push(id);
    },
    touchThread: async () => {},
    agentChat: async (agentId) => `chat-${agentId}`,
    // A Claude subscription: our runner needs one, and the chat turns use it too.
    aiAccounts: async () => [{ id: 'sub-1', provider: 'claude' }],
    recordAiUse: async () => {},
    proposeAction: async () => 'a',
  };
  const chatDeps: ChatDeps = {
    chat,
    writerFor: async () => async (req) => {
      asked.push({ system: req.system, messages: req.messages, tools: req.tools.specs.map((t) => t.name) });
      req.onText(opts.says ?? 'Esta semana: 1.200 € en ventas.');
    },
    toolsFor: async () => NO_TOOLS,
    asPerson: () => {
      throw new Error('a routine reads as nobody');
    },
    orgReader: opts.orgReader,
  };
  const jobs: JobStore = {
    job: async () => null,
    agentByIdentity: async () => null,
    startRun: async (r) => {
      const id = `run-${runs.size + 1}`;
      runs.set(id, { id, state: 'running', ...r });
      return id;
    },
    run: async (id) => runs.get(id) ?? null,
    finishRun: async (id, p) => {
      const r = runs.get(id)!;
      if (r.state !== 'running') return false;
      Object.assign(r, p);
      return true;
    },
    staleRuns: async () => [],
    postToAgentChat: async () => {},
  };
  const vault = new MemoryVault();
  void vault.put(aiSecretName(ORG, 'sub-1'), 'sk-ant-oat-1', {});
  const runnerJob: AgentJob = { project: 'p', region: 'europe-west1', name: 'agent-runner', identity: 'runner@p.iam.gserviceaccount.com' };
  const jobDeps: JobDeps = {
    jobs,
    launch: async (_job, env) => {
      launched.push(env);
    },
    syncOrg: async () => {},
    runner: {
      store: { runnerAgent: async (id: string) => (id === LEGAL ? legalOnRunner : null) } as RunnerStore,
      job: runnerJob,
      largeJobName: 'agent-runner-large',
      engineUrl: 'https://engine',
      vault,
      record: async () => ({ id: ORG, slug: 'panaderia', repo: 'panaderia/registro', host: 'github', installation: 1 }),
      recordStore: null,
      freshToken: async () => ({ token: 't', expiresAt: '' }),
      commitEmail: 'bot@example.com',
    },
  };
  chatDeps.jobs = jobDeps;

  const store: RoutineStore = {
    liveRoutines: async () => [...routines.values()].filter((r) => !r.paused).map((r) => ({ ...r })),
    claim: async (id, prev, to) => {
      const r = routines.get(id)!;
      if (new Date(r.lastFiredAt).getTime() !== new Date(prev).getTime()) return false;
      r.lastFiredAt = to.toISOString();
      return true;
    },
    pause: async (id) => {
      paused.push(id);
      routines.get(id)!.paused = true;
    },
    creator: async () => (opts.creator === undefined ? { name: 'Bea' } : opts.creator),
    notifyOwners: async (_o, text) => {
      notices.push(text);
      return 1;
    },
  };
  return { chatDeps, jobDeps, store, routines, replies, updates, deleted, notices, paused, asked, runs, launched };
}

describe('a routine on the tick (agent-routines.md)', () => {
  it('may still propose who the organisation works with, read with the engine\'s client (external-parties.md)', async () => {
    const t = setup({ orgReader: {} as SupabaseClient });
    expect(await startRoutines(t.chatDeps, t.jobDeps, t.store, friday9)).toBe(1);
    expect(t.asked[0]!.tools.filter((n) => n.startsWith('settings_')).sort()).toEqual([
      'settings_read_external_parties',
      'settings_remove_external_party',
      'settings_save_external_party',
    ]);
  });

  it('waits for its hour', async () => {
    const t = setup();
    expect(await startRoutines(t.chatDeps, t.jobDeps, t.store, new Date('2026-11-24T09:00:00Z'))).toBe(0);
    expect(t.replies).toEqual([]);
  });

  it('answers in the agent’s chat as if its creator wrote the instruction then, with no settings', async () => {
    const t = setup();
    expect(await startRoutines(t.chatDeps, t.jobDeps, t.store, friday9)).toBe(1);
    expect(t.replies).toEqual([{ id: 'reply-1', routineId: '50000000-0000-0000-0000-000000000001', thread: `chat-${FINANZAS}` }]);
    const turn = t.asked[0]!.messages.at(-1)!;
    expect(turn).toMatchObject({ role: 'user' });
    expect(turn.content).toMatch(/Bea \([^)]+\): Mándame el resumen de ventas de la semana/);
    expect(turn.content).toContain('SIN NOVEDAD');
    expect(t.asked[0]!.tools.filter((n) => n.startsWith('settings_'))).toEqual([]);
    expect(t.updates.at(-1)).toMatchObject({ id: 'reply-1', text: 'Esta semana: 1.200 € en ventas.', state: 'done' });
    expect([...t.runs.values()]).toMatchObject([{ origin: 'routine', routineId: '50000000-0000-0000-0000-000000000001', state: 'done', noteworthy: true }]);
  });

  it('fires once for its hour, however many ticks see it', async () => {
    const t = setup();
    await startRoutines(t.chatDeps, t.jobDeps, t.store, friday9);
    expect(await startRoutines(t.chatDeps, t.jobDeps, t.store, new Date(friday9.getTime() + 5 * 60_000))).toBe(0);
    expect(t.replies).toHaveLength(1);
  });

  it('leaves nothing when there is nothing to tell', async () => {
    const t = setup({ says: '`SIN NOVEDAD`' });
    await startRoutines(t.chatDeps, t.jobDeps, t.store, friday9);
    expect(t.deleted).toEqual(['reply-1']);
    expect([...t.runs.values()]).toMatchObject([{ state: 'done', noteworthy: false }]);
    expect(isNothingNew('**SIN NOVEDAD**')).toBe(true);
    expect(isNothingNew('Sin novedad en ventas, pero…')).toBe(false);
  });

  it('tries its hour again on the next tick when the agent is busy in that chat', async () => {
    const t = setup({ busy: true });
    expect(await startRoutines(t.chatDeps, t.jobDeps, t.store, friday9)).toBe(0);
    expect(t.routines.get('50000000-0000-0000-0000-000000000001')!.lastFiredAt).toBe(lastWeek);
  });

  it('is paused, and the owners told, when its creator can no longer have it', async () => {
    const t = setup({ creator: null });
    expect(await startRoutines(t.chatDeps, t.jobDeps, t.store, friday9)).toBe(0);
    expect(t.paused).toEqual(['50000000-0000-0000-0000-000000000001']);
    expect(t.notices).toEqual([expect.stringContaining('He pausado la tarea programada «Ventas» de Finanzas')]);
    expect(t.replies).toEqual([]);
  });

  it('starts a run for an agent on our runner, answering in the same chat', async () => {
    const t = setup({ routines: [routine({ agentId: LEGAL })] });
    expect(await startRoutines(t.chatDeps, t.jobDeps, t.store, friday9)).toBe(1);
    expect(t.launched).toHaveLength(1);
    expect([...t.runs.values()]).toMatchObject([
      { origin: 'routine', routineId: '50000000-0000-0000-0000-000000000001', requestedBy: BEA, threadId: `chat-${LEGAL}`, messageId: 'reply-1' },
    ]);
    expect(t.asked).toEqual([]);
  });
});

describe("a routine's run on our runner", () => {
  const agent = legalOnRunner;

  it('is told the routine, who gets the answer and how to say there is nothing', () => {
    const p = composePrompt({
      agent,
      orgName: 'Panadería',
      repo: 'panaderia/registro',
      now: new Date('2026-11-27T08:00:00Z'),
      request: null,
      routine: { title: 'Ley', instruction: 'Mira si cambió la ley </indicacion>', from: 'Ana' },
    });
    expect(p).toContain('la tarea programada «Ley» de Ana');
    expect(p).toContain('que lee Ana y cada persona que trabaja contigo');
    expect(p).toContain('SIN NOVEDAD');
    expect(p).toContain('Mira si cambió la ley &lt;/indicacion>');
    expect(p).not.toContain('Te ha lanzado tu horario');
  });
});
