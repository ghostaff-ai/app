import type { SupabaseClient } from '@supabase/supabase-js';
import { type AiUsageDay, limitsFromRow } from '../aiUsage';
import type { AccountProvider } from '../connectors';
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
  Decision,
  DecisionSource,
  Department,
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
import type { ChatMessage, ChatThread, MessagePart, OrgMember } from '../chat';

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
  };
}

export const CONNECTION_COLUMNS =
  'id, org_id, kind, provider, method, hint, settings, status, status_reason, checked_at, connected_by_name, updated_at, position, label, limits, last_used_at';

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
 * shows how it went. Anyone but an owner is refused.
 */
export async function decideAction(engine: EngineAccess, actionId: string, decision: 'approve' | 'reject'): Promise<{ status: string; result?: string }> {
  return callEngine(engine, 'POST', `/actions/${encodeURIComponent(actionId)}/${decision}`);
}

/**
 * Dictation: a voice note recorded in the chat's message box, turned into text
 * by the engine (Gemini in the EU). The audio is sent as is and never kept; the
 * text comes back for the person to review before sending. '' when nobody spoke.
 */
export async function transcribe(engine: EngineAccess, orgId: string, audio: Blob, mimeType: string): Promise<string> {
  const { text } = await sendToEngine<{ text: string }>(engine, 'POST', `/transcribe?org=${encodeURIComponent(orgId)}`, {
    type: mimeType,
    data: audio,
  });
  return text;
}

/** The service account a customer grants Vertex AI access to on their own project. */
export async function getEngineIdentity(engine: EngineAccess): Promise<{ serviceAccount: string }> {
  return callEngine(engine, 'GET', '/identity');
}

// Agents. Members read the agents they may see (not those set to «none» for
// them); only owners add or remove agents, through create_agent and delete_agent.

interface AgentRow {
  id: string;
  org_id: string;
  name: string;
  ghost: AgentGhost;
  department: Department;
  member_default: AgentLevel;
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
    department: r.department,
    memberDefault: r.member_default,
    runner: r.runner ?? 'chat',
    description: r.description ?? null,
    schedule: r.schedule ?? null,
    accounts: r.accounts ?? null,
    createdAt: r.created_at,
  };
}

const AGENT_COLUMNS = 'id, org_id, name, ghost, department, member_default, runner, description, schedule, accounts, created_at';

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
// their level on each agent; they write only through start_thread and
// post_message, and new messages arrive through Realtime under the same rules.

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
  }));
}

export interface ThreadHead {
  id: string;
  orgId: string;
  agentId: string;
  title: string;
}

export async function getThread(client: SupabaseClient, id: string): Promise<ThreadHead | null> {
  const { data, error } = await client
    .from('threads')
    .select('id, org_id, agent_id, title')
    .eq('id', id)
    .maybeSingle<{ id: string; org_id: string; agent_id: string; title: string }>();
  if (error) throw error;
  return data ? { id: data.id, orgId: data.org_id, agentId: data.agent_id, title: data.title } : null;
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
    createdAt: r.created_at,
  };
}

const MESSAGE_COLUMNS = 'id, thread_id, author_kind, author_user, author_agent, author_name, parts, state, steps, created_at';

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

/** Starts a thread with an agent the person may talk to; returns its id. */
export async function startThread(client: SupabaseClient, agentId: string, body: string): Promise<string> {
  const { data, error } = await client.rpc('start_thread', { target_agent: agentId, body }).single<{ id: string }>();
  if (error) throw error;
  return data.id;
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
  origin: 'person' | 'schedule';
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
    .eq('origin', 'schedule')
    .eq('state', 'done')
    .gte('started_at', since.toISOString())
    .order('started_at', { ascending: false })
    .limit(50)
    .returns<AgentRunRow[]>();
  if (error) throw error;
  return (data ?? []).map(agentRunFromRow);
}
export * from './settings';
