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
import { AGENT_GHOSTS, AGENT_LEVELS, type AgentGhost, type AgentLevel, type Department, DEPARTMENTS } from '../models';
import {
  createAgent,
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
  setAiOrder,
} from './index';

/** Who a settings tool acts as and for. */
export interface SettingsContext {
  /** A client signed in as the person: the one who asked (reads) or the owner who approved (changes). */
  client: SupabaseClient;
  orgId: string;
  /** The agent proposing. It never changes its own reach. */
  agentId: string;
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
  /** What the approval card says, in Spanish, with what is now and what it will be. Throws SettingError on bad input. */
  describe?(ctx: SettingsContext, input: Record<string, unknown>): Promise<{ label: string; preview: string }>;
  /** Makes the change, or reads; returns what the model reads back. Throws SettingError for a refusal it should hear. */
  run(ctx: SettingsContext, input: Record<string, unknown>): Promise<string>;
}

/** A refusal the model is told, in words it can pass on. */
export class SettingError extends Error {}

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
      const [agents, connections, members, invitations] = await Promise.all([
        listAgents(ctx.client, ctx.orgId),
        listConnections(ctx.client, ctx.orgId),
        listMembers(ctx.client, ctx.orgId),
        ownerOnly(listPendingInvitations(ctx.client, ctx.orgId)),
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
];

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
  set_ai_order: { reach: 'agent', tool: 'settings_ai_order' },
  rename_ai_connection: { reach: 'agent', tool: 'settings_rename_ai_account' },
  invite_member: { reach: 'agent', tool: 'settings_invite_member' },
  revoke_invitation: { reach: 'agent', tool: 'settings_revoke_invitation' },

  delete_agent: { reach: 'never', why: "it deletes the agent's conversations: the organisation's data" },
  answer_decision: { reach: 'never', why: "a decision is the person's to take" },
  unanswer_decision: { reach: 'never', why: "a decision is the person's to take" },
  accept_invitation: { reach: 'never', why: 'a person joins an organisation themselves' },
  save_profile: { reach: 'never', why: "a person's own profile" },
  create_organization: { reach: 'never', why: 'a new organisation is outside this one' },
  create_personal_space: { reach: 'never', why: 'a new organisation is outside this one' },

  agent_level: { reach: 'not_a_setting' },
  agent_level_for: { reach: 'not_a_setting' },
  ai_usage_daily: { reach: 'not_a_setting' },
  chat_with: { reach: 'not_a_setting' },
  connections_place_last: { reach: 'not_a_setting' },
  hire_secretaria: { reach: 'not_a_setting' },
  invitations_not_personal: { reach: 'not_a_setting' },
  is_member: { reach: 'not_a_setting' },
  is_owner: { reach: 'not_a_setting' },
  list_agent_access: { reach: 'not_a_setting' },
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
  start_thread: { reach: 'not_a_setting' },
  take_refresh_lease: { reach: 'not_a_setting' },
  thread_level: { reach: 'not_a_setting' },
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
