import type { SupabaseClient } from '@supabase/supabase-js';
import { type AiUsageDay, limitsFromRow } from '../aiUsage';
import type { AccountProvider } from '../connectors';
import type { GuideAnswer, GuideCheckOutcome, GuideCheckValues, GuidePhoto, GuideStatus, GuideStep, GuideView, PendingGuide } from '../guides';
import type {
  AccountConnectResult,
  Agent,
  AgentAccess,
  AgentGhost,
  AgentLevel,
  AgentRun,
  AgentRunner,
  AiProvider,
  ClaudeSessionEvent,
  Answer,
  ConnectAiInput,
  Connection,
  ConversationVisibility,
  Decision,
  DecisionAgent,
  DecisionOption,
  DecisionSource,
  Department,
  DevicePlatform,
  MembershipRole,
  MyInvitation,
  MyOrganization,
  NewAgent,
  NewOrganization,
  Organization,
  OrganizationKind,
  PendingInvitation,
  Profile,
} from '../models';
import { ACTION_KIND } from '../models';
import { type ChatMessage, type ChatThread, isDecisionQuotePart, type MessagePart, type OrgMember } from '../chat';
import type { Routine, RoutineAudience, RoutineWhen, Weekday } from '../routines';

// The only place the app talks to the database. Screens, hooks and components
// call these functions, never `supabase.from(...)` (the same rule as
// cultuvilla/app's service layer): one place per table to check, cache or
// migrate. Every read here runs as the signed-in person, so row-level security
// decides what comes back; nothing here filters by organisation for safety,
// only for the screen.

export interface DecisionRow {
  id: string;
  org_id: string;
  record_id: string;
  source_path: string;
  area: string;
  kind: string;
  question: string;
  context: string;
  proposed_by: string;
  created_on: string;
  rule_proposal: string | null;
  recommendation: string | null;
  if_yes: string | null;
  if_no: string | null;
  quote: string | null;
  sources: DecisionSource[] | null;
  due_on: string | null;
  options: DecisionOption[] | null;
  recommended_option: string | null;
  high_stakes: boolean | null;
  agent_id: string | null;
  /** Embedded from agents through agent_id. */
  agent?: DecisionAgent | null;
  answer: Answer | null;
  answer_option: string | null;
  answered_by_name: string | null;
  answered_at: string | null;
  answer_note: string | null;
  answer_text: string | null;
  answer_source: 'record' | 'app' | null;
  written_back_at: string | null;
  closed_at: string | null;
}

export function decisionFromRow(r: DecisionRow): Decision {
  return {
    id: r.id,
    orgId: r.org_id,
    recordId: r.record_id,
    sourcePath: r.source_path,
    area: r.area,
    kind: r.kind,
    question: r.question,
    context: r.context,
    proposedBy: r.proposed_by,
    createdOn: r.created_on,
    ruleProposal: r.rule_proposal,
    recommendation: r.recommendation,
    ifYes: r.if_yes,
    ifNo: r.if_no,
    quote: r.quote,
    sources: r.sources ?? [],
    dueOn: r.due_on,
    options: r.options ?? [],
    recommendedOption: r.recommended_option ?? null,
    highStakes: !!r.high_stakes,
    agent: r.agent ?? null,
    answer:
      r.answer && r.answered_at
        ? {
            answer: r.answer,
            byName: r.answered_by_name ?? '',
            at: r.answered_at,
            note: r.answer_note,
            signedText: r.answer_text,
            source: r.answer_source ?? 'record',
            option: r.answer_option ?? null,
            writtenBackAt: r.written_back_at,
          }
        : null,
    closedAt: r.closed_at,
  };
}

const DECISION_COLUMNS =
  'id, org_id, record_id, source_path, area, kind, question, context, proposed_by, created_on, rule_proposal, recommendation, if_yes, if_no, quote, sources, due_on, options, recommended_option, high_stakes, agent_id, agent:agents(id, name, ghost), answer, answer_option, answered_by_name, answered_at, answer_note, answer_text, answer_source, written_back_at, closed_at';

interface MembershipWithOrg {
  role: MembershipRole;
  display_name: string;
  organizations: { id: string; slug: string; name: string; kind: OrganizationKind } | null;
}

/** Your spaces as the switcher lists them: your personal space first, then by name. */
export function sortSpaces(list: MyOrganization[]): MyOrganization[] {
  return [...list].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'es') : a.kind === 'personal' ? -1 : 1));
}

/** The organisations the signed-in person belongs to: personal first, then by name. */
export async function listMyOrganizations(client: SupabaseClient, userId: string): Promise<MyOrganization[]> {
  const { data, error } = await client
    .from('memberships')
    .select('role, display_name, organizations ( id, slug, name, kind )')
    .eq('user_id', userId)
    .returns<MembershipWithOrg[]>();
  if (error) throw error;
  const spaces = (data ?? []).flatMap((m) =>
    m.organizations ? [{ ...m.organizations, role: m.role, displayName: m.display_name }] : [],
  );
  return sortSpaces(spaces);
}

/** The organisation's open decisions: unanswered first, then newest first. */
export async function listOpenDecisions(client: SupabaseClient, orgId: string): Promise<Decision[]> {
  const { data, error } = await client
    .from('decisions')
    .select(DECISION_COLUMNS)
    .eq('org_id', orgId)
    .is('closed_at', null)
    .order('created_on', { ascending: false })
    .returns<DecisionRow[]>();
  if (error) throw error;
  return sortInbox((data ?? []).map(decisionFromRow));
}

/** What the organisation has answered, newest answer first: the app's Registro. */
export async function listDecidedDecisions(client: SupabaseClient, orgId: string, limit = 100): Promise<Decision[]> {
  const { data, error } = await client
    .from('decisions')
    .select(DECISION_COLUMNS)
    .eq('org_id', orgId)
    .not('answer', 'is', null)
    .order('answered_at', { ascending: false })
    .limit(limit)
    .returns<DecisionRow[]>();
  if (error) throw error;
  return (data ?? []).map(decisionFromRow);
}

/** How many decisions wait for a person in each of these organisations (none listed: 0). */
export async function countWaiting(client: SupabaseClient, orgIds: string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = Object.fromEntries(orgIds.map((id) => [id, 0]));
  if (orgIds.length === 0) return counts;
  const { data, error } = await client
    .from('decisions')
    .select('org_id')
    .in('org_id', orgIds)
    .is('answer', null)
    .is('closed_at', null)
    .returns<{ org_id: string }[]>();
  if (error) throw error;
  for (const r of data ?? []) counts[r.org_id] = (counts[r.org_id] ?? 0) + 1;
  return counts;
}

/** Waiting first; among those, the nearest deadline first, then the newest. */
export function sortInbox(ds: Decision[]): Decision[] {
  return [...ds].sort((a, b) => {
    if (!a.answer !== !b.answer) return a.answer ? 1 : -1;
    if (!a.answer && a.dueOn !== b.dueOn) {
      if (!a.dueOn) return 1;
      if (!b.dueOn) return -1;
      return a.dueOn.localeCompare(b.dueOn);
    }
    return b.createdOn.localeCompare(a.createdOn);
  });
}

export async function getDecision(client: SupabaseClient, id: string): Promise<Decision | null> {
  const { data, error } = await client.from('decisions').select(DECISION_COLUMNS).eq('id', id).maybeSingle<DecisionRow>();
  if (error) throw error;
  return data ? decisionFromRow(data) : null;
}

export interface AnswerInput {
  decisionId: string;
  /** For a decision with options, leave it to `option`: the database works out ok (the pick) or no. */
  answer?: Answer;
  /** The id of the option chosen, for a decision with options. */
  option?: string;
  note?: string;
  /** Only for a rule answered OK. */
  signedText?: string;
}

/** OK or no, or one of the options. The database checks membership and signs with the person's display name. */
export async function answerDecision(client: SupabaseClient, input: AnswerInput): Promise<Decision> {
  const { data, error } = await client
    .rpc('answer_decision', {
      decision_id: input.decisionId,
      answer: input.answer,
      note: input.note?.trim() || null,
      signed_text: input.signedText?.trim() || null,
      ...(input.option ? { option_id: input.option } : {}),
    })
    .select(DECISION_COLUMNS)
    .single<DecisionRow>();
  if (error) throw error;
  return decisionFromRow(data);
}

/** Takes back an answer given in the app, while the agent does not have it yet. */
export async function unanswerDecision(client: SupabaseClient, decisionId: string): Promise<Decision> {
  const { data, error } = await client.rpc('unanswer_decision', { decision_id: decisionId }).select(DECISION_COLUMNS).single<DecisionRow>();
  if (error) throw error;
  return decisionFromRow(data);
}

/** «Más tarde»: puts a decision aside for the signed-in person until `until`. */
export async function snoozeDecision(client: SupabaseClient, decisionId: string, until: Date): Promise<void> {
  const { error } = await client.rpc('snooze_decision', { target_decision: decisionId, until: until.toISOString() });
  if (error) throw error;
}

/** Brings back a decision the person put aside. */
export async function unsnoozeDecision(client: SupabaseClient, decisionId: string): Promise<void> {
  const { error } = await client.rpc('unsnooze_decision', { target_decision: decisionId });
  if (error) throw error;
}

/** The decisions the person has put aside in this organisation and until when, by id: only those still aside. */
export async function listMySnoozes(client: SupabaseClient, orgId: string, now = new Date()): Promise<Record<string, string>> {
  const { data, error } = await client
    .from('decision_snoozes')
    .select('decision_id, until')
    .eq('org_id', orgId)
    .gt('until', now.toISOString())
    .returns<{ decision_id: string; until: string }[]>();
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.decision_id, r.until]));
}

// The OK cards in Decisiones (supabase/migrations/20261126630000_action_cards.sql):
// the actions waiting for this person's approval, as cards beside the decisions.

export interface PendingActionRow {
  id: string;
  thread_id: string;
  agent_id: string | null;
  agent_name: string | null;
  agent_ghost: string | null;
  label: string;
  preview: string;
  created_at: string;
}

/** An action waiting for an OK, as a card of the deck: «Aprobar» or «No». Pure. */
export function actionCardFromRow(r: PendingActionRow, orgId: string): Decision {
  return {
    id: r.id,
    orgId,
    recordId: '',
    sourcePath: '',
    area: '',
    kind: ACTION_KIND,
    question: r.label,
    context: r.preview,
    proposedBy: r.agent_name ?? 'agente',
    createdOn: r.created_at.slice(0, 10),
    ruleProposal: null,
    recommendation: 'Aprobar',
    ifYes: null,
    ifNo: null,
    quote: null,
    sources: [],
    dueOn: null,
    options: [],
    recommendedOption: null,
    highStakes: false,
    agent: r.agent_id && r.agent_name ? { id: r.agent_id, name: r.agent_name, ghost: r.agent_ghost ?? 'base' } : null,
    answer: null,
    closedAt: null,
    action: { id: r.id, threadId: r.thread_id },
  };
}

/** The actions waiting for the signed-in person's OK in this organisation, newest first. */
export async function listPendingActions(client: SupabaseClient, orgId: string): Promise<Decision[]> {
  const { data, error } = await client.rpc('my_pending_actions', { target_org: orgId });
  if (error) throw error;
  return ((data ?? []) as PendingActionRow[]).map((r) => actionCardFromRow(r, orgId));
}

/** «Más tarde» on an OK card: puts the action aside for the signed-in person until `until`. */
export async function snoozeAction(client: SupabaseClient, actionId: string, until: Date): Promise<void> {
  const { error } = await client.rpc('snooze_action', { target_action: actionId, until: until.toISOString() });
  if (error) throw error;
}

/** Brings back an OK card the person put aside. */
export async function unsnoozeAction(client: SupabaseClient, actionId: string): Promise<void> {
  const { error } = await client.rpc('unsnooze_action', { target_action: actionId });
  if (error) throw error;
}

/** The OK cards the person has put aside in this organisation and until when, by action id. */
export async function listMyActionSnoozes(client: SupabaseClient, orgId: string, now = new Date()): Promise<Record<string, string>> {
  const { data, error } = await client
    .from('action_snoozes')
    .select('action_id, until')
    .eq('org_id', orgId)
    .gt('until', now.toISOString())
    .returns<{ action_id: string; until: string }[]>();
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.action_id, r.until]));
}

/** How many OKs in a row, without a note correcting them, this agent has for this kind of decision. */
export async function okStreak(client: SupabaseClient, d: Pick<Decision, 'orgId' | 'proposedBy' | 'kind'>): Promise<number> {
  const { data, error } = await client
    .from('decisions')
    .select('answer, answer_note')
    .eq('org_id', d.orgId)
    .eq('proposed_by', d.proposedBy)
    .eq('kind', d.kind)
    .not('answer', 'is', null)
    .order('answered_at', { ascending: false })
    .limit(AUTONOMY_STREAK)
    .returns<{ answer: Answer; answer_note: string | null }[]>();
  if (error) throw error;
  return countStreak(data ?? []);
}

/** The streak a kind of decision needs before its agent may propose doing it alone (autonomia-por-tipo.md). */
export const AUTONOMY_STREAK = 10;

export function countStreak(answers: { answer: Answer; answer_note: string | null }[]): number {
  let n = 0;
  for (const a of answers) {
    if (a.answer !== 'ok' || a.answer_note?.trim()) break;
    n++;
  }
  return n;
}

// The way in: profile, then create an organisation or accept an invitation.
// All writes go through security definer functions that check the caller.

interface ProfileRow {
  full_name: string;
  occupation: string | null;
  heard_from: string | null;
}

const profileFromRow = (r: ProfileRow): Profile => ({ fullName: r.full_name, occupation: r.occupation, heardFrom: r.heard_from });

/** The signed-in person's profile, or null before they have said who they are. */
export async function getMyProfile(client: SupabaseClient, userId: string): Promise<Profile | null> {
  const { data, error } = await client
    .from('profiles')
    .select('full_name, occupation, heard_from')
    .eq('user_id', userId)
    .maybeSingle<ProfileRow>();
  if (error) throw error;
  return data ? profileFromRow(data) : null;
}

export async function saveProfile(client: SupabaseClient, p: Profile): Promise<Profile> {
  const { data, error } = await client
    .rpc('save_profile', { full_name: p.fullName, occupation: p.occupation, heard_from: p.heardFrom })
    .single<ProfileRow>();
  if (error) throw error;
  return profileFromRow(data);
}

/** Creates the organisation with the caller as its owner. */
export async function createOrganization(client: SupabaseClient, o: NewOrganization): Promise<Organization> {
  const { data, error } = await client
    .rpc('create_organization', {
      name: o.name,
      website: o.website?.trim() || null,
      about: o.about?.trim() || null,
      links: (o.links ?? []).map((l) => l.trim()).filter(Boolean),
    })
    .single<Organization>();
  if (error) throw error;
  return { id: data.id, slug: data.slug, name: data.name, kind: data.kind };
}

/** Your personal space: created the first time, the same one after that. Secretaría comes hired. */
export async function createPersonalSpace(client: SupabaseClient): Promise<Organization> {
  const { data, error } = await client.rpc('create_personal_space').single<Organization>();
  if (error) throw error;
  return { id: data.id, slug: data.slug, name: data.name, kind: data.kind };
}

interface MyInvitationRow {
  id: string;
  org_id: string;
  org_name: string;
  role: MembershipRole;
  invited_by_name: string;
  created_at: string;
}

/** Open invitations addressed to the signed-in person's email. */
export async function listMyInvitations(client: SupabaseClient): Promise<MyInvitation[]> {
  const { data, error } = await client.rpc('my_invitations');
  if (error) throw error;
  return ((data ?? []) as MyInvitationRow[]).map((r) => ({
    id: r.id,
    orgId: r.org_id,
    orgName: r.org_name,
    role: r.role,
    invitedByName: r.invited_by_name,
    createdAt: r.created_at,
  }));
}

export async function acceptInvitation(client: SupabaseClient, invitationId: string): Promise<Organization> {
  const { data, error } = await client.rpc('accept_invitation', { invitation_id: invitationId }).single<Organization>();
  if (error) throw error;
  return { id: data.id, slug: data.slug, name: data.name, kind: data.kind };
}

interface PendingInvitationRow {
  id: string;
  email: string;
  role: MembershipRole;
  invited_by_name: string;
  created_at: string;
}

/** An organisation's open invitations. Only its owners get rows back. */
export async function listPendingInvitations(client: SupabaseClient, orgId: string): Promise<PendingInvitation[]> {
  const { data, error } = await client
    .from('invitations')
    .select('id, email, role, invited_by_name, created_at')
    .eq('org_id', orgId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
    .returns<PendingInvitationRow[]>();
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    invitedByName: r.invited_by_name,
    createdAt: r.created_at,
  }));
}

/** Invites someone by email; `agentLevels` (agent id → level) applies when they accept. */
export async function inviteMember(
  client: SupabaseClient,
  orgId: string,
  email: string,
  role: MembershipRole = 'member',
  agentLevels: Record<string, AgentLevel> = {},
): Promise<void> {
  const { error } = await client.rpc('invite_member', {
    target_org: orgId,
    invitee_email: email,
    invitee_role: role,
    agent_levels: agentLevels,
  });
  if (error) throw error;
}

export async function revokeInvitation(client: SupabaseClient, invitationId: string): Promise<void> {
  const { error } = await client.rpc('revoke_invitation', { invitation_id: invitationId });
  if (error) throw error;
}

/** `ana.example`, `https://ana.example/` → `https://ana.example/`; empty stays empty. */
export function normalizeLink(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`;
}

/** One link per line, or separated by spaces or commas. */
export function splitLinks(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map(normalizeLink)
    .filter(Boolean);
}

// Connections. Reads come from the database like everything else; connecting
// and disconnecting go to the engine (apps/engine), because a key must reach
// the vault without ever touching the database or coming back to the app.

interface ConnectionRow {
  id: string;
  org_id: string;
  kind: Connection['kind'];
  provider: Connection['provider'];
  method: Connection['method'];
  hint: string;
  settings: Connection['settings'] | null;
  status: Connection['status'];
  status_reason?: Connection['statusReason'];
  checked_at: string;
  connected_by_name: string;
  updated_at: string;
  position?: number | null;
  label?: string | null;
  limits?: unknown;
  last_used_at?: string | null;
  agent_id?: string | null;
}

export function connectionFromRow(r: ConnectionRow): Connection {
  return {
    id: r.id,
    orgId: r.org_id,
    kind: r.kind,
    provider: r.provider,
    method: r.method,
    hint: r.hint,
    settings: r.settings ?? {},
    status: r.status,
    statusReason: r.status_reason ?? null,
    checkedAt: r.checked_at,
    connectedByName: r.connected_by_name,
    updatedAt: r.updated_at,
    position: r.position ?? 0,
    label: r.label ?? null,
    limits: limitsFromRow(r.limits),
    lastUsedAt: r.last_used_at ?? null,
    agentId: r.agent_id ?? null,
  };
}

export const CONNECTION_COLUMNS =
  'id, org_id, kind, provider, method, hint, settings, status, status_reason, checked_at, connected_by_name, updated_at, position, label, limits, last_used_at, agent_id';

/** The organisation's connections. Every member sees them; only owners change them. */
export async function listConnections(client: SupabaseClient, orgId: string): Promise<Connection[]> {
  const { data, error } = await client
    .from('connections')
    .select(CONNECTION_COLUMNS)
    .eq('org_id', orgId)
    .order('position')
    .order('created_at')
    .returns<ConnectionRow[]>();
  if (error) throw error;
  return (data ?? []).map(connectionFromRow);
}

/** The organisation's AI accounts in the order the engine tries them. Owners only (`set_ai_order` checks). */
export async function setAiOrder(client: SupabaseClient, orgId: string, ordered: readonly string[]): Promise<void> {
  const { error } = await client.rpc('set_ai_order', { target_org: orgId, ordered });
  if (error) throw error;
}

/** Names an AI account; an empty name goes back to the provider's. Owners only. */
export async function renameAiConnection(client: SupabaseClient, connectionId: string, label: string): Promise<void> {
  const { error } = await client.rpc('rename_ai_connection', { target: connectionId, new_label: label });
  if (error) throw error;
}

interface AiUsageDayRow {
  connection_id: string;
  agent_id: string | null;
  day: string;
  uses: number | string;
  failures: number | string;
  input_tokens: number | string;
  output_tokens: number | string;
  cache_read_tokens: number | string;
  cache_write_tokens: number | string;
  cost_usd: number | string | null;
  last_at: string;
}

/** What each AI account did in the last `days` days (Madrid), per agent and day. Members read their own organisation's. */
export async function listAiUsage(client: SupabaseClient, orgId: string, days = 30, now: Date = new Date()): Promise<AiUsageDay[]> {
  const since = new Date(now.getTime() - (days - 1) * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  const { data, error } = await client.rpc('ai_usage_daily', { target_org: orgId, since });
  if (error) throw error;
  const n = (v: number | string | null) => (v === null ? 0 : Number(v));
  return ((data ?? []) as AiUsageDayRow[]).map((r) => ({
    connectionId: r.connection_id,
    agentId: r.agent_id,
    day: r.day,
    uses: n(r.uses),
    failures: n(r.failures),
    tokens: { input: n(r.input_tokens), output: n(r.output_tokens), cacheRead: n(r.cache_read_tokens), cacheWrite: n(r.cache_write_tokens) },
    costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
    lastAt: r.last_at,
  }));
}

/** How to reach the engine as the signed-in person. */
export interface EngineAccess {
  url: string;
  /** The person's Supabase access token. */
  token: string;
}

/** The engine's refusal, with a code the screen can turn into Spanish. */
export class EngineError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

async function callEngine<T>(engine: EngineAccess, method: string, path: string, body?: unknown): Promise<T> {
  return sendToEngine(engine, method, path, body ? { type: 'application/json', data: JSON.stringify(body) } : undefined);
}

/** A call to the engine with a body already encoded (JSON, or raw bytes such as a voice note). */
async function sendToEngine<T>(engine: EngineAccess, method: string, path: string, body?: { type: string; data: BodyInit }): Promise<T> {
  if (!engine.url) throw new EngineError('not_configured', 0, 'engine URL not configured');
  let res: Response;
  try {
    res = await fetch(`${engine.url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${engine.token}`, ...(body ? { 'Content-Type': body.type } : {}) },
      body: body?.data,
    });
  } catch (e) {
    throw new EngineError('unreachable', 0, e instanceof Error ? e.message : String(e));
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; message?: string } & T;
  if (!res.ok) throw new EngineError(json.error ?? 'failed', res.status, json.message ?? `engine answered ${res.status}`);
  return json;
}

/** Checks the key or project with the provider, stores it in the vault and returns the connection. */
export async function connectAi(engine: EngineAccess, input: ConnectAiInput): Promise<Connection> {
  const { connection } = await callEngine<{ connection: ConnectionRow }>(engine, 'POST', '/connections/ai', input);
  return connectionFromRow(connection);
}

/** Removes one AI account and deletes its key or token from the vault. */
export async function disconnectAi(engine: EngineAccess, orgId: string, connectionId: string): Promise<void> {
  await callEngine(engine, 'DELETE', `/connections/ai/${encodeURIComponent(connectionId)}?org=${encodeURIComponent(orgId)}`);
}

/** A Claude subscription being connected: the code goes in, or the person gives up. */
export interface ClaudeSignIn {
  /** The code Anthropic showed after signing in. `engine`: fresh access, if the token may have changed. */
  sendCode(code: string, engine?: EngineAccess): void;
  /** Back in the app while it waits for the code: picks the sign-in up again on a new socket. */
  reconnect(engine?: EngineAccess): void;
  cancel(): void;
}

/**
 * Connects the organisation's Claude subscription through Claude Code's own
 * sign-in, which the engine runs (apps/engine/src/claudeSession.ts). The
 * person's token goes in a socket's first message, never in the URL. `onEvent`
 * hears the sign-in link, that the code is being checked, then the connection
 * or a refusal code; after either it is over.
 *
 * The person leaves the app to sign in at Anthropic, and the phone may drop the
 * socket meanwhile. While it waits for the code that is not an error: the code
 * (or `reconnect`, when the app comes back) opens a new socket that resumes the
 * sign-in by the id the engine gave with the link.
 */
export function connectClaudeSubscription(
  engine: EngineAccess,
  orgId: string,
  onEvent: (e: ClaudeSessionEvent) => void,
  opts: { WebSocket?: typeof WebSocket } = {},
): ClaudeSignIn {
  let over = false;
  let access = engine;
  let ws: WebSocket | null = null;
  /** The socket the engine is listening on: after the link, or after `resumed`. */
  let attached = false;
  let id: string | null = null;
  let awaitingCode = false;
  let pendingCode: string | null = null;
  const end = (e: ClaudeSessionEvent) => {
    if (over) return;
    over = true;
    const last = ws;
    ws = null;
    last?.close();
    onEvent(e);
  };
  if (!engine.url) {
    queueMicrotask(() => end({ type: 'error', code: 'not_configured' }));
    return { sendCode() {}, reconnect() {}, cancel() {} };
  }
  const Socket = opts.WebSocket ?? WebSocket;
  const url = `${engine.url.replace(/\/$/, '').replace(/^http/, 'ws')}/connections/ai/claude/session`;

  const sendCodeNow = (socket: WebSocket, code: string) => socket.send(JSON.stringify({ type: 'code', code: code.trim() }));

  const open = (first: () => Record<string, unknown>) => {
    const me = new Socket(url);
    ws = me;
    attached = false;
    me.onopen = () => me.send(JSON.stringify(first()));
    me.onmessage = (m) => {
      if (me !== ws) return;
      let e: { type?: string; url?: string; id?: string; code?: string; connection?: ConnectionRow };
      try {
        e = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (e.type === 'url' && typeof e.url === 'string') {
        id = typeof e.id === 'string' ? e.id : null;
        awaitingCode = true;
        attached = true;
        onEvent({ type: 'url', url: e.url });
      } else if (e.type === 'resumed') {
        attached = true;
        if (pendingCode !== null) {
          sendCodeNow(me, pendingCode);
          pendingCode = null;
        }
      } else if (e.type === 'working') {
        awaitingCode = false;
        onEvent({ type: 'working' });
      } else if (e.type === 'done' && e.connection) end({ type: 'done', connection: connectionFromRow(e.connection) });
      else if (e.type === 'error') end({ type: 'error', code: typeof e.code === 'string' ? e.code : 'failed' });
    };
    const dropped = () => {
      if (me !== ws) return;
      ws = null;
      attached = false;
      // Waiting for the code with nothing to send: quietly; the next code or return to the app resumes.
      if (awaitingCode && id && pendingCode === null) return;
      end({ type: 'error', code: 'unreachable' });
    };
    me.onerror = dropped;
    me.onclose = dropped;
  };

  const resume = () => {
    const resumeId = id;
    open(() => ({ type: 'resume', token: access.token, orgId, id: resumeId }));
  };

  open(() => ({ type: 'start', token: access.token, orgId }));

  return {
    sendCode(code, fresh) {
      if (over) return;
      if (fresh) access = fresh;
      if (ws && attached && ws.readyState === Socket.OPEN) return sendCodeNow(ws, code);
      pendingCode = code;
      if (ws && ws.readyState !== Socket.OPEN && ws.readyState !== Socket.CONNECTING) {
        const dead = ws;
        ws = null;
        dead.close();
      }
      if (!ws && awaitingCode && id) resume();
    },
    reconnect(fresh) {
      if (over || !awaitingCode || !id) return;
      if (fresh) access = fresh;
      if (ws && (ws.readyState === Socket.OPEN || ws.readyState === Socket.CONNECTING)) return;
      ws = null;
      resume();
    },
    cancel() {
      over = true;
      const last = ws;
      ws = null;
      last?.close();
    },
  };
}

/**
 * Starts connecting an outside account by signing in there. Returns the
 * provider's sign-in page. The engine sends the person back to `returnTo` with
 * `?connected=<provider>&state=…&code=…`, which `finishAccountConnect` turns
 * into the connection; or with `&result=<AccountConnectResult>` when it ended
 * there (they said no).
 */
export async function startAccountConnect(
  engine: EngineAccess,
  input: { orgId: string; provider: AccountProvider; returnTo: string },
): Promise<{ url: string }> {
  return callEngine(engine, 'POST', `/connections/accounts/${input.provider}/start`, { orgId: input.orgId, returnTo: input.returnTo });
}

/**
 * Finishes a connect as the person who started it: the engine refuses anyone
 * else, so a stranger lured into signing in gives nothing away.
 */
export async function finishAccountConnect(
  engine: EngineAccess,
  input: { provider: AccountProvider; state: string; code: string },
): Promise<AccountConnectResult> {
  const { result } = await callEngine<{ result: AccountConnectResult }>(engine, 'POST', `/connections/accounts/${input.provider}/finish`, {
    state: input.state,
    code: input.code,
  });
  return result;
}

/** Removes the account connection, revokes our access with the provider and deletes the token. */
export async function disconnectAccount(engine: EngineAccess, orgId: string, provider: AccountProvider): Promise<void> {
  await callEngine(engine, 'DELETE', `/connections/accounts/${provider}?org=${encodeURIComponent(orgId)}`);
}

/**
 * An owner's answer to an action an agent proposed (a card in its message):
 * approving runs it with the organisation's connected account; the card then
 * shows how it went. Anyone but an owner is refused. `edits`, on approving:
 * the person's changes to its editable text, by field («Editar»).
 */
export async function decideAction(
  engine: EngineAccess,
  actionId: string,
  decision: 'approve' | 'reject',
  edits?: Record<string, string>,
): Promise<{ status: string; result?: string }> {
  const body = decision === 'approve' && edits && Object.keys(edits).length ? { edits } : undefined;
  return callEngine(engine, 'POST', `/actions/${encodeURIComponent(actionId)}/${decision}`, body);
}

/**
 * Lets the agent go on once the account it asked for is there (docs/plans/
 * ongoing/connector-in-chat.md). The engine checks it really is, and goes on
 * once whoever asks; a second call is refused with `already_done`.
 */
export async function resumeAfterAccount(engine: EngineAccess, threadId: string, askId: string): Promise<{ resumed: boolean }> {
  return callEngine(engine, 'POST', `/threads/${encodeURIComponent(threadId)}/resume`, { askId });
}

// Guides (docs/plans/ongoing/guided-access.md): the guide's screen reads one, asks
// for each step and checks what the person typed; an owner decides a member's grant.

/** The guide as its screen reads it, with the step it stopped at. */
export async function getGuide(engine: EngineAccess, guideId: string): Promise<GuideView> {
  return callEngine(engine, 'GET', `/guides/${encodeURIComponent(guideId)}`);
}

/**
 * The next step, written by the guide's model: after an answer, a photo of the
 * person's screen, or nothing (the first step, and the closing one after a
 * passed check). Never a secret: those travel only in `checkGuide`.
 */
export async function guideStep(
  engine: EngineAccess,
  guideId: string,
  input: { answer?: GuideAnswer; photo?: GuidePhoto } = {},
): Promise<{ step: GuideStep; status: GuideStatus }> {
  const body: { answer?: GuideAnswer; photo?: GuidePhoto } = {};
  if (input.answer) body.answer = input.answer;
  if (input.photo) body.photo = input.photo;
  return callEngine(engine, 'POST', `/guides/${encodeURIComponent(guideId)}/step`, body);
}

/** Ghostaff tries the access with what the person typed; once it works, the secret is in the vault. */
export async function checkGuide(engine: EngineAccess, guideId: string, values: GuideCheckValues): Promise<GuideCheckOutcome> {
  return callEngine(engine, 'POST', `/guides/${encodeURIComponent(guideId)}/check`, { values });
}

/**
 * An owner lets the agent use what a member granted. Answers once the agent has
 * gone on in the guide's conversation; `resumed` is false when it couldn't yet
 * (the chat lets it go on when it next sees the guide done).
 */
export async function approveGuide(engine: EngineAccess, guideId: string): Promise<{ status: 'done'; resumed: boolean }> {
  return callEngine(engine, 'POST', `/guides/${encodeURIComponent(guideId)}/approve`);
}

/** The organisation's member guides waiting for an owner's approval, oldest first. Owners only. */
export async function pendingGuides(engine: EngineAccess, orgId: string): Promise<PendingGuide[]> {
  const out = await callEngine<{ guides: PendingGuide[] }>(engine, 'GET', `/orgs/${encodeURIComponent(orgId)}/guides/pending`);
  return out.guides;
}

/** An owner turns down what a member granted; the secret leaves the vault. */
export async function rejectGuide(engine: EngineAccess, guideId: string): Promise<{ status: 'rejected' }> {
  return callEngine(engine, 'POST', `/guides/${encodeURIComponent(guideId)}/reject`);
}

/** What an owner reads before removing an agent's access: how to remove its user in the app's own tool. `undo` is null when the guide never wrote it. */
export async function getGuidedAccessUndo(engine: EngineAccess, accessId: string): Promise<{ app: string; undo: string | null }> {
  return callEngine(engine, 'GET', `/connections/guided/${encodeURIComponent(accessId)}`);
}

/** An owner removes an agent's access: the credential leaves the vault and the connection goes. */
export async function removeGuidedAccess(engine: EngineAccess, accessId: string): Promise<void> {
  await callEngine(engine, 'DELETE', `/connections/guided/${encodeURIComponent(accessId)}`);
}

/** Lets the agent go on once its guide is done; once, whoever asks (`already_done` after). */
export async function resumeAfterGuide(engine: EngineAccess, threadId: string, guideId: string): Promise<{ resumed: boolean }> {
  return callEngine(engine, 'POST', `/threads/${encodeURIComponent(threadId)}/resume`, { guideId });
}

/**
 * A voice note to an agent (docs/plans/ongoing/voice.md): the engine stores the
 * audio, writes it in the person's own chat with the agent (opening the chat if
 * needed) and returns the message, still to be transcribed.
 */
export async function sendVoiceNote(
  engine: EngineAccess,
  agentId: string,
  note: { audio: Blob; mimeType: string; durationMs: number | null },
): Promise<ChatMessage> {
  const duration = note.durationMs === null ? '' : `?durationMs=${Math.round(note.durationMs)}`;
  const { message } = await sendToEngine<{ message: ChatMessage }>(engine, 'POST', `/agents/${encodeURIComponent(agentId)}/voice-notes${duration}`, {
    type: note.mimeType,
    data: note.audio,
  });
  return message;
}

/**
 * Transcribes a voice note the person sent, then lets the agent answer. Answers
 * once both are done; the transcript and the reply arrive in the chat live.
 * Also the retry after a failed transcription.
 */
export async function transcribeVoiceNote(engine: EngineAccess, messageId: string): Promise<void> {
  await callEngine(engine, 'POST', `/voice-notes/${encodeURIComponent(messageId)}/transcribe`);
}

/** A short-lived link to play a voice note; the bucket's policy lets through only people who may read its thread. */
export async function voiceNoteUrl(client: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await client.storage.from('voice-notes').createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * The organisation's own Google Cloud account, which a customer grants roles
 * to on their project; the engine creates it the first time. Owners only.
 */
export async function getCloudAccount(engine: EngineAccess, orgId: string): Promise<{ email: string }> {
  return callEngine(engine, 'POST', '/cloud-account', { orgId });
}

// Agents. Members read the agents they may see (not those set to «none» for
// them); only owners add or remove agents, through create_agent and delete_agent.

interface AgentRow {
  id: string;
  org_id: string;
  name: string;
  ghost: AgentGhost;
  is_main?: boolean;
  department: Department;
  member_default: AgentLevel;
  chat_default?: ConversationVisibility;
  runner: AgentRunner;
  description: string | null;
  schedule: string | null;
  accounts: string[] | null;
  created_at: string;
}

export function agentFromRow(r: AgentRow): Agent {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    ghost: r.ghost,
    isMain: r.is_main ?? false,
    department: r.department,
    memberDefault: r.member_default,
    chatDefault: r.chat_default ?? 'private',
    runner: r.runner ?? 'chat',
    description: r.description ?? null,
    schedule: r.schedule ?? null,
    accounts: r.accounts ?? null,
    createdAt: r.created_at,
  };
}

const AGENT_COLUMNS = 'id, org_id, name, ghost, is_main, department, member_default, chat_default, runner, description, schedule, accounts, created_at';

/** The organisation's agents, oldest first. */
export async function listAgents(client: SupabaseClient, orgId: string): Promise<Agent[]> {
  const { data, error } = await client
    .from('agents')
    .select(AGENT_COLUMNS)
    .eq('org_id', orgId)
    .order('created_at')
    .returns<AgentRow[]>();
  if (error) throw error;
  return (data ?? []).map(agentFromRow);
}

export async function getAgent(client: SupabaseClient, id: string): Promise<Agent | null> {
  const { data, error } = await client.from('agents').select(AGENT_COLUMNS).eq('id', id).maybeSingle<AgentRow>();
  if (error) throw error;
  return data ? agentFromRow(data) : null;
}

/** Adds an agent to the organisation's team. Owners only. */
export async function createAgent(client: SupabaseClient, a: NewAgent): Promise<Agent> {
  const { data, error } = await client
    .rpc('create_agent', { target_org: a.orgId, name: a.name.trim(), ghost: a.ghost, department: a.department })
    .single<AgentRow>();
  if (error) throw error;
  return agentFromRow(data);
}

/** Whether an agent has ever had a thread you can see: Secretaría's first hello happens only once (welcome-and-spaces.md). */
export async function agentHasThreads(client: SupabaseClient, agentId: string): Promise<boolean> {
  const { data, error } = await client.from('threads').select('id').eq('agent_id', agentId).limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/** Removes an agent from its team. Owners only. */
export async function deleteAgent(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc('delete_agent', { agent_id: id });
  if (error) throw error;
}

/** Which connected accounts the agent may use: the providers, or null for every one. Owners only. */
export async function setAgentAccounts(client: SupabaseClient, agentId: string, providers: readonly string[] | null): Promise<void> {
  const { error } = await client.rpc('set_agent_accounts', { target_agent: agentId, providers });
  if (error) throw error;
}

// Who may use each agent: owners set it per agent and member (set_agent_access);
// everyone reads their own levels.

interface AgentAccessRow {
  user_id: string;
  display_name: string;
  role: MembershipRole;
  level: AgentLevel;
  is_default: boolean;
}

/** Every member's level on this agent, owners first. Owners only. */
export async function listAgentAccess(client: SupabaseClient, agentId: string): Promise<AgentAccess[]> {
  const { data, error } = await client.rpc('list_agent_access', { target_agent: agentId });
  if (error) throw error;
  return ((data ?? []) as AgentAccessRow[]).map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    role: r.role,
    level: r.level,
    isDefault: r.is_default,
  }));
}

/** Sets one member's level on one agent. Owners only; an owner's own level never changes. */
export async function setAgentAccess(client: SupabaseClient, agentId: string, userId: string, level: AgentLevel): Promise<void> {
  const { error } = await client.rpc('set_agent_access', { target_agent: agentId, member: userId, new_level: level });
  if (error) throw error;
}

/** The signed-in person's level on each agent of the organisation they may see, by agent id. */
export async function myAgentLevels(client: SupabaseClient, orgId: string): Promise<Record<string, AgentLevel>> {
  const { data, error } = await client.rpc('my_agent_levels', { target_org: orgId });
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as { agent_id: string; level: AgentLevel }[]).map((r) => [r.agent_id, r.level]));
}

// The team chat (docs/plans/ongoing/team-chat.md). What a person sees follows
// their level on each agent and who each conversation is for (chat-permissions.md);
// they write only through start_thread, chat_with and post_message, and new
// messages arrive through Realtime under the same rules.

/** The organisation's members, by name: for «pide acceso a …» and @mentions. */
export async function listMembers(client: SupabaseClient, orgId: string): Promise<OrgMember[]> {
  const { data, error } = await client
    .from('memberships')
    .select('user_id, display_name, role')
    .eq('org_id', orgId)
    .order('display_name')
    .returns<{ user_id: string; display_name: string; role: MembershipRole }[]>();
  if (error) throw error;
  return (data ?? []).map((m) => ({ userId: m.user_id, displayName: m.display_name, role: m.role }));
}

interface ThreadListRow {
  id: string;
  agent_id: string;
  title: string;
  created_at: string;
  last_message_at: string;
  last_author: string | null;
  last_text: string | null;
  unread: boolean;
  personal: boolean;
  visibility: ConversationVisibility;
  mine: boolean;
  following: boolean;
}

/** Threads the person may see, newest first; with `agentId`, only that agent's. */
export async function listThreads(client: SupabaseClient, orgId: string, agentId?: string): Promise<ChatThread[]> {
  const { data, error } = await client.rpc('my_threads', { target_org: orgId, target_agent: agentId ?? null });
  if (error) throw error;
  return ((data ?? []) as ThreadListRow[]).map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    title: r.title,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at,
    lastAuthor: r.last_author,
    lastText: r.last_text,
    unread: r.unread,
    personal: r.personal,
    visibility: r.visibility,
    mine: r.mine,
    following: r.following,
  }));
}

export interface ThreadHead {
  id: string;
  orgId: string;
  agentId: string;
  title: string;
  visibility: ConversationVisibility;
  /** Who opened it: they alone change who sees it. Null when an agent opened it. */
  createdBy: string | null;
  /** A person's chat with the agent, always private. */
  personal: boolean;
}

interface ThreadHeadRow {
  id: string;
  org_id: string;
  agent_id: string;
  title: string;
  visibility: ConversationVisibility;
  created_by: string | null;
  personal_of: string | null;
}

const threadHead = (r: ThreadHeadRow): ThreadHead => ({
  id: r.id,
  orgId: r.org_id,
  agentId: r.agent_id,
  title: r.title,
  visibility: r.visibility,
  createdBy: r.created_by,
  personal: r.personal_of !== null,
});

const THREAD_HEAD_COLUMNS = 'id, org_id, agent_id, title, visibility, created_by, personal_of';

export async function getThread(client: SupabaseClient, id: string): Promise<ThreadHead | null> {
  const { data, error } = await client.from('threads').select(THREAD_HEAD_COLUMNS).eq('id', id).maybeSingle<ThreadHeadRow>();
  if (error) throw error;
  return data ? threadHead(data) : null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  author_kind: 'person' | 'agent';
  author_user: string | null;
  author_agent: string | null;
  author_name: string;
  parts: MessagePart[];
  state?: 'working' | 'done' | 'failed';
  steps?: string[];
  routine_id?: string | null;
  created_at: string;
}

export function messageFromRow(r: MessageRow): ChatMessage {
  return {
    id: r.id,
    threadId: r.thread_id,
    authorKind: r.author_kind,
    authorUserId: r.author_user,
    authorAgentId: r.author_agent,
    authorName: r.author_name,
    parts: Array.isArray(r.parts) ? r.parts : [],
    state: r.state ?? 'done',
    steps: Array.isArray(r.steps) ? r.steps : [],
    routineId: r.routine_id ?? null,
    createdAt: r.created_at,
  };
}

const MESSAGE_COLUMNS = 'id, thread_id, author_kind, author_user, author_agent, author_name, parts, state, steps, routine_id, created_at';

/** A thread's latest messages, oldest first. */
export async function listMessages(client: SupabaseClient, threadId: string, limit = 300): Promise<ChatMessage[]> {
  const { data, error } = await client
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(limit)
    .returns<MessageRow[]>();
  if (error) throw error;
  return (data ?? []).map(messageFromRow).reverse();
}

/**
 * Opens a titled conversation with an agent the person may talk to, with their
 * first message; without a visibility it takes the agent's default. Returns its id.
 */
export async function startThread(client: SupabaseClient, agentId: string, body: string, visibility?: ConversationVisibility): Promise<string> {
  const { data, error } = await client
    .rpc('start_thread', { target_agent: agentId, body, ...(visibility ? { visibility } : {}) })
    .single<{ id: string }>();
  if (error) throw error;
  return data.id;
}

/** Thrown when a conversation others wrote in would be made private again: it can only be closed to reading. */
export class OthersHaveWrittenError extends Error {}

/** Its opener changes who reads or writes a conversation (chat-permissions.md). */
export async function setConversationVisibility(client: SupabaseClient, threadId: string, visibility: ConversationVisibility): Promise<ThreadHead> {
  const { data, error } = await client
    .rpc('set_conversation_visibility', { target_thread: threadId, new_visibility: visibility })
    .select(THREAD_HEAD_COLUMNS)
    .single<ThreadHeadRow>();
  if (error) throw error.code === '55000' ? new OthersHaveWrittenError(error.message) : error;
  return threadHead(data);
}

/** How many people read a conversation, its opener included. */
export async function conversationReaders(client: SupabaseClient, threadId: string): Promise<number> {
  const { data, error } = await client.rpc('conversation_readers', { target_thread: threadId });
  if (error) throw error;
  return data as number;
}

/** An owner sets who reads new conversations with an agent unless their opener says otherwise. */
export async function setAgentChatDefault(client: SupabaseClient, agentId: string, visibility: ConversationVisibility): Promise<void> {
  const { error } = await client.rpc('set_agent_chat_default', { target_agent: agentId, new_default: visibility });
  if (error) throw error;
}

/** Writes to an agent in the person's own chat with it, opening the chat with the first message. */
export async function chatWith(client: SupabaseClient, agentId: string, body: string): Promise<ChatMessage> {
  const { data, error } = await client.rpc('chat_with', { target_agent: agentId, body }).single<MessageRow>();
  if (error) throw error;
  return messageFromRow(data);
}

/** «Preguntar» on a decision: writes to the agent that asked, in your chat with it, with the decision quoted. */
export async function askAboutDecision(client: SupabaseClient, decisionId: string, body: string): Promise<ChatMessage> {
  const { data, error } = await client.rpc('ask_about_decision', { target_decision: decisionId, body }).single<MessageRow>();
  if (error) throw error;
  return messageFromRow(data);
}

/** The decisions of the organisation the signed-in person has asked an agent about: «Preguntaste» in the deck. */
export async function listAskedDecisions(client: SupabaseClient, orgId: string, userId: string): Promise<Set<string>> {
  const { data, error } = await client
    .from('messages')
    .select('parts')
    .eq('org_id', orgId)
    .eq('author_user', userId)
    .contains('parts', [{ type: 'decision_quote' }])
    .order('created_at', { ascending: false })
    .limit(200)
    .returns<{ parts: MessagePart[] }[]>();
  if (error) throw error;
  const ids = new Set<string>();
  for (const m of data ?? []) for (const p of m.parts) if (isDecisionQuotePart(p)) ids.add(p.decisionId);
  return ids;
}

export async function postMessage(client: SupabaseClient, threadId: string, body: string): Promise<ChatMessage> {
  const { data, error } = await client.rpc('post_message', { target_thread: threadId, body }).single<MessageRow>();
  if (error) throw error;
  return messageFromRow(data);
}

export async function markThreadRead(client: SupabaseClient, threadId: string): Promise<void> {
  const { error } = await client.rpc('mark_thread_read', { target_thread: threadId });
  if (error) throw error;
}

/**
 * Calls `onMessage` for each new or changed message in the thread, live (an
 * agent's reply changes as it is written); returns how to stop. `onLive` runs
 * each time the subscription (re)starts delivering: whatever changed before
 * that was missed, so the caller reloads then.
 */
export function subscribeToThread(
  client: SupabaseClient,
  threadId: string,
  onMessage: (m: ChatMessage) => void,
  onLive?: () => void,
): () => void {
  const channel = client
    .channel(`thread:${threadId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages', filter: `thread_id=eq.${threadId}` },
      (payload) => {
        if (payload.eventType !== 'DELETE') onMessage(messageFromRow(payload.new as MessageRow));
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') onLive?.();
    });
  return () => {
    void client.removeChannel(channel);
  };
}

/** Asks the thread's agent to answer its last message; resolves when it has. */
export async function askAgent(engine: EngineAccess, threadId: string): Promise<{ replied: boolean }> {
  return callEngine(engine, 'POST', `/threads/${threadId}/reply`);
}

/** A newly added agent introduces itself in a thread of its own; returns that thread. */
export async function agentHello(engine: EngineAccess, agentId: string): Promise<{ threadId: string }> {
  return callEngine(engine, 'POST', `/agents/${agentId}/hello`);
}

/** An app an organisation asked us to connect (connectors.md, phase 0: demand decides what comes next). */
export interface ConnectorRequest {
  name: string;
  requestedByName: string;
  createdAt: string;
}

/** Asks for a connector Conexiones does not list. Any member may; asking twice for the same app changes nothing. */
export async function requestConnector(client: SupabaseClient, orgId: string, name: string): Promise<void> {
  const { error } = await client.rpc('request_connector', { target_org: orgId, wanted: name });
  if (error) throw error;
}

/** What the organisation has asked for, newest first. */
export async function listConnectorRequests(client: SupabaseClient, orgId: string): Promise<ConnectorRequest[]> {
  const { data, error } = await client
    .from('connector_requests')
    .select('name, requested_by_name, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({ name: r.name, requestedByName: r.requested_by_name, createdAt: r.created_at }));
}

// Agent runs: what the agents did, on their own or when asked
// (supabase/migrations/20261121100000_agent_runners.sql). Read only: the engine records them.

interface AgentRunRow {
  id: string;
  org_id: string;
  agent_id: string;
  origin: 'person' | 'schedule' | 'routine';
  state: 'running' | 'done' | 'failed';
  summary: string | null;
  noteworthy: boolean;
  decisions_opened: number;
  started_at: string;
  finished_at: string | null;
}

export function agentRunFromRow(r: AgentRunRow): AgentRun {
  return {
    id: r.id,
    orgId: r.org_id,
    agentId: r.agent_id,
    origin: r.origin,
    state: r.state,
    summary: r.summary,
    noteworthy: r.noteworthy,
    decisionsOpened: r.decisions_opened,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

/** What the agents finished on their own since `since`, newest first: «Hecho sin ti» (app-design.md #11). */
export async function listDoneWithoutYou(client: SupabaseClient, orgId: string, since: Date): Promise<AgentRun[]> {
  const { data, error } = await client
    .from('agent_runs')
    .select('id, org_id, agent_id, origin, state, summary, noteworthy, decisions_opened, started_at, finished_at')
    .eq('org_id', orgId)
    .in('origin', ['schedule', 'routine'])
    .eq('state', 'done')
    .gte('started_at', since.toISOString())
    .order('started_at', { ascending: false })
    .limit(50)
    .returns<AgentRunRow[]>();
  if (error) throw error;
  return (data ?? []).map(agentRunFromRow);
}
// Routines: what a person asks an agent to do on its own at an hour
// (docs/plans/ongoing/agent-routines.md, supabase/migrations/20261126000000_agent_routines.sql).
// A person sees their own and the team's of the agents they can see; the
// database checks every change (rule 2), and these are the functions both the
// screens and the agents' tool call (rule 6).

export interface RoutineRow {
  id: string;
  org_id: string;
  agent_id: string;
  created_by: string | null;
  audience: RoutineAudience;
  title: string;
  instruction: string;
  kind: Routine['kind'];
  weekdays: number[];
  month_day: number | null;
  hour: number;
  minute: number;
  timezone: string;
  paused: boolean;
  paused_reason: Routine['pausedReason'];
  last_fired_at: string;
  created_at: string;
}

export function routineFromRow(r: RoutineRow): Routine {
  return {
    id: r.id,
    orgId: r.org_id,
    agentId: r.agent_id,
    createdBy: r.created_by,
    audience: r.audience,
    title: r.title,
    instruction: r.instruction,
    kind: r.kind,
    weekdays: (r.weekdays ?? []) as Weekday[],
    monthDay: r.month_day,
    hour: r.hour,
    minute: r.minute,
    timezone: r.timezone,
    paused: r.paused,
    pausedReason: r.paused_reason ?? null,
    lastFiredAt: r.last_fired_at,
    createdAt: r.created_at,
  };
}

const ROUTINE_COLUMNS =
  'id, org_id, agent_id, created_by, audience, title, instruction, kind, weekdays, month_day, hour, minute, timezone, paused, paused_reason, last_fired_at, created_at';

/** The routines the person sees in an organisation (or with one agent), oldest first. */
export async function listRoutines(client: SupabaseClient, orgId: string, agentId?: string): Promise<Routine[]> {
  let q = client.from('agent_routines').select(ROUTINE_COLUMNS).eq('org_id', orgId);
  if (agentId) q = q.eq('agent_id', agentId);
  const { data, error } = await q.order('created_at').returns<RoutineRow[]>();
  if (error) throw error;
  return (data ?? []).map(routineFromRow);
}

export interface RoutineInput extends RoutineWhen {
  title: string;
  instruction: string;
}

const whenArgs = (w: RoutineInput) => ({
  title: w.title.trim(),
  instruction: w.instruction.trim(),
  kind: w.kind,
  weekdays: w.kind === 'days' ? [...new Set(w.weekdays)].sort() : [1, 2, 3, 4, 5, 6, 7],
  month_day: w.kind === 'monthly' ? w.monthDay : null,
  hour: w.hour,
  minute: w.minute,
});

/** A new routine with an agent the person may talk to; «Para todo el equipo» is an owner's. */
export async function createRoutine(client: SupabaseClient, agentId: string, audience: RoutineAudience, r: RoutineInput): Promise<Routine> {
  const { data, error } = await client
    .rpc('create_routine', { target_agent: agentId, audience, ...whenArgs(r) })
    .single<RoutineRow>();
  if (error) throw error;
  return routineFromRow(data);
}

/** What it does and when; it starts again from now. Its creator for «Solo para mí», an owner for the team's. */
export async function updateRoutine(client: SupabaseClient, routineId: string, r: RoutineInput): Promise<Routine> {
  const { data, error } = await client
    .rpc('update_routine', { target_routine: routineId, ...whenArgs(r) })
    .single<RoutineRow>();
  if (error) throw error;
  return routineFromRow(data);
}

export async function setRoutinePaused(client: SupabaseClient, routineId: string, paused: boolean): Promise<Routine> {
  const { data, error } = await client.rpc('set_routine_paused', { target_routine: routineId, paused }).single<RoutineRow>();
  if (error) throw error;
  return routineFromRow(data);
}

export async function deleteRoutine(client: SupabaseClient, routineId: string): Promise<void> {
  const { error } = await client.rpc('delete_routine', { target_routine: routineId });
  if (error) throw error;
}

// --- Push notifications ---------------------------------------------------------
// The person's own phone, not an organisation's: classified `never` in settings.ts.

export interface DeviceRegistration {
  token: string;
  platform: DevicePlatform;
  /** iPhone only: which APNs gateway the token belongs to. Null on Android. */
  apnsEnvironment: 'production' | 'sandbox' | null;
  bundleId: string;
  /** IANA name (`Europe/Madrid`): the daily push goes out at 09:00 in it. */
  timeZone: string;
}

/** This phone receives the signed-in person's pushes (a token another person held moves to them). */
export async function registerDevice(client: SupabaseClient, d: DeviceRegistration): Promise<void> {
  const { error } = await client.rpc('register_device', {
    token: d.token,
    platform: d.platform,
    apns_environment: d.apnsEnvironment,
    bundle_id: d.bundleId,
    time_zone: d.timeZone,
  });
  if (error) throw error;
}

/** This phone stops receiving the signed-in person's pushes: on signing out. */
export async function forgetDevice(client: SupabaseClient, token: string): Promise<void> {
  const { error } = await client.rpc('forget_device', { token });
  if (error) throw error;
}

export * from './settings';
export * from './externalParties';
