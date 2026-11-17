import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Agent,
  AgentGhost,
  AiProvider,
  Answer,
  ConnectAiInput,
  Connection,
  Decision,
  DecisionSource,
  Department,
  MembershipRole,
  MyInvitation,
  MyOrganization,
  NewAgent,
  NewOrganization,
  Organization,
  PendingInvitation,
  Profile,
} from '../models';

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
  answer: Answer | null;
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
    answer:
      r.answer && r.answered_at
        ? {
            answer: r.answer,
            byName: r.answered_by_name ?? '',
            at: r.answered_at,
            note: r.answer_note,
            signedText: r.answer_text,
            source: r.answer_source ?? 'record',
            writtenBackAt: r.written_back_at,
          }
        : null,
    closedAt: r.closed_at,
  };
}

const DECISION_COLUMNS =
  'id, org_id, record_id, source_path, area, kind, question, context, proposed_by, created_on, rule_proposal, recommendation, if_yes, if_no, quote, sources, due_on, answer, answered_by_name, answered_at, answer_note, answer_text, answer_source, written_back_at, closed_at';

interface MembershipWithOrg {
  role: MembershipRole;
  display_name: string;
  organizations: { id: string; slug: string; name: string } | null;
}

/** The organisations the signed-in person belongs to, by name. */
export async function listMyOrganizations(client: SupabaseClient, userId: string): Promise<MyOrganization[]> {
  const { data, error } = await client
    .from('memberships')
    .select('role, display_name, organizations ( id, slug, name )')
    .eq('user_id', userId)
    .returns<MembershipWithOrg[]>();
  if (error) throw error;
  return (data ?? [])
    .flatMap((m) => (m.organizations ? [{ ...m.organizations, role: m.role, displayName: m.display_name }] : []))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
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
  answer: Answer;
  note?: string;
  /** Only for a rule answered OK. */
  signedText?: string;
}

/** OK or no. The database checks membership and signs with the person's display name. */
export async function answerDecision(client: SupabaseClient, input: AnswerInput): Promise<Decision> {
  const { data, error } = await client
    .rpc('answer_decision', {
      decision_id: input.decisionId,
      answer: input.answer,
      note: input.note?.trim() || null,
      signed_text: input.signedText?.trim() || null,
    })
    .single<DecisionRow>();
  if (error) throw error;
  return decisionFromRow(data);
}

/** Takes back an answer given in the app, while the agent does not have it yet. */
export async function unanswerDecision(client: SupabaseClient, decisionId: string): Promise<Decision> {
  const { data, error } = await client.rpc('unanswer_decision', { decision_id: decisionId }).single<DecisionRow>();
  if (error) throw error;
  return decisionFromRow(data);
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
  return { id: data.id, slug: data.slug, name: data.name };
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
  return { id: data.id, slug: data.slug, name: data.name };
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

export async function inviteMember(client: SupabaseClient, orgId: string, email: string, role: MembershipRole = 'member'): Promise<void> {
  const { error } = await client.rpc('invite_member', { target_org: orgId, invitee_email: email, invitee_role: role });
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
  provider: AiProvider;
  method: Connection['method'];
  hint: string;
  settings: Connection['settings'] | null;
  status: Connection['status'];
  checked_at: string;
  connected_by_name: string;
  updated_at: string;
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
    checkedAt: r.checked_at,
    connectedByName: r.connected_by_name,
    updatedAt: r.updated_at,
  };
}

export const CONNECTION_COLUMNS =
  'id, org_id, kind, provider, method, hint, settings, status, checked_at, connected_by_name, updated_at';

/** The organisation's connections. Every member sees them; only owners change them. */
export async function listConnections(client: SupabaseClient, orgId: string): Promise<Connection[]> {
  const { data, error } = await client
    .from('connections')
    .select(CONNECTION_COLUMNS)
    .eq('org_id', orgId)
    .order('created_at')
    .returns<ConnectionRow[]>();
  if (error) throw error;
  return (data ?? []).map(connectionFromRow);
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
  if (!engine.url) throw new EngineError('not_configured', 0, 'engine URL not configured');
  let res: Response;
  try {
    res = await fetch(`${engine.url.replace(/\/$/, '')}${path}`, {
      method,
      headers: { Authorization: `Bearer ${engine.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
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

/** Removes the connection and deletes its key from the vault. */
export async function disconnectAi(engine: EngineAccess, orgId: string, provider: AiProvider): Promise<void> {
  await callEngine(engine, 'DELETE', `/connections/ai/${provider}?org=${encodeURIComponent(orgId)}`);
}

/** The service account a customer grants Vertex AI access to on their own project. */
export async function getEngineIdentity(engine: EngineAccess): Promise<{ serviceAccount: string }> {
  return callEngine(engine, 'GET', '/identity');
}

// Agents. Every member reads the team; only owners add or remove agents, through
// create_agent and delete_agent.

interface AgentRow {
  id: string;
  org_id: string;
  name: string;
  ghost: AgentGhost;
  department: Department;
  created_at: string;
}

export function agentFromRow(r: AgentRow): Agent {
  return { id: r.id, orgId: r.org_id, name: r.name, ghost: r.ghost, department: r.department, createdAt: r.created_at };
}

const AGENT_COLUMNS = 'id, org_id, name, ghost, department, created_at';

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

/** Removes an agent from its team. Owners only. */
export async function deleteAgent(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.rpc('delete_agent', { agent_id: id });
  if (error) throw error;
}
