// The organisation's settings, as its main agent sees and changes them
// (docs/plans/ongoing/agent-settings.md). Anything an owner can change in the
// app, the main agent can propose too, through the same service functions the
// screens call: the engine runs a proposal only once an owner approves it, and
// then with that owner's own session, so the database checks the change exactly
// as if the owner had made it on the screen. There is no other way in.
//
// DATABASE_FUNCTIONS classifies every function in supabase/migrations: one the
// agent may propose names its tool here, one it never may says why. A test fails
// on a new function nobody classified, so no setting ships without that choice.

import type { SupabaseClient } from '@supabase/supabase-js';
import { ACCOUNT_PROVIDERS, type AccountProvider, connectorFor } from '../connectors';
import { AGENT_GHOSTS, AGENT_LEVELS, type AgentGhost, type AgentLevel, CONVERSATION_VISIBILITIES, type ConversationVisibility, type Department, DEPARTMENTS } from '../models';
import { ALL_WEEKDAYS, describeWhen, invalidWhen, MAX_ROUTINES_PER_PERSON, type Routine, type RoutineAudience, type Weekday } from '../routines';
import {
  createAgent,
  createRoutine,
  listRoutines,
  setRoutinePaused,
  updateRoutine,
  type RoutineInput,
  inviteMember,
  listAgentAccess,
  listAgents,
  listConnections,
  listMembers,
  listPendingInvitations,
  renameAiConnection,
  revokeInvitation,
  setAgentAccess,
  setAgentAccounts,
  setAgentChatDefault,
  setAiOrder,
} from './index';

/** Who a settings tool acts as and for. */
export interface SettingsContext {
  /** A client signed in as the person: the one who asked (reads) or the owner who approved (changes). */
  client: SupabaseClient;
  orgId: string;
  /** The agent proposing. It never changes its own reach. */
  agentId: string;
  /**
   * Set for every agent but the main one: it may only read and propose its
   * own routines (agent-routines.md, «By asking»), and has no other setting.
   */
  onlySelf?: boolean;
}

export interface SettingTool {
  name: string;
  /** For the model, in English like every tool description. */
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  /** False only for the one tool that reads; every other one waits for an owner's approval. */
  writes: boolean;
  /** The line the person sees while it runs, in Spanish. */
  step: string;
  /**
   * What the approval card says, in Spanish, with what is now and what it will
   * be, and who decides it: an owner, or the person who asked (their own
   * «Solo para mí» routine). Throws SettingError on bad input.
   */
  describe?(ctx: SettingsContext, input: Record<string, unknown>): Promise<{ label: string; preview: string; decider?: Decider }>;
  /** Makes the change, or reads; returns what the model reads back. Throws SettingError for a refusal it should hear. */
  run(ctx: SettingsContext, input: Record<string, unknown>): Promise<string>;
}

/** A refusal the model is told, in words it can pass on. */
export class SettingError extends Error {}

/** Who approves a proposed change: an owner, or the person who asked for it (agent-routines.md, decision 1). */
export type Decider = 'owner' | 'requester';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string' || !UUID.test(v)) throw new SettingError(`${key} tiene que ser un id de los que da settings_read.`);
  return v;
}

function text(input: Record<string, unknown>, key: string, max: number): string {
  const v = input[key];
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw new SettingError(`${key} tiene que ser un texto de hasta ${max} caracteres.`);
  return v.trim();
}

function oneOf<T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = input[key];
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new SettingError(`${key} tiene que ser uno de: ${allowed.join(', ')}.`);
  return v as T;
}

const LEVEL_WORDS: Record<AgentLevel, string> = { none: 'nada', read: 'ver', talk: 'hablar' };

const VISIBILITY_WORDS: Record<ConversationVisibility, string> = {
  private: 'solo quien la abre',
  read: 'el equipo puede leer',
  write: 'el equipo puede escribir',
};

const providerName = (p: string) => ((ACCOUNT_PROVIDERS as readonly string[]).includes(p) ? connectorFor(p as AccountProvider).name : p);

const toolsWords = (tools: readonly string[] | null) =>
  tools === null ? 'todas las cuentas conectadas' : tools.length === 0 ? 'ninguna cuenta' : tools.map(providerName).join(', ');

async function agentOf(ctx: SettingsContext, id: string) {
  const a = (await listAgents(ctx.client, ctx.orgId)).find((x) => x.id === id);
  if (!a) throw new SettingError('No hay ningún agente con ese id en esta organización.');
  return a;
}

async function memberOf(ctx: SettingsContext, id: string) {
  const m = (await listMembers(ctx.client, ctx.orgId)).find((x) => x.userId === id);
  if (!m) throw new SettingError('No hay nadie con ese id en esta organización.');
  return m;
}

async function aiAccounts(ctx: SettingsContext) {
  return (await listConnections(ctx.client, ctx.orgId)).filter((c) => c.kind === 'ai').sort((a, b) => a.position - b.position);
}

const aiName = (c: { label: string | null; provider: string; hint: string }) => c.label ?? `${c.provider} (${c.hint})`;

/** Reads that only an owner may make come back as null for anyone else. */
async function ownerOnly<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch {
    return null;
  }
}

export const SETTING_TOOLS: SettingTool[] = [
  {
    name: 'settings_read',
    description:
      "Read the organisation's current settings in Ghostaff: its agents (with which connected accounts each may use), the connected accounts, the AI accounts in the order they are tried, the members, who may see or talk to each agent, and open invitations. Read this before proposing any settings change, and use the ids it returns.",
    input_schema: { type: 'object', properties: {} },
    writes: false,
    step: 'Mirando la configuración',
    async run(ctx) {
      const [agents, connections, members, invitations, routines] = await Promise.all([
        listAgents(ctx.client, ctx.orgId),
        listConnections(ctx.client, ctx.orgId),
        listMembers(ctx.client, ctx.orgId),
        ownerOnly(listPendingInvitations(ctx.client, ctx.orgId)),
        listRoutines(ctx.client, ctx.orgId),
      ]);
      const access = await Promise.all(agents.map((a) => ownerOnly(listAgentAccess(ctx.client, a.id))));
      return JSON.stringify({
        agents: agents.map((a, i) => ({
          id: a.id,
          name: a.name,
          department: a.department,
          ghost: a.ghost,
          you: a.id === ctx.agentId,
          accounts: a.accounts ?? 'all',
          member_default: a.memberDefault,
          chat_default: a.chatDefault,
          access: access[i]?.filter((p) => p.role !== 'owner').map((p) => ({ user_id: p.userId, name: p.displayName, level: p.level })) ?? undefined,
        })),
        connected_accounts: connections
          .filter((c) => c.kind === 'account')
          .map((c) => ({ provider: c.provider, name: providerName(c.provider), account: c.hint, status: c.status })),
        ai_accounts: connections
          .filter((c) => c.kind === 'ai')
          .sort((a, b) => a.position - b.position)
          .map((c) => ({ id: c.id, name: aiName(c), provider: c.provider, position: c.position, status: c.status })),
        members: members.map((m) => ({ user_id: m.userId, name: m.displayName, role: m.role })),
        open_invitations: invitations?.map((i) => ({ id: i.id, email: i.email, role: i.role })) ?? 'only owners see them',
        routines: routines.map((r) => routineForModel(r, agents.find((a) => a.id === r.agentId)?.name)),
        ghosts: AGENT_GHOSTS,
        departments: DEPARTMENTS,
      });
    },
  },
  {
    name: 'settings_create_agent',
    description: 'Propose adding a new agent to the team. An owner approves it before it exists.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Its name, up to 60 characters.' },
        ghost: { type: 'string', enum: [...AGENT_GHOSTS], description: 'How it is drawn, which also gives it its default job.' },
        department: { type: 'string', enum: [...DEPARTMENTS] },
      },
      required: ['name', 'ghost', 'department'],
    },
    writes: true,
    step: 'Preparando un agente nuevo',
    async describe(_ctx, input) {
      const name = text(input, 'name', 60);
      const department = oneOf<Department>(input, 'department', DEPARTMENTS);
      oneOf<AgentGhost>(input, 'ghost', AGENT_GHOSTS);
      return { label: `Añadir a ${name} al equipo`, preview: `Departamento: ${department}` };
    },
    async run(ctx, input) {
      const a = await createAgent(ctx.client, {
        orgId: ctx.orgId,
        name: text(input, 'name', 60),
        ghost: oneOf<AgentGhost>(input, 'ghost', AGENT_GHOSTS),
        department: oneOf<Department>(input, 'department', DEPARTMENTS),
      });
      return `${a.name} ya está en el equipo.`;
    },
  },
  {
    name: 'settings_agent_accounts',
    description:
      "Propose which of the organisation's connected accounts another agent may use, by provider (from settings_read's connected_accounts). Pass every provider it should keep, or null to give it every connected account, including ones connected later. You cannot change your own.",
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        providers: { type: ['array', 'null'], items: { type: 'string' } },
      },
      required: ['agent_id', 'providers'],
    },
    writes: true,
    step: 'Preparando el cambio de herramientas',
    async describe(ctx, input) {
      const { agent, providers } = await agentAccounts(ctx, input);
      return {
        label: `Cambiar las cuentas que usa ${agent.name}`,
        preview: `Ahora: ${toolsWords(agent.accounts)}\nDespués: ${toolsWords(providers)}`,
      };
    },
    async run(ctx, input) {
      const { agent, providers } = await agentAccounts(ctx, input);
      await setAgentAccounts(ctx.client, agent.id, providers);
      return `${agent.name} usa ahora ${toolsWords(providers)}.`;
    },
  },
  {
    name: 'settings_agent_access',
    description: "Propose what one member (not an owner: owners always talk to every agent) may do with one agent: 'none', 'read' or 'talk'.",
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        user_id: { type: 'string' },
        level: { type: 'string', enum: [...AGENT_LEVELS] },
      },
      required: ['agent_id', 'user_id', 'level'],
    },
    writes: true,
    step: 'Preparando el cambio de acceso',
    async describe(ctx, input) {
      const [agent, member] = await Promise.all([agentOf(ctx, uuid(input, 'agent_id')), memberOf(ctx, uuid(input, 'user_id'))]);
      const level = oneOf<AgentLevel>(input, 'level', AGENT_LEVELS);
      const now = (await ownerOnly(listAgentAccess(ctx.client, agent.id)))?.find((p) => p.userId === member.userId)?.level;
      return {
        label: `Cambiar lo que ${member.displayName} puede hacer con ${agent.name}`,
        preview: `${now ? `Ahora: ${LEVEL_WORDS[now]}\n` : ''}Después: ${LEVEL_WORDS[level]}`,
      };
    },
    async run(ctx, input) {
      const [agent, member] = await Promise.all([agentOf(ctx, uuid(input, 'agent_id')), memberOf(ctx, uuid(input, 'user_id'))]);
      const level = oneOf<AgentLevel>(input, 'level', AGENT_LEVELS);
      await setAgentAccess(ctx.client, agent.id, member.userId, level);
      return `${member.displayName} puede ahora ${LEVEL_WORDS[level]} con ${agent.name}.`;
    },
  },
  {
    name: 'settings_agent_chat_default',
    description:
      "Propose who reads a new conversation with one agent unless whoever opens it chooses otherwise: 'private' (only them), 'read' (everyone who may see the agent reads it) or 'write' (they may also write, by their level on the agent). It never changes a conversation already open: those are their openers' alone.",
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        visibility: { type: 'string', enum: [...CONVERSATION_VISIBILITIES] },
      },
      required: ['agent_id', 'visibility'],
    },
    writes: true,
    step: 'Preparando el cambio de conversaciones',
    async describe(ctx, input) {
      const agent = await agentOf(ctx, uuid(input, 'agent_id'));
      const visibility = oneOf<ConversationVisibility>(input, 'visibility', CONVERSATION_VISIBILITIES);
      return {
        label: `Cambiar quién lee las conversaciones nuevas con ${agent.name}`,
        preview: `Ahora: ${VISIBILITY_WORDS[agent.chatDefault]}\nDespués: ${VISIBILITY_WORDS[visibility]}`,
      };
    },
    async run(ctx, input) {
      const agent = await agentOf(ctx, uuid(input, 'agent_id'));
      const visibility = oneOf<ConversationVisibility>(input, 'visibility', CONVERSATION_VISIBILITIES);
      await setAgentChatDefault(ctx.client, agent.id, visibility);
      return `Las conversaciones nuevas con ${agent.name}: ${VISIBILITY_WORDS[visibility]}, salvo que quien la abra elija otra cosa.`;
    },
  },
  {
    name: 'settings_ai_order',
    description: "Propose the order in which the organisation's AI accounts are tried: every AI account id from settings_read, first one first.",
    input_schema: {
      type: 'object',
      properties: { connection_ids: { type: 'array', items: { type: 'string' } } },
      required: ['connection_ids'],
    },
    writes: true,
    step: 'Preparando el orden de las cuentas de IA',
    async describe(ctx, input) {
      const { now, next } = await aiOrder(ctx, input);
      return { label: 'Cambiar el orden de las cuentas de IA', preview: `Ahora: ${now.map(aiName).join(' → ')}\nDespués: ${next.map(aiName).join(' → ')}` };
    },
    async run(ctx, input) {
      const { next } = await aiOrder(ctx, input);
      await setAiOrder(
        ctx.client,
        ctx.orgId,
        next.map((c) => c.id),
      );
      return `Orden guardado: ${next.map(aiName).join(' → ')}.`;
    },
  },
  {
    name: 'settings_rename_ai_account',
    description: 'Propose a new name for one AI account, as people see it in Conexiones.',
    input_schema: {
      type: 'object',
      properties: { connection_id: { type: 'string' }, name: { type: 'string', description: 'Up to 60 characters.' } },
      required: ['connection_id', 'name'],
    },
    writes: true,
    step: 'Preparando el nombre',
    async describe(ctx, input) {
      const c = await aiAccount(ctx, input);
      return { label: `Renombrar la cuenta de IA «${aiName(c)}»`, preview: `Después: ${text(input, 'name', 60)}` };
    },
    async run(ctx, input) {
      const c = await aiAccount(ctx, input);
      await renameAiConnection(ctx.client, c.id, text(input, 'name', 60));
      return 'Nombre guardado.';
    },
  },
  {
    name: 'settings_invite_member',
    description:
      'Propose inviting someone to the organisation by email, as a member (never as an owner), optionally with their level on each agent (agent id → none, read or talk).',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        agent_levels: { type: 'object', additionalProperties: { type: 'string', enum: [...AGENT_LEVELS] } },
      },
      required: ['email'],
    },
    writes: true,
    step: 'Preparando la invitación',
    async describe(ctx, input) {
      const { email, levels } = await invitation(ctx, input);
      const lines = await Promise.all(Object.entries(levels).map(async ([id, l]) => `${(await agentOf(ctx, id)).name}: ${LEVEL_WORDS[l]}`));
      return { label: `Invitar a ${email} como miembro`, preview: lines.join('\n') };
    },
    async run(ctx, input) {
      const { email, levels } = await invitation(ctx, input);
      await inviteMember(ctx.client, ctx.orgId, email, 'member', levels);
      return `Invitación enviada a ${email}.`;
    },
  },
  {
    name: 'settings_revoke_invitation',
    description: 'Propose withdrawing an open invitation (its id from settings_read).',
    input_schema: { type: 'object', properties: { invitation_id: { type: 'string' } }, required: ['invitation_id'] },
    writes: true,
    step: 'Preparando la retirada de la invitación',
    async describe(ctx, input) {
      const i = await openInvitation(ctx, input);
      return { label: `Retirar la invitación de ${i.email}`, preview: '' };
    },
    async run(ctx, input) {
      const i = await openInvitation(ctx, input);
      await revokeInvitation(ctx.client, i.id);
      return `Invitación de ${i.email} retirada.`;
    },
  },
  {
    name: 'settings_read_routines',
    description:
      "Read the routines you can see: what an agent does on its own at an hour, for the person who asked ('me') or for the whole team ('team'). Read this before changing or pausing one, and use the ids it returns.",
    input_schema: { type: 'object', properties: {} },
    writes: false,
    step: 'Mirando las rutinas',
    async run(ctx) {
      const [agents, routines] = await Promise.all([listAgents(ctx.client, ctx.orgId), listRoutines(ctx.client, ctx.orgId)]);
      const mine = ctx.onlySelf ? routines.filter((r) => r.agentId === ctx.agentId) : routines;
      return JSON.stringify(mine.map((r) => routineForModel(r, agents.find((a) => a.id === r.agentId)?.name)));
    },
  },
  {
    name: 'settings_create_routine',
    description:
      "Propose a routine: something an agent will do on its own at an hour, as if the person wrote it to it then; its answer lands in their chat with that agent. Turn what they say («los viernes a las 9») into days (1 Monday … 7 Sunday; all seven for every day) or month_day (1–28, once a month), and hour and minute in the organisation's time. audience 'me' is for the person who asked, and they approve it; 'team' sends the answer to everyone who can see the agent, and an owner approves it. Once a day at most. Propose it only when they ask for something to happen regularly, or say yes when you offer it.",
    input_schema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: "The agent that will do it; you, unless they ask for another agent's." },
        audience: { type: 'string', enum: ['me', 'team'] },
        title: { type: 'string', description: 'A few words, up to 80 characters: «Resumen de ventas».' },
        instruction: { type: 'string', description: 'What the agent is asked each time, as the person would write it, up to 2000 characters.' },
        days: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 } },
        month_day: { type: 'integer', minimum: 1, maximum: 28 },
        hour: { type: 'integer', minimum: 0, maximum: 23 },
        minute: { type: 'integer', minimum: 0, maximum: 59 },
      },
      required: ['agent_id', 'audience', 'title', 'instruction', 'hour'],
    },
    writes: true,
    step: 'Preparando la rutina',
    async describe(ctx, input) {
      const { agent, audience, routine } = await newRoutine(ctx, input);
      return {
        label: `Rutina de ${agent.name}: «${routine.title}»`,
        preview: routinePreview(routine, audience),
        decider: audience === 'me' ? 'requester' : 'owner',
      };
    },
    async run(ctx, input) {
      const { agent, audience, routine } = await newRoutine(ctx, input);
      const made = await createRoutine(ctx.client, agent.id, audience, routine);
      return `Rutina guardada: ${agent.name}, ${describeWhen(made).toLowerCase()}, «${made.title}».`;
    },
  },
  {
    name: 'settings_update_routine',
    description:
      'Propose changing what a routine does or when (its id from settings_read_routines): pass all of it as it should be, with the same fields as settings_create_routine but no agent_id or audience.',
    input_schema: {
      type: 'object',
      properties: {
        routine_id: { type: 'string' },
        title: { type: 'string' },
        instruction: { type: 'string' },
        days: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 } },
        month_day: { type: 'integer', minimum: 1, maximum: 28 },
        hour: { type: 'integer', minimum: 0, maximum: 23 },
        minute: { type: 'integer', minimum: 0, maximum: 59 },
      },
      required: ['routine_id', 'title', 'instruction', 'hour'],
    },
    writes: true,
    step: 'Preparando el cambio de la rutina',
    async describe(ctx, input) {
      const now = await routineOf(ctx, input);
      const next = routineFields(input);
      return {
        label: `Cambiar la rutina «${now.title}»`,
        preview: `Ahora: ${describeWhen(now)}, «${now.title}»\nDespués: ${describeWhen(next)}, «${next.title}»\n${next.instruction}`,
        decider: now.audience === 'me' ? 'requester' : 'owner',
      };
    },
    async run(ctx, input) {
      const now = await routineOf(ctx, input);
      const r = await updateRoutine(ctx.client, now.id, routineFields(input));
      return `Rutina cambiada: ${describeWhen(r).toLowerCase()}, «${r.title}».`;
    },
  },
  {
    name: 'settings_pause_routine',
    description: 'Propose pausing a routine, or resuming it (paused false); its id from settings_read_routines. A routine is never deleted here: that is done in the app.',
    input_schema: {
      type: 'object',
      properties: { routine_id: { type: 'string' }, paused: { type: 'boolean' } },
      required: ['routine_id', 'paused'],
    },
    writes: true,
    step: 'Preparando la pausa de la rutina',
    async describe(ctx, input) {
      const r = await routineOf(ctx, input);
      const paused = pausedOf(input);
      return {
        label: `${paused ? 'Pausar' : 'Reanudar'} la rutina «${r.title}»`,
        preview: `Ahora: ${r.paused ? 'en pausa' : describeWhen(r)}\nDespués: ${paused ? 'en pausa' : describeWhen(r)}`,
        decider: r.audience === 'me' ? 'requester' : 'owner',
      };
    },
    async run(ctx, input) {
      const r = await routineOf(ctx, input);
      const paused = pausedOf(input);
      await setRoutinePaused(ctx.client, r.id, paused);
      return paused ? `Rutina «${r.title}» en pausa.` : `Rutina «${r.title}» reanudada: ${describeWhen(r).toLowerCase()}.`;
    },
  },
];

/** The tools every agent has, for its own routines only (SettingsContext.onlySelf). */
export const ROUTINE_TOOL_NAMES = ['settings_read_routines', 'settings_create_routine', 'settings_update_routine', 'settings_pause_routine'] as const;

function routineForModel(r: Routine, agentName: string | undefined) {
  return {
    id: r.id,
    agent_id: r.agentId,
    agent: agentName ?? null,
    audience: r.audience,
    title: r.title,
    instruction: r.instruction,
    when: describeWhen(r),
    paused: r.paused,
  };
}

const AUDIENCE_WORDS: Record<RoutineAudience, string> = { me: 'solo para quien la pide', team: 'todo el equipo que ve al agente' };

function routinePreview(r: RoutineInput, audience: RoutineAudience): string {
  return `Cuándo: ${describeWhen(r)}\nQué: ${r.instruction}\nPara: ${AUDIENCE_WORDS[audience]}`;
}

/** The timetable and words of a routine, from the model's fields. */
function routineFields(input: Record<string, unknown>): RoutineInput {
  const title = text(input, 'title', 80);
  const instruction = text(input, 'instruction', 2000);
  const int = (k: string, fallback?: number) => {
    const v = input[k] ?? fallback;
    if (typeof v !== 'number' || !Number.isInteger(v)) throw new SettingError(`${k} tiene que ser un número entero.`);
    return v;
  };
  const monthly = input.month_day !== undefined && input.month_day !== null;
  const days = input.days ?? [...ALL_WEEKDAYS];
  if (!monthly && (!Array.isArray(days) || days.some((d) => typeof d !== 'number'))) {
    throw new SettingError('days tiene que ser una lista de días, del 1 (lunes) al 7 (domingo).');
  }
  const r: RoutineInput = {
    title,
    instruction,
    kind: monthly ? 'monthly' : 'days',
    weekdays: monthly ? [...ALL_WEEKDAYS] : ([...new Set(days as number[])] as Weekday[]),
    monthDay: monthly ? int('month_day') : null,
    hour: int('hour'),
    minute: int('minute', 0),
  };
  const wrong = invalidWhen(r);
  if (wrong) throw new SettingError(wrong);
  return r;
}

async function newRoutine(ctx: SettingsContext, input: Record<string, unknown>) {
  const agent = await agentOf(ctx, uuid(input, 'agent_id'));
  if (ctx.onlySelf && agent.id !== ctx.agentId) throw new SettingError('Solo puedes proponer rutinas tuyas; las de otro agente se piden a Secretaría.');
  if (agent.runner === 'ordago_job') throw new SettingError(`${agent.name} todavía no admite rutinas.`);
  const audience = oneOf<RoutineAudience>(input, 'audience', ['me', 'team']);
  const routine = routineFields(input);
  const mine = (await listRoutines(ctx.client, ctx.orgId)).filter((r) => r.audience === 'me').length;
  if (audience === 'me' && mine >= MAX_ROUTINES_PER_PERSON) {
    throw new SettingError(`Ya tiene ${MAX_ROUTINES_PER_PERSON} rutinas, el máximo: que pause o borre alguna en la app antes.`);
  }
  return { agent, audience, routine };
}

async function routineOf(ctx: SettingsContext, input: Record<string, unknown>): Promise<Routine> {
  const id = uuid(input, 'routine_id');
  const r = (await listRoutines(ctx.client, ctx.orgId)).find((x) => x.id === id);
  if (!r || (ctx.onlySelf && r.agentId !== ctx.agentId)) throw new SettingError('No hay ninguna rutina con ese id que puedas ver.');
  return r;
}

function pausedOf(input: Record<string, unknown>): boolean {
  if (typeof input.paused !== 'boolean') throw new SettingError('paused tiene que ser true o false.');
  return input.paused;
}


async function agentAccounts(ctx: SettingsContext, input: Record<string, unknown>) {
  const agent = await agentOf(ctx, uuid(input, 'agent_id'));
  if (agent.id === ctx.agentId) throw new SettingError('No puedes cambiar tus propias herramientas: eso lo decide una persona en la app.');
  const raw = input.providers;
  if (raw !== null && (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string' || !/^[a-z0-9_]{1,40}$/.test(p)))) {
    throw new SettingError('providers tiene que ser una lista de proveedores (por ejemplo ["google"]) o null para todas.');
  }
  const providers = raw === null ? null : [...new Set(raw as string[])].sort();
  return { agent, providers };
}

async function aiOrder(ctx: SettingsContext, input: Record<string, unknown>) {
  const now = await aiAccounts(ctx);
  const ids = input.connection_ids;
  if (!Array.isArray(ids) || ids.length !== now.length || new Set(ids).size !== ids.length || !ids.every((id) => now.some((c) => c.id === id))) {
    throw new SettingError('connection_ids tiene que tener cada cuenta de IA una vez, con los ids de settings_read.');
  }
  return { now, next: ids.map((id) => now.find((c) => c.id === id)!) };
}

async function aiAccount(ctx: SettingsContext, input: Record<string, unknown>) {
  const id = uuid(input, 'connection_id');
  const c = (await aiAccounts(ctx)).find((x) => x.id === id);
  if (!c) throw new SettingError('No hay ninguna cuenta de IA con ese id.');
  return c;
}

async function invitation(ctx: SettingsContext, input: Record<string, unknown>) {
  const email = text(input, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SettingError('email no es un correo.');
  const raw = input.agent_levels ?? {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SettingError('agent_levels tiene que ser un objeto.');
  const levels: Record<string, AgentLevel> = {};
  for (const [id, l] of Object.entries(raw)) {
    if (!UUID.test(id) || !AGENT_LEVELS.includes(l as AgentLevel)) throw new SettingError('agent_levels: id de agente → none, read o talk.');
    levels[id] = l as AgentLevel;
  }
  return { email, levels };
}

async function openInvitation(ctx: SettingsContext, input: Record<string, unknown>) {
  const id = uuid(input, 'invitation_id');
  const i = (await ownerOnly(listPendingInvitations(ctx.client, ctx.orgId)))?.find((x) => x.id === id);
  if (!i) throw new SettingError('No hay ninguna invitación abierta con ese id.');
  return i;
}

export type FunctionReach =
  /** The main agent may propose it, through this tool. */
  | { reach: 'agent'; tool: string }
  /** A setting the agent never touches, even with an owner's approval: the hard limits. */
  | { reach: 'never'; why: string }
  /** Not a setting: a read, a helper, or the chat itself. */
  | { reach: 'not_a_setting' };

/** Every function in supabase/migrations. A new one has to be added here (test/settings.test.ts). */
export const DATABASE_FUNCTIONS: Record<string, FunctionReach> = {
  create_agent: { reach: 'agent', tool: 'settings_create_agent' },
  set_agent_accounts: { reach: 'agent', tool: 'settings_agent_accounts' },
  set_agent_access: { reach: 'agent', tool: 'settings_agent_access' },
  set_agent_chat_default: { reach: 'agent', tool: 'settings_agent_chat_default' },
  set_ai_order: { reach: 'agent', tool: 'settings_ai_order' },
  rename_ai_connection: { reach: 'agent', tool: 'settings_rename_ai_account' },
  invite_member: { reach: 'agent', tool: 'settings_invite_member' },
  revoke_invitation: { reach: 'agent', tool: 'settings_revoke_invitation' },
  create_routine: { reach: 'agent', tool: 'settings_create_routine' },
  update_routine: { reach: 'agent', tool: 'settings_update_routine' },
  set_routine_paused: { reach: 'agent', tool: 'settings_pause_routine' },

  delete_agent: { reach: 'never', why: "it deletes the agent's conversations: the organisation's data" },
  delete_routine: { reach: 'never', why: 'an agent pauses a routine; deleting it is the person\'s, in the app' },
  answer_decision: { reach: 'never', why: "a decision is the person's to take" },
  unanswer_decision: { reach: 'never', why: "a decision is the person's to take" },
  set_conversation_visibility: { reach: 'never', why: "a conversation's privacy is its opener's alone" },
  accept_invitation: { reach: 'never', why: 'a person joins an organisation themselves' },
  save_profile: { reach: 'never', why: "a person's own profile" },
  create_organization: { reach: 'never', why: 'a new organisation is outside this one' },
  create_personal_space: { reach: 'never', why: 'a new organisation is outside this one' },

  agent_level: { reach: 'not_a_setting' },
  agent_level_for: { reach: 'not_a_setting' },
  ai_usage_daily: { reach: 'not_a_setting' },
  can_hear_voice_note: { reach: 'not_a_setting' },
  chat_with: { reach: 'not_a_setting' },
  conversation_readers: { reach: 'not_a_setting' },
  connections_place_last: { reach: 'not_a_setting' },
  ensure_main_agent: { reach: 'not_a_setting' },
  hire_main_agent: { reach: 'not_a_setting' },
  is_member: { reach: 'not_a_setting' },
  is_owner: { reach: 'not_a_setting' },
  list_agent_access: { reach: 'not_a_setting' },
  may_change_routine: { reach: 'not_a_setting' },
  notify_owners: { reach: 'not_a_setting' },
  post_routine_copies: { reach: 'not_a_setting' },
  mark_thread_read: { reach: 'not_a_setting' },
  my_agent_levels: { reach: 'not_a_setting' },
  my_email: { reach: 'not_a_setting' },
  my_invitations: { reach: 'not_a_setting' },
  my_threads: { reach: 'not_a_setting' },
  post_message: { reach: 'not_a_setting' },
  post_to_personal_chats: { reach: 'not_a_setting' },
  release_refresh_lease: { reach: 'not_a_setting' },
  request_connector: { reach: 'not_a_setting' },
  slug_for: { reach: 'not_a_setting' },
  snooze_decision: { reach: 'not_a_setting' },
  unsnooze_decision: { reach: 'not_a_setting' },
  start_thread: { reach: 'not_a_setting' },
  take_refresh_lease: { reach: 'not_a_setting' },
  thread_level: { reach: 'not_a_setting' },
  thread_level_for: { reach: 'not_a_setting' },
};

/**
 * Settings the engine changes, not a database function. All hard limits: an
 * account is connected by a person on the provider's own screen, and a key is
 * never in a conversation (invariant 3).
 */
export const ENGINE_SETTINGS: Record<string, FunctionReach> = {
  connect_ai: { reach: 'never', why: 'keys and sign-ins are a person, on the provider' },
  disconnect_ai: { reach: 'never', why: 'keys and sign-ins are a person, on the provider' },
  connect_account: { reach: 'never', why: 'keys and sign-ins are a person, on the provider' },
  disconnect_account: { reach: 'never', why: 'keys and sign-ins are a person, on the provider' },
};

/** The organisation's main agent, the one that changes its settings: Secretaría. */
export function isMainAgent(a: { ghost: string }): boolean {
  return a.ghost === 'secretaria';
}
