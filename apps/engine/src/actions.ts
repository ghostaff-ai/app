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

import { type ActionPart, isActionPart, type MessagePart } from '@ghostaff/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type Membership, Refusal, requireOwner } from './connections';
import type { AgentTools } from './tools';

export interface ActionRecord {
  id: string;
  orgId: string;
  threadId: string;
  messageId: string;
  tool: string;
  input: Record<string, unknown>;
  label: string;
  status: ActionPart['status'];
  /** The state of the message that carries the card: an action is decided once its message is written. */
  messageState: 'working' | 'done' | 'failed';
}

export interface ActionStore {
  membership(orgId: string, userId: string): Promise<Membership | null>;
  action(id: string): Promise<ActionRecord | null>;
  /** pending → running (or → rejected); false when it was no longer pending. */
  claim(id: string, to: 'running' | 'rejected', userId: string, name: string): Promise<boolean>;
  settle(id: string, status: 'done' | 'failed', result: string): Promise<void>;
  /** Rewrites the action's card in its message, so everyone in the thread sees it change. */
  updateCard(messageId: string, actionId: string, patch: Partial<ActionPart>): Promise<void>;
}

export interface ActionDeps {
  actions: ActionStore;
  toolsFor(orgId: string): Promise<AgentTools>;
}

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

async function decidable(deps: ActionDeps, userId: string, id: unknown) {
  if (!isUuid(id)) throw new Refusal(400, 'bad_request', 'action must be a uuid');
  const a = await deps.actions.action(id);
  if (!a) throw new Refusal(404, 'not_found', 'action not found');
  // Owners decide: an action acts with the organisation's own accounts. Anyone else hears the same refusal.
  const owner = await requireOwner(deps.actions, a.orgId, userId);
  if (a.messageState === 'working') throw new Refusal(409, 'still_writing', 'the agent is still writing that message');
  if (a.status !== 'pending') throw new Refusal(409, 'already_decided', 'this action was already decided');
  return { a, owner };
}

/** Runs the action as stored, with the organisation's connected account, and shows how it went. */
export async function approveAction(deps: ActionDeps, userId: string, id: unknown): Promise<{ status: 'done' | 'failed'; result: string }> {
  const { a, owner } = await decidable(deps, userId, id);
  if (!(await deps.actions.claim(a.id, 'running', userId, owner.displayName))) {
    throw new Refusal(409, 'already_decided', 'this action was already decided');
  }
  await deps.actions.updateCard(a.messageId, a.id, { status: 'running', decidedBy: owner.displayName });
  let status: 'done' | 'failed' = 'failed';
  let result = 'No se ha podido hacer.';
  try {
    const tools = await deps.toolsFor(a.orgId);
    const outcome = await tools.run(a.tool, a.input);
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
          .select('id, org_id, thread_id, message_id, tool, input, label, status, messages(state)')
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
        tool: r.tool,
        input: r.input,
        label: r.label,
        status: r.status,
        messageState: message?.state ?? 'done',
      };
    },
    async claim(id, to, userId, name) {
      const rows =
        check(
          await admin
            .from('agent_actions')
            .update({ status: to, decided_by: userId, decided_by_name: name, decided_at: new Date().toISOString() })
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
