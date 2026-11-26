// Routines on the tick (docs/plans/ongoing/agent-routines.md): what a person
// asked an agent to do on its own at an hour. A routine is a message the
// clock writes for its creator: when it fires, the engine does what it does
// when they write the instruction to the agent, in its chat. A chat agent
// answers with a chat turn; an agent on our runner with a run. Nobody picks
// «chat or job»: that is the agent's runner, the engine's business.
//
// The answer is in the agent's chat, which everyone who can see the agent
// reads (group-chat-per-agent.md). One with nothing to tell (SIN NOVEDAD)
// leaves nothing behind. One whose creator left, or can no longer talk to the
// agent, is paused, and the main agent says so in its chat (decision 5).

import { firedBetween, type Routine } from '@ghostaff/shared';
import { routineFromRow, type RoutineRow } from '@ghostaff/shared/services';
import type { SupabaseClient } from '@supabase/supabase-js';
import { answerRoutine, type ChatAgent, type ChatDeps, type ChatThreadHead } from './chat';
import type { JobDeps } from './jobs';
import { askRunner, NOTHING_NEW } from './runner';

/** The database as routines need it (service role). */
export interface RoutineStore {
  /** Every routine that is not paused. */
  liveRoutines(): Promise<Routine[]>;
  /** Moves `last_fired_at` from `prev` to `to`; false when it was no longer `prev` (another tick took it). */
  claim(id: string, prev: string, to: Date): Promise<boolean>;
  /** Pauses a routine the engine cannot run any more, saying why. */
  pause(id: string, reason: 'creator_gone'): Promise<void>;
  /** Its creator's name, if they may still have it run: a member who talks to the agent. */
  creator(r: Routine): Promise<{ name: string } | null>;
  /** A word from the main agent in its chat. */
  notifyOwners(orgId: string, text: string): Promise<number>;
}

/** Whether an agent's last words were «nothing to tell». */
export const isNothingNew = (text: string) => text.replace(/^[`*\s]+|[`*\s]+$/g, '') === NOTHING_NEW;

/** How many routines answer at once on one tick: each chat turn holds the request open. */
const AT_ONCE = 4;

/**
 * On the tick: every routine whose hour came since it last fired. Several
 * missed hours start one answer, not a backlog; `last_fired_at` moves first
 * and atomically, so two ticks never answer the same hour twice.
 */
export async function startRoutines(chat: ChatDeps, deps: JobDeps, store: RoutineStore, now: Date = new Date()): Promise<number> {
  const due: Routine[] = [];
  for (const r of await store.liveRoutines()) {
    if (!firedBetween(r, new Date(r.lastFiredAt), now, r.timezone)) continue;
    if (await store.claim(r.id, r.lastFiredAt, now)) due.push(r);
  }
  let started = 0;
  for (let i = 0; i < due.length; i += AT_ONCE) {
    const batch = await Promise.allSettled(due.slice(i, i + AT_ONCE).map((r) => fire(chat, deps, store, r, now)));
    for (const [j, b] of batch.entries()) {
      if (b.status === 'fulfilled' && b.value) started += 1;
      if (b.status === 'rejected') console.error('routine not answered', due[i + j]?.id, b.reason instanceof Error ? b.reason.message : typeof b.reason);
    }
  }
  return started;
}

/** One routine's hour: true when it started an answer. */
async function fire(chat: ChatDeps, deps: JobDeps, store: RoutineStore, r: Routine, now: Date): Promise<boolean> {
  const agent = await chat.chat.agent(r.agentId);
  if (!agent || agent.runner === 'ordago_job') return false;
  const creator = r.createdBy ? await store.creator(r) : null;
  if (!r.createdBy || !creator) {
    await store.pause(r.id, 'creator_gone');
    await store.notifyOwners(
      r.orgId,
      `He pausado la rutina «${r.title}» de ${agent.name}: quien la creó ya no está en la empresa o ya no puede hablar con ${agent.name}. ` +
        'Quien sea propietario puede reanudarla desde la ficha del agente, en Rutinas.',
    );
    return false;
  }
  const threadId = await chat.chat.agentChat(agent.id);
  const thread: ChatThreadHead = { id: threadId, orgId: agent.orgId, agentId: agent.id, title: agent.name };
  const replyId = await chat.chat.startReply(thread, agent, ['Con tu rutina'], { routineId: r.id });
  if (!replyId) {
    // The agent is answering in its chat right now: the next tick tries this hour again.
    await store.claim(r.id, now.toISOString(), new Date(r.lastFiredAt));
    return false;
  }
  if (agent.runner === 'ghostaff' && deps.runner) {
    // Its run reports to POST /runs/report, which answers in this message (jobs.ts).
    await askRunner(chat, deps, thread, agent, replyId, r.createdBy, r.id);
    return true;
  }
  await answerInChat(chat, deps, r, agent, thread, replyId, creator.name);
  return true;
}

async function answerInChat(chat: ChatDeps, deps: JobDeps, r: Routine, agent: ChatAgent, thread: ChatThreadHead, replyId: string, from: string) {
  const runId = await deps.jobs.startRun({
    orgId: agent.orgId,
    agentId: agent.id,
    origin: 'routine',
    routineId: r.id,
    requestedBy: r.createdBy,
    threadId: thread.id,
    messageId: replyId,
  });
  const out = await answerRoutine(chat, thread, agent, replyId, { title: r.title, instruction: r.instruction, from, userId: r.createdBy! });
  if (out.ok && isNothingNew(out.text)) {
    await chat.chat.deleteMessage(replyId);
    await deps.jobs.finishRun(runId, { state: 'done', summary: null, noteworthy: false, decisionsOpened: 0 });
    return;
  }
  await deps.jobs.finishRun(runId, { state: out.ok ? 'done' : 'failed', summary: out.text || null, noteworthy: true, decisionsOpened: 0 });
  await chat.chat.touchThread(thread.id).catch(() => {});
}

const ROUTINE_COLUMNS =
  'id, org_id, agent_id, created_by, title, instruction, kind, weekdays, month_day, hour, minute, timezone, paused, paused_reason, last_fired_at, created_at';

function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

/** The RoutineStore over Supabase with the service role. */
export function supabaseRoutineStore(admin: SupabaseClient): RoutineStore {
  return {
    async liveRoutines() {
      const rows = check(await admin.from('agent_routines').select(ROUTINE_COLUMNS).eq('paused', false).limit(5000));
      return ((rows ?? []) as RoutineRow[]).map(routineFromRow);
    },
    async claim(id, prev, to) {
      const rows = check(
        await admin.from('agent_routines').update({ last_fired_at: to.toISOString() }).eq('id', id).eq('last_fired_at', prev).select('id'),
      );
      return (rows ?? []).length === 1;
    },
    async pause(id, reason) {
      check(await admin.from('agent_routines').update({ paused: true, paused_reason: reason, updated_at: new Date().toISOString() }).eq('id', id));
    },
    async creator(r) {
      if (!r.createdBy) return null;
      const m = check(
        await admin.from('memberships').select('role, display_name').eq('org_id', r.orgId).eq('user_id', r.createdBy).maybeSingle(),
      ) as { role: string; display_name: string } | null;
      if (!m) return null;
      const level = check(await admin.rpc('agent_level_for', { target_agent: r.agentId, member: r.createdBy })) as string;
      return level === 'talk' ? { name: m.display_name } : null;
    },
    async notifyOwners(orgId, text) {
      return check(await admin.rpc('notify_owners', { target_org: orgId, body: text })) as number;
    },
  };
}
