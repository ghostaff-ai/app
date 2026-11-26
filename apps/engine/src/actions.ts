// Approving what an agent wants to do outside Ghostaff (docs/plans/ongoing/
// connectors.md). A tool that creates or changes something with a connected
// account (publish, reply, create an invoice) never runs when the model asks:
// the chat records it as a pending action with a card in the agent's message
// (chat.ts), and it runs here only when an owner presses «Aprobar». That is
// what stops a comment, a review or a page an agent reads from talking it into
// publishing something.
//
// The action runs from the stored row, never from the message, and moves
// pending → running exactly once, so two presses cannot run it twice.
//
// Whoever approves may first change the text fields its tool declares editable
// («Editar», docs/plans/ongoing/model-routing.md): the row keeps what the agent
// drafted beside what ran, which is how routing learns a draft was not right.

import { type ActionPart, type EditableField, isActionPart, type MessagePart } from '@ghostaff/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type Membership, Refusal, requireOwner } from './connections';
import { type AsPerson, isSettingTool, runSetting } from './settings';
import { type AgentTools, type EditableSpec, mergeTools } from './tools';

export interface ActionRecord {
  id: string;
  orgId: string;
  threadId: string;
  messageId: string;
  /** The agent that proposed it. */
  agentId: string | null;
  tool: string;
  input: Record<string, unknown>;
  label: string;
  status: ActionPart['status'];
  /** The state of the message that carries the card: an action is decided once its message is written. */
  messageState: 'working' | 'done' | 'failed';
  /** Who decides: an owner, or the person who asked (a routine they make or made, agent-routines.md). */
  decider: 'owner' | 'requester';
  requestedBy: string | null;
}

export interface ActionStore {
  membership(orgId: string, userId: string): Promise<Membership | null>;
  action(id: string): Promise<ActionRecord | null>;
  /**
   * pending → running (or → rejected); false when it was no longer pending.
   * `edited`: the input a person changed before approving, and the agent's draft, kept beside it.
   */
  claim(
    id: string,
    to: 'running' | 'rejected',
    userId: string,
    name: string,
    edited?: { input: Record<string, unknown>; drafted: Record<string, unknown> },
  ): Promise<boolean>;
  settle(id: string, status: 'done' | 'failed', result: string): Promise<void>;
  /** Rewrites the action's card in its message, so everyone in the thread sees it change. */
  updateCard(messageId: string, actionId: string, patch: Partial<ActionPart>): Promise<void>;
}

export interface ActionDeps {
  actions: ActionStore;
  toolsFor(orgId: string): Promise<AgentTools>;
  /** The tools of one agent's guided accesses (guidedAccounts.ts): a request it proposed runs with them. */
  guidedToolsFor?(orgId: string, agentId: string): Promise<AgentTools>;
  /** A client signed in as the approving owner: a settings change runs as them (settings.ts). */
  asPerson?: AsPerson;
}

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

async function decidable(deps: ActionDeps, userId: string, id: unknown) {
  if (!isUuid(id)) throw new Refusal(400, 'bad_request', 'action must be a uuid');
  const a = await deps.actions.action(id);
  if (!a) throw new Refusal(404, 'not_found', 'action not found');
  // Owners decide: an action acts with the organisation's own accounts. Anyone else hears the same refusal.
  // A routine a person makes, or made, is theirs to decide, and only theirs (agent-routines.md, decision 1).
  const owner = a.decider === 'requester' ? await requireRequester(deps.actions, a, userId) : await requireOwner(deps.actions, a.orgId, userId);
  if (a.messageState === 'working') throw new Refusal(409, 'still_writing', 'the agent is still writing that message');
  if (a.status !== 'pending') throw new Refusal(409, 'already_decided', 'this action was already decided');
  return { a, owner };
}

async function requireRequester(store: ActionStore, a: ActionRecord, userId: string): Promise<Membership> {
  const m = await store.membership(a.orgId, userId);
  if (!m || !a.requestedBy || a.requestedBy !== userId) throw new Refusal(403, 'not_allowed', 'only the person who asked decides this');
  return m;
}

/** The tools an action runs with: the organisation's accounts, and the guided accesses of the agent that proposed it. */
async function toolsOf(deps: ActionDeps, a: ActionRecord): Promise<AgentTools> {
  const org = await deps.toolsFor(a.orgId);
  return a.agentId && deps.guidedToolsFor ? mergeTools(org, await deps.guidedToolsFor(a.orgId, a.agentId)) : org;
}

/**
 * Runs the action as stored, with the organisation's connected account, and shows how it went.
 * `edits` are the person's changes to its editable text fields («Editar»), by field.
 */
export async function approveAction(
  deps: ActionDeps,
  userId: string,
  id: unknown,
  accessToken?: string,
  edits?: unknown,
): Promise<{ status: 'done' | 'failed'; result: string }> {
  const { a, owner } = await decidable(deps, userId, id);
  const setting = isSettingTool(a.tool);
  if (setting && (!deps.asPerson || !accessToken || !a.agentId)) throw new Refusal(503, 'unavailable', 'settings changes are off here');
  const edited = await editedInput(deps, a, edits);
  if (!(await deps.actions.claim(a.id, 'running', userId, owner.displayName, edited ? { input: edited.input, drafted: a.input } : undefined))) {
    throw new Refusal(409, 'already_decided', 'this action was already decided');
  }
  const input = edited?.input ?? a.input;
  await deps.actions.updateCard(a.messageId, a.id, {
    status: 'running',
    decidedBy: owner.displayName,
    ...(edited ? { edited: true, preview: previewOf(input), editable: editableOf(edited.specs, input) } : {}),
  });
  let status: 'done' | 'failed' = 'failed';
  let result = 'No se ha podido hacer.';
  try {
    // A setting changes as the owner who approved, through the function the app's screen calls.
    const outcome =
      setting && deps.asPerson && accessToken && a.agentId
        ? await runSetting({ client: deps.asPerson(accessToken), orgId: a.orgId, agentId: a.agentId }, a.tool, input)
        : await (await toolsOf(deps, a)).run(a.tool, input);
    status = outcome.isError ? 'failed' : 'done';
    result = outcome.content.slice(0, 4000);
  } finally {
    await deps.actions.settle(a.id, status, result);
    await deps.actions.updateCard(a.messageId, a.id, { status, result, decidedBy: owner.displayName });
  }
  return { status, result };
}

export async function rejectAction(deps: ActionDeps, userId: string, id: unknown): Promise<{ status: 'rejected' }> {
  const { a, owner } = await decidable(deps, userId, id);
  if (!(await deps.actions.claim(a.id, 'rejected', userId, owner.displayName))) {
    throw new Refusal(409, 'already_decided', 'this action was already decided');
  }
  await deps.actions.updateCard(a.messageId, a.id, { status: 'rejected', decidedBy: owner.displayName });
  return { status: 'rejected' };
}

/**
 * The input a person's edits make, checked against what the tool lets them
 * change; null when there are none or they change nothing (approved as drafted).
 */
async function editedInput(
  deps: ActionDeps,
  a: ActionRecord,
  edits: unknown,
): Promise<{ input: Record<string, unknown>; specs: EditableSpec[] } | null> {
  if (edits === undefined || edits === null) return null;
  if (typeof edits !== 'object' || Array.isArray(edits)) throw new Refusal(400, 'bad_request', 'edits must be an object of texts');
  const entries = Object.entries(edits as Record<string, unknown>);
  if (entries.length === 0) return null;
  const specs = editableOf((await toolsOf(deps, a)).editableFor?.(a.tool) ?? [], a.input).map(({ value: _, ...spec }) => spec);
  const input = { ...a.input };
  for (const [field, value] of entries) {
    const spec = specs.find((s) => s.field === field);
    if (!spec) throw new Refusal(400, 'not_editable', `${field} cannot be edited`);
    if (typeof value !== 'string' || !value.trim()) throw new Refusal(400, 'bad_request', `${field} must be a text`);
    if (value.length > spec.max) throw new Refusal(400, 'too_long', `${field} takes at most ${spec.max} characters`);
    input[field] = value;
  }
  return entries.some(([field]) => input[field] !== a.input[field]) ? { input, specs } : null;
}

/**
 * The fields of a tool's input a person may change, with their values: only
 * those the input has as text no longer than the field takes.
 */
export function editableOf(specs: readonly EditableSpec[], input: Record<string, unknown>): EditableField[] {
  return specs.flatMap((s) => {
    const value = input[s.field];
    return typeof value === 'string' && value.length <= s.max ? [{ ...s, value }] : [];
  });
}

/** A tool's input as the card shows it: one «field: value» per line, long values cut. */
export function previewOf(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  return Object.entries(input as Record<string, unknown>)
    .map(([k, v]) => {
      const text = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${text.length > 400 ? `${text.slice(0, 400)}…` : text}`;
    })
    .join('\n')
    .slice(0, 2000);
}

/** The ActionStore over Supabase with the service role. */
export function supabaseActionStore(admin: SupabaseClient): ActionStore {
  const check = <T>(r: { data: T; error: unknown }): T => {
    if (r.error) throw r.error;
    return r.data;
  };
  return {
    async membership(orgId, userId) {
      const r = check(await admin.from('memberships').select('role, display_name').eq('org_id', orgId).eq('user_id', userId).maybeSingle());
      return r ? { role: r.role, displayName: r.display_name } : null;
    },
    async action(id) {
      const r = check(
        await admin
          .from('agent_actions')
          .select('id, org_id, thread_id, message_id, agent_id, tool, input, label, status, decider, requested_by, messages(state)')
          .eq('id', id)
          .maybeSingle(),
      ) as Record<string, any> | null;
      if (!r) return null;
      const message = Array.isArray(r.messages) ? r.messages[0] : r.messages;
      return {
        id: r.id,
        orgId: r.org_id,
        threadId: r.thread_id,
        messageId: r.message_id,
        agentId: r.agent_id ?? null,
        tool: r.tool,
        input: r.input,
        label: r.label,
        status: r.status,
        messageState: message?.state ?? 'done',
        decider: r.decider === 'requester' ? 'requester' : 'owner',
        requestedBy: r.requested_by ?? null,
      };
    },
    async claim(id, to, userId, name, edited) {
      const rows =
        check(
          await admin
            .from('agent_actions')
            .update({
              status: to,
              decided_by: userId,
              decided_by_name: name,
              decided_at: new Date().toISOString(),
              ...(edited ? { input: edited.input, drafted_input: edited.drafted } : {}),
            })
            .eq('id', id)
            .eq('status', 'pending')
            .select('id'),
        ) ?? [];
      return rows.length === 1;
    },
    async settle(id, status, result) {
      check(await admin.from('agent_actions').update({ status, result }).eq('id', id));
    },
    async updateCard(messageId, actionId, patch) {
      const r = check(await admin.from('messages').select('parts').eq('id', messageId).maybeSingle());
      if (!r) return;
      const parts = (r.parts as MessagePart[]).map((p) => (isActionPart(p) && p.actionId === actionId ? { ...p, ...patch } : p));
      check(await admin.from('messages').update({ parts }).eq('id', messageId));
    },
  };
}
