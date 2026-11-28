// The main agent's hands in chat (docs/plans/ongoing/direccion-main-agent.md).
//
// Dirección answers every message in a chat turn, in seconds. Three tools let
// it lead the team from there:
//
// - `ver_ejecuciones`: what each agent did lately (agent_runs), read as the
//   person who asked, so it shows only the agents they may see.
// - `trabajar_a_fondo`: it launches itself on our runner with a brief, for
//   what the chat turn has no tool for (a repo's code, BigQuery, a whole
//   transcript, changing the record).
// - `encargar_a_agente`: it brings another agent in with a brief. One on our
//   runner starts a run; a chat agent answers in the same chat right after
//   Dirección's message (a thread has one reply being written at a time).
//
// A run launched here holds no «working» message, so the chat stays free while
// it works: its answer arrives as a new message in the same chat (jobs.ts).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatAgent } from './chat';
import { type AgentTools, clip, type ToolOutcome, type ToolSpec } from './tools';

export const RUNS_TOOL = 'ver_ejecuciones';
export const DEEP_TOOL = 'trabajar_a_fondo';
export const BRING_TOOL = 'encargar_a_agente';

/** At most this many characters of a brief: what agent_runs.brief keeps. */
export const MAX_BRIEF = 8000;
/** Runs `ver_ejecuciones` lists by default, and at most. */
const RUNS_DEFAULT = 10;
const RUNS_MAX = 30;
/** What it reads of each run's last message. */
const SUMMARY_CHARS = 1200;

/** A chat agent the main agent brought in: it answers in the same chat once the main agent's message is done. */
export interface Bring {
  agent: ChatAgent;
  brief: string;
}

export interface DelegationContext {
  /** The main agent, in this turn. */
  lead: ChatAgent;
  /** The organisation's agents. */
  agents: ChatAgent[];
  /** Whoever asked, as the app sees them: their reads respect what they may see. */
  client: SupabaseClient;
  /** Whether whoever asked may talk to this agent: only then may it be brought in for them. */
  canTalk(agentId: string): Promise<boolean>;
  /** Launches a run of an agent on our runner with the brief, without holding a message (runner.ts delegateRun). */
  launch(agent: ChatAgent, brief: string): Promise<{ started: true } | { started: false; said: string }>;
  /** Where a chat agent brought in waits until the main agent's message is done. */
  pending: { bring: Bring | null };
}

const SPECS: ToolSpec[] = [
  {
    name: RUNS_TOOL,
    description:
      "What the organisation's agents did lately, newest first: who, how each run started (a person, its timetable, a routine), whether it went well, when, and what it said at the end. " +
      'Read it before answering what an agent did or how an area goes. Pass `agente` (its name) for one agent only.',
    input_schema: {
      type: 'object',
      properties: {
        agente: { type: 'string', description: 'The name of one agent; leave it out for every agent.' },
        n: { type: 'integer', description: `How many runs, ${RUNS_DEFAULT} by default, at most ${RUNS_MAX}.` },
      },
    },
  },
  {
    name: DEEP_TOOL,
    description:
      'Work on it in depth: you launch yourself on your own runner, with every repo of your team cloned, the organisation record, BigQuery and the other agents’ whole runs, and your answer arrives in this same chat in a few minutes. ' +
      'Use it when answering for real needs something you have no tool for here (a repo’s code or files, a query, a whole transcript, changing the record), or when the person asks you to look into it in depth. ' +
      'The brief must stand on its own: what to find out or do, why, and what the person expects back. After it, say in one line that you are on it and the answer will come here; say what you already know, if anything.',
    input_schema: {
      type: 'object',
      properties: { encargo: { type: 'string', description: 'The brief, in Spanish.' } },
      required: ['encargo'],
    },
  },
  {
    name: BRING_TOOL,
    description:
      'Ask another agent of the team to do something or tell you something of its area that its runs do not say. It gets your brief and answers in this same chat: an agent on its runner in a few minutes, a chat agent right after your message. ' +
      'Use the agent’s name or id (settings_read lists them). The brief must stand on its own. After it, say in one line who you asked and that the answer will come here.',
    input_schema: {
      type: 'object',
      properties: {
        agente: { type: 'string', description: 'The agent’s name or id.' },
        encargo: { type: 'string', description: 'The brief, in Spanish.' },
      },
      required: ['agente', 'encargo'],
    },
  },
];

const STEPS: Record<string, string> = {
  [RUNS_TOOL]: 'Mirando lo que ha hecho el equipo',
  [DEEP_TOOL]: 'Poniéndome a fondo',
  [BRING_TOOL]: 'Encargándoselo',
};

const fail = (content: string): ToolOutcome => ({ content, isError: true });
const ok = (content: string): ToolOutcome => ({ content, isError: false });

const plain = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/** An agent of the organisation by its id, name or slug. */
export function findAgent(agents: ChatAgent[], said: unknown): ChatAgent | null {
  if (typeof said !== 'string' || !said.trim()) return null;
  const want = plain(said.replace(/^@/, ''));
  return agents.find((a) => a.id === said.trim()) ?? agents.find((a) => plain(a.name) === want || (a.slug && plain(a.slug) === want)) ?? null;
}

function briefOf(input: unknown): string | null {
  const v = typeof input === 'object' && input !== null ? (input as { encargo?: unknown }).encargo : undefined;
  const t = typeof v === 'string' ? v.trim() : '';
  return t ? t.slice(0, MAX_BRIEF) : null;
}

type RunRow = { agent_id: string; origin: string; state: string; summary: string | null; brief: string | null; started_at: string; finished_at: string | null };

const ORIGIN_WORDS: Record<string, string> = { person: 'se lo pidió alguien', schedule: 'su horario', routine: 'una tarea programada' };

/** The main agent's tools in a turn a person asked for. */
export function delegationTools(ctx: DelegationContext): AgentTools {
  let delegated = false;
  const once = (): ToolOutcome | null =>
    delegated ? fail('Ya has encargado algo en este mensaje: uno por mensaje. Dilo y espera a que llegue la respuesta.') : null;

  return {
    specs: SPECS,
    accounts: [],
    accountProviders: [],
    stepFor: (name) => STEPS[name] ?? 'Trabajando',
    // Nothing here changes anything outside Ghostaff: an agent works with its own permissions, as when a person asks it.
    writes: () => false,
    actionFor: (name) => name,
    async run(name, input) {
      if (name === RUNS_TOOL) {
        const i = (typeof input === 'object' && input !== null ? input : {}) as { agente?: unknown; n?: unknown };
        const one = i.agente === undefined || i.agente === '' ? null : findAgent(ctx.agents, i.agente);
        if (i.agente && !one) return fail(`No hay ningún agente «${String(i.agente)}» en el equipo. Mira los nombres con settings_read.`);
        const n = Math.min(RUNS_MAX, Math.max(1, Number.isInteger(i.n) ? (i.n as number) : RUNS_DEFAULT));
        let q = ctx.client
          .from('agent_runs')
          .select('agent_id, origin, state, summary, brief, started_at, finished_at')
          .eq('org_id', ctx.lead.orgId)
          .neq('state', 'skipped')
          .order('started_at', { ascending: false })
          .limit(n);
        if (one) q = q.eq('agent_id', one.id);
        const { data, error } = await q.returns<RunRow[]>();
        if (error) return fail('No he podido leer las ejecuciones ahora.');
        if (!data?.length) return ok(one ? `${one.name} no tiene ejecuciones que puedas ver.` : 'No hay ejecuciones que puedas ver.');
        const names = new Map(ctx.agents.map((a) => [a.id, a.name]));
        const lines = data.map((r) => {
          const said = r.summary ? r.summary.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS) : r.state === 'running' ? '(sigue trabajando)' : '(no dijo nada)';
          const why = r.brief ? `encargo: ${r.brief.replace(/\s+/g, ' ').slice(0, 200)}` : (ORIGIN_WORDS[r.origin] ?? r.origin);
          return `- ${names.get(r.agent_id) ?? 'Un agente'} · ${r.started_at} · ${why} · ${r.state}\n  ${said}`;
        });
        return ok(clip(lines.join('\n')));
      }

      if (name === DEEP_TOOL) {
        const again = once();
        if (again) return again;
        const brief = briefOf(input);
        if (!brief) return fail('Falta `encargo`: qué tienes que averiguar o hacer, y para qué.');
        const r = await ctx.launch(ctx.lead, brief);
        if (!r.started) return fail(`No me he podido poner a fondo: ${r.said}`);
        delegated = true;
        return ok('Lanzado. Trabajas a fondo en tu runner y tu respuesta llegará a este chat en unos minutos. Dilo así, en una línea.');
      }

      if (name === BRING_TOOL) {
        const again = once();
        if (again) return again;
        const i = (typeof input === 'object' && input !== null ? input : {}) as { agente?: unknown };
        const target = findAgent(ctx.agents, i.agente);
        if (!target) return fail(`No hay ningún agente «${String(i.agente ?? '')}» en el equipo. Mira los nombres con settings_read.`);
        if (target.id === ctx.lead.id) return fail(`Eres tú: para trabajar a fondo, usa ${DEEP_TOOL}.`);
        const brief = briefOf(input);
        if (!brief) return fail('Falta `encargo`: qué le pides y para qué.');
        if (!(await ctx.canTalk(target.id))) return fail(`Quien te lo pide no puede hablar con ${target.name}, así que no se lo puedes encargar por esa persona.`);
        if (target.runner === 'ordago_job') return fail(`${target.name} aún trabaja fuera de Ghostaff y no recibe encargos desde aquí.`);
        if (target.runner === 'ghostaff') {
          const r = await ctx.launch(target, brief);
          if (!r.started) return fail(`${target.name} no ha podido ponerse: ${r.said}`);
          delegated = true;
          return ok(`Encargado a ${target.name}: su respuesta llegará a este chat en unos minutos. Dilo así, en una línea.`);
        }
        ctx.pending.bring = { agent: target, brief };
        delegated = true;
        return ok(`Encargado a ${target.name}: contestará en este chat justo después de tu mensaje. Dilo así, en una línea.`);
      }

      return fail(`No existe la herramienta ${name}.`);
    },
  };
}

/** What a chat agent brought in is told, after its usual instructions. */
export function broughtWithBrief(leadName: string, brief: string): string {
  return `${leadName}, que lleva el equipo, te ha traído a esta conversación con este encargo. Atiéndelo con lo que tienes y contesta para quien lo lea aquí.\n<encargo>\n${brief.replace(/</g, '&lt;')}\n</encargo>`;
}
