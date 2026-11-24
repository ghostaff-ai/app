// Guides (docs/plans/ready/guided-access.md): an agent hands a person a guide
// to give it access to an app the catalogue lacks (a self-hosted WordPress).
//
// The agent starts one with `start_guide` in its reply; the reply's writer
// (chat.ts) turns the call into a card in the message and a `guides` row,
// which is what the engine trusts afterwards, never the card. The app then
// drives the guide through the routes here: each step from the guide's model
// (guideModel.ts), the check of what the person typed (guidedAccounts.ts), an
// owner's approval of a member's grant (decision 2), and the agent going on
// once (`resumeInThread` in chat.ts).
//
// Every move of a guide is a conditional update of its row (on its status,
// and on when it last changed where a step could race it), so two people, or
// a double press, finish, approve or resume it once.
//
// What the person typed in the check goes to `secretFrom` and the vault only:
// never into the row, its history, a message, a log or an error.

import { agentEmail, type GuideAnswer, type GuideAuth, type GuideField, type GuideLanding, type GuidePart, type GuidePhoto, type GuideStatus, type GuideStep, guidedProvider, isGuidePart, type MessagePart, normaliseBase, parseLanding } from '@ghostaff/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatAgent, ChatDeps, Resumable } from './chat';
import { type Membership, Refusal, requireOwner } from './connections';
import { type CheckValues, checkLanding, type GuidedSecret, type GuidedSettings, type GuidedStore, secretFrom, secretOf } from './guidedAccounts';
import { GuideInputError, type GuideHistoryEntry, type GuideModelDeps, MAX_PHOTO_BYTES, nextStep, validateGuidePhoto } from './guideModel';
import { fetchPublic } from './publicFetch';
import type { AgentTools, ToolOutcome, ToolSpec } from './tools';
import { guidedSecretName, type Vault } from './vault';

export const GUIDE_TOOL = 'start_guide';

/** The most a step's request body may be: the largest photo the guide takes, in base64, and room for the answer. */
export const MAX_STEP_BODY = Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 16_384;

const NO_STEP = 'No he podido preparar el siguiente paso. Prueba otra vez en un momento.';

/** One guide as the engine keeps it (`guides`, migration 20261126100000_guides.sql). */
export interface GuideRecord {
  id: string;
  orgId: string;
  threadId: string;
  /** The agent's message that carries the card. */
  messageId: string;
  agentId: string;
  app: string;
  goal: string;
  why: string;
  landing: GuideLanding;
  history: GuideHistoryEntry[];
  status: GuideStatus;
  blockedReason: string | null;
  undo: string | null;
  startedBy: string | null;
  completedBy: string | null;
  decidedBy: string | null;
  resumedAt: string | null;
  /** When the row last changed: a step's save is conditional on it. */
  updatedAt: string;
  /** The state of the message that carries the card. */
  messageState: 'working' | 'done' | 'failed';
}

/** What a move expects the row to be: it happens only if it still is. */
export interface GuideCondition {
  status: GuideStatus;
  updatedAt?: string;
  /** Only while the agent has not gone on yet. */
  notResumed?: boolean;
}

export type GuidePatch = Partial<Pick<GuideRecord, 'status' | 'history' | 'undo' | 'blockedReason' | 'completedBy' | 'decidedBy' | 'resumedAt'>>;

/** The database as guides need it (service role). */
export interface GuideStore {
  create(g: {
    orgId: string;
    threadId: string;
    messageId: string;
    agentId: string;
    app: string;
    goal: string;
    why: string;
    landing: GuideLanding;
    startedBy: string;
  }): Promise<string>;
  guide(id: string): Promise<GuideRecord | null>;
  /** Applies `patch` only while the row matches `cond`; false when it no longer does. */
  update(id: string, cond: GuideCondition, patch: GuidePatch): Promise<boolean>;
  /** Rewrites the card in its message, so everyone in the thread sees it change. */
  updateCard(messageId: string, guideId: string, patch: Partial<GuidePart>): Promise<void>;
  membership(orgId: string, userId: string): Promise<Membership | null>;
  /** What the agent's address is made of; null when the agent is gone. */
  identity(orgId: string, agentId: string): Promise<{ orgSlug: string; agent: { slug: string | null; name: string } } | null>;
}

/** The routes' dependencies: the chat's (who may write, the AI accounts), the guides, the accesses and the vault. */
export interface GuideDeps {
  chat: ChatDeps;
  store: GuideStore;
  accesses: GuidedStore;
  vault: Vault;
  /** How the check reaches the app; fetchPublic unless a test gives another. */
  fetch?: typeof fetch;
}

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// ---------------------------------------------------------------------------
// Starting a guide, from the agent's reply

/** The tool as the model sees it. */
export function guideToolSpec(): ToolSpec {
  return {
    name: GUIDE_TOOL,
    description:
      'Start a guide that walks the person, step by step, through giving you your own access to an app that has an HTTP API but no connect button ' +
      '(for example a self-hosted WordPress, not one on WordPress.com): a user created for you with your own address, and an application password, token or key. ' +
      'The person sees a card in your message; Ghostaff checks the access before keeping it, and you are asked to go on once it works. ' +
      'Prefer the least access that does the job. Never ask for anyone\'s own password. One guide per message; end your message saying what you will do once you have the access.',
    input_schema: {
      type: 'object',
      properties: {
        app: { type: 'string', description: 'The app\'s plain name, as the person knows it («WordPress»).' },
        goal: { type: 'string', description: 'In Spanish, what the access is for, in one line («Redes puede publicar borradores en tu web»).' },
        why: { type: 'string', description: 'In Spanish, one short line for the card («Para publicar el borrador que me pides»).' },
        auth: { type: 'string', enum: ['basic', 'bearer', 'header'], description: 'basic: a user and its (application) password; bearer: a token; header: a key in a named header.' },
        base_suffix: { type: 'string', description: 'Added after the address the person types, starting with / (/wp-json for WordPress).' },
        header_name: { type: 'string', description: 'With auth header only: the header that carries the key.' },
        check_path: { type: 'string', description: 'A GET under the base that must answer 2xx with the access (/wp/v2/users/me?context=edit).' },
        expect: {
          type: 'object',
          description: 'Optional: a top-level JSON field of the check\'s answer that must include a value (roles includes editor).',
          properties: { field: { type: 'string' }, includes: { type: 'string' } },
          required: ['field', 'includes'],
        },
      },
      required: ['app', 'goal', 'why', 'auth', 'check_path'],
    },
  };
}

/** The tool for an agent's set of tools. It only works inside a reply, which intercepts it (chat.ts). */
export const GUIDE_TOOLS: AgentTools = {
  specs: [guideToolSpec()],
  accounts: [],
  accountProviders: [],
  stepFor: () => 'Preparando una guía',
  writes: () => false,
  actionFor: (name) => name,
  run: async () => ({ content: 'Solo se puede empezar una guía en una conversación.', isError: true }),
};

const fail = (content: string): { outcome: ToolOutcome } => ({ outcome: { content, isError: true } });

/**
 * Turns one `start_guide` call into a card, recorded for the engine to trust
 * later. `already` holds this message's guides so far: one per message.
 */
export async function proposeGuide(
  store: GuideStore,
  at: { orgId: string; threadId: string; messageId: string; agentId: string; userId: string },
  input: unknown,
  already: readonly GuidePart[],
): Promise<{ part?: GuidePart; outcome: ToolOutcome }> {
  if (already.length > 0) return fail('Ya hay una guía en este mensaje: espera a que la terminen.');
  const i = isRecord(input) ? input : {};
  const app = oneLine(i.app, 200);
  if (app.length < 1 || app.length > 80) return fail('Di el nombre de la aplicación, en menos de 80 caracteres.');
  const goal = oneLine(i.goal, 400);
  if (goal.length < 1 || goal.length > 200) return fail('Di para qué es el acceso (goal), en menos de 200 caracteres.');
  const why = oneLine(i.why, 200);
  const landing = parseLanding({
    auth: i.auth,
    ...(i.header_name === undefined ? {} : { header: i.header_name }),
    ...(i.base_suffix === undefined || i.base_suffix === '' ? {} : { suffix: i.base_suffix }),
    check: { path: i.check_path, ...(i.expect === undefined ? {} : { expect: i.expect }) },
  });
  if ('error' in landing) return fail(`La guía no vale: ${landing.error}.`);
  const guideId = await store.create({ ...at, app, goal, why, landing, startedBy: at.userId });
  return {
    part: { type: 'guide', guideId, app, why, status: 'open' },
    outcome: { content: 'Guía mostrada: termina el mensaje diciendo qué harás cuando tengas el acceso', isError: false },
  };
}

/** The card, as the agent reads its own past message. */
export function guideLine(p: GuidePart): string {
  const state: Record<GuideStatus, string> = {
    open: 'todavía no está hecha',
    checked: 'hecha, falta que la apruebe alguien propietario',
    done: 'ya tengo el acceso',
    rejected: `la rechazó ${p.decidedBy ?? 'alguien propietario'}, no tengo el acceso`,
    blocked: p.blockedReason ? `no se pudo terminar: ${p.blockedReason}` : 'no se pudo terminar',
    handed_over: 'se cambió por el botón de conectar de la aplicación',
  };
  return `[Pedí acceso a ${p.app} con una guía: ${state[p.status] ?? state.open}.]`;
}

/** The lines for the guides of a message, empty when it has none. */
export function guideLines(parts: readonly MessagePart[]): string[] {
  return parts.filter(isGuidePart).map(guideLine);
}

// ---------------------------------------------------------------------------
// The routes

async function load(deps: GuideDeps, id: unknown): Promise<GuideRecord> {
  if (!isUuid(id)) throw new Refusal(400, 'bad_request', 'guide must be a uuid');
  const g = await deps.store.guide(id);
  if (!g) throw new Refusal(404, 'not_found', 'guide not found');
  return g;
}

/** Anyone who may write in the guide's conversation may do it (decision 2). */
async function requireWrite(deps: GuideDeps, g: GuideRecord, userId: string): Promise<void> {
  if ((await deps.chat.chat.threadLevelFor(g.threadId, userId)) !== 'talk') {
    throw new Refusal(403, 'not_allowed', 'you may not write in this conversation');
  }
}

/**
 * A move that changes the card waits for the agent's message to be written:
 * until then each flush of the reply rewrites its parts, card included.
 */
function notWhileWriting(g: GuideRecord): void {
  if (g.messageState === 'working') throw new Refusal(409, 'still_writing', 'the agent is still writing that message');
}

async function addressOf(deps: GuideDeps, g: GuideRecord): Promise<string> {
  const who = await deps.store.identity(g.orgId, g.agentId);
  if (!who) throw new Refusal(404, 'not_found', 'agent not found');
  return agentEmail(who.orgSlug, who.agent);
}

const stepsOf = (history: readonly GuideHistoryEntry[]) =>
  history.filter((e): e is Extract<GuideHistoryEntry, { type: 'step' }> => e.type === 'step').map((e) => e.step);

export interface GuideView {
  id: string;
  threadId: string;
  status: GuideStatus;
  app: string;
  goal: string;
  why: string;
  auth: GuideAuth;
  agentEmail: string;
  /** The step shown last; null before the first (ask for it with POST /guides/:id/step). */
  step: GuideStep | null;
  /** How many steps have been shown, for the progress dots. */
  steps: number;
  /** Whether the caller is an owner and the guide waits for one. */
  mayApprove: boolean;
  blockedReason: string | null;
  undo: string | null;
}

/** What the guide's screen needs. Anyone who may read the conversation may read it. */
export async function getGuide(deps: GuideDeps, userId: string, id: unknown): Promise<GuideView> {
  const g = await load(deps, id);
  if ((await deps.chat.chat.threadLevelFor(g.threadId, userId)) === 'none') throw new Refusal(403, 'not_allowed', 'you may not read this conversation');
  const [address, member] = await Promise.all([addressOf(deps, g), deps.store.membership(g.orgId, userId)]);
  const steps = stepsOf(g.history);
  return {
    id: g.id,
    threadId: g.threadId,
    status: g.status,
    app: g.app,
    goal: g.goal,
    why: g.why,
    auth: g.landing.auth,
    agentEmail: address,
    step: steps.at(-1) ?? null,
    steps: steps.length,
    mayApprove: member?.role === 'owner' && g.status === 'checked',
    blockedReason: g.blockedReason,
    undo: g.undo,
  };
}

/** An answer the guide takes, or null. A text answer is only ever a non-secret field. */
function parseAnswer(raw: unknown): GuideAnswer | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'choice' && typeof raw.option === 'string' && raw.option.length >= 1 && raw.option.length <= 80) {
    return { type: 'choice', option: raw.option };
  }
  if (raw.type === 'confirm' && typeof raw.ok === 'boolean') return { type: 'confirm', ok: raw.ok };
  if (raw.type === 'text' && (raw.field === 'base_url' || raw.field === 'username') && typeof raw.value === 'string') {
    const value = raw.value.trim();
    if (value.length >= 1 && value.length <= 200) return { type: 'text', field: raw.field, value };
  }
  return null;
}

/** A step's body: an optional answer and an optional photo, the photo checked before anything else. */
function stepInput(body: unknown): { answer?: GuideAnswer; photo?: GuidePhoto } {
  if (body !== undefined && !isRecord(body)) throw new Refusal(400, 'bad_request', 'the body must be an object');
  const b = body ?? {};
  const out: { answer?: GuideAnswer; photo?: GuidePhoto } = {};
  if (b.photo !== undefined && b.photo !== null) {
    const photo = (isRecord(b.photo) ? b.photo : {}) as GuidePhoto;
    const valid = validateGuidePhoto(photo);
    if (!valid.ok) throw new Refusal(400, 'bad_photo', valid.message);
    out.photo = { mediaType: photo.mediaType, data: photo.data };
  }
  if (b.answer !== undefined && b.answer !== null) {
    const answer = parseAnswer(b.answer);
    if (!answer) throw new Refusal(400, 'bad_request', 'answer is not one the guide takes');
    out.answer = answer;
  }
  return out;
}

function modelDeps(chat: ChatDeps, g: GuideRecord): GuideModelDeps {
  return {
    orgId: g.orgId,
    agentId: g.agentId,
    aiAccounts: (orgId) => chat.chat.aiAccounts(orgId),
    writerFor: chat.writerFor,
    recordAiUse: (use) => chat.chat.recordAiUse(use),
    costOf: chat.costOf,
  };
}

/**
 * The next step, after the person's answer and with their photo, saved to the
 * history. While the guide is open; and once its check passed, until the
 * closing step (the one with `undo`) is saved. A step that hands over to the
 * catalogue's button ends the guide as `handed_over`; one that hits a wall, as `blocked`.
 */
export async function guideStep(deps: GuideDeps, userId: string, id: unknown, body: unknown): Promise<{ step: GuideStep; status: GuideStatus }> {
  const input = stepInput(body);
  const g = await load(deps, id);
  await requireWrite(deps, g, userId);
  const closing = (g.status === 'checked' || g.status === 'done') && g.undo === null;
  if (g.status !== 'open' && !closing) throw new Refusal(409, 'finished', 'this guide has ended');
  notWhileWriting(g);
  const state = { app: g.app, goal: g.goal, landing: g.landing, agentEmail: await addressOf(deps, g), history: g.history };
  let step: GuideStep;
  try {
    step = await nextStep(modelDeps(deps.chat, g), state, input.answer, input.photo);
  } catch (e) {
    if (e instanceof GuideInputError) throw new Refusal(400, 'bad_photo', e.message);
    console.error('guide step failed', e instanceof Error ? e.name : typeof e);
    throw new Refusal(503, 'no_step', NO_STEP);
  }
  const entries: GuideHistoryEntry[] = [
    ...(input.answer ? [{ type: 'answer' as const, answer: input.answer }] : []),
    ...(input.photo ? [{ type: 'photo' as const }] : []),
    { type: 'step', step },
  ];
  const patch: GuidePatch = { history: [...g.history, ...entries] };
  if (step.done) patch.undo = step.done.undo.slice(0, 1000);
  const handOver = step.blocks.find((b): b is Extract<GuideStep['blocks'][number], { type: 'use_connector' }> => b.type === 'use_connector');
  if (g.status === 'open' && handOver) patch.status = 'handed_over';
  else if (g.status === 'open' && step.blocked) {
    patch.status = 'blocked';
    patch.blockedReason = step.blocked.slice(0, 300);
  }
  if (!(await deps.store.update(g.id, { status: g.status, updatedAt: g.updatedAt }, patch))) {
    throw new Refusal(409, 'conflict', 'someone else moved this guide on; open it again');
  }
  if (patch.status === 'handed_over' && handOver) {
    const by = (await deps.store.membership(g.orgId, userId))?.displayName ?? 'Alguien';
    await deps.store.updateCard(g.messageId, g.id, { status: 'handed_over', connector: handOver.connector, decidedBy: by });
  } else if (patch.status === 'blocked') {
    await deps.store.updateCard(g.messageId, g.id, { status: 'blocked', blockedReason: patch.blockedReason ?? undefined });
  }
  return { step, status: patch.status ?? g.status };
}

/** The check's values: only the fields a guide asks for, as text. Never logged. */
function checkValues(body: unknown): CheckValues {
  const values = isRecord(body) ? body.values : undefined;
  if (!isRecord(values)) throw new Refusal(400, 'bad_request', 'values must be an object');
  const fields: readonly GuideField[] = ['base_url', 'username', 'password', 'token', 'key'];
  const out: CheckValues = {};
  for (const f of fields) {
    const v = values[f];
    if (typeof v === 'string' && v.length <= 2000) out[f] = v;
  }
  return out;
}

/** What the app shows to recognise an access: the user's name, or the key's last four characters. */
function hintOf(auth: GuideAuth, secret: GuidedSecret): string {
  if (auth === 'basic') return secret.username ?? '';
  return `…${(secret.token ?? secret.key ?? '').slice(-4)}`;
}

/** Writes the access for the guide's agent; the credential of an access it replaces goes. */
async function grant(deps: GuideDeps, g: GuideRecord, base: string, secret: GuidedSecret, by: { id: string; name: string }): Promise<void> {
  const settings: GuidedSettings = { base, auth: g.landing.auth, app: g.app, guideId: g.id, ...(g.landing.header ? { headerName: g.landing.header } : {}) };
  const { replacedGuideId } = await deps.accesses.createAccess({
    orgId: g.orgId,
    agentId: g.agentId,
    provider: guidedProvider(g.app),
    hint: hintOf(g.landing.auth, secret),
    settings,
    connectedBy: by.id,
    connectedByName: by.name,
  });
  if (replacedGuideId) await deps.vault.remove(guidedSecretName(g.orgId, replacedGuideId)).catch(() => {});
}

export type CheckOutcome = { ok: true; status: 'checked' | 'done' } | { ok: false; field?: GuideField; message: string };

/**
 * Tries what the person typed against the app. When it works the credential
 * goes to the vault; an owner's check ends the guide with the access written,
 * a member's leaves it `checked` for an owner to approve. When it does not,
 * the answer says why, next to the field that caused it, and nothing is kept.
 */
export async function checkGuide(deps: GuideDeps, userId: string, id: unknown, body: unknown): Promise<CheckOutcome> {
  const values = checkValues(body);
  const g = await load(deps, id);
  await requireWrite(deps, g, userId);
  if (g.status !== 'open') throw new Refusal(409, 'already_done', 'this guide is already done');
  notWhileWriting(g);
  const result = await checkLanding(g.landing, values, deps.fetch ?? fetchPublic, g.app);
  if (!result.ok) return result;
  const got = secretFrom(g.landing.auth, values);
  const base = normaliseBase(values.base_url ?? '', g.landing.suffix ?? '');
  // checkLanding passed on these same values, so both hold; never echo them.
  if ('field' in got || 'error' in base) throw new Refusal(400, 'bad_request', 'the values do not hold');
  const member = await deps.store.membership(g.orgId, userId);
  if (!member) throw new Refusal(403, 'not_allowed', 'you may not write in this conversation');
  const to = member.role === 'owner' ? 'done' : 'checked';
  const claimed = await deps.store.update(
    g.id,
    { status: 'open', updatedAt: g.updatedAt },
    { status: to, completedBy: userId, history: [...g.history, { type: 'checked', base: base.base }] },
  );
  if (!claimed) {
    const now = await deps.store.guide(g.id);
    if (now?.status === 'open') throw new Refusal(409, 'conflict', 'someone else moved this guide on; check again');
    throw new Refusal(409, 'already_done', 'this guide is already done');
  }
  const name = guidedSecretName(g.orgId, g.id);
  try {
    await deps.vault.put(name, JSON.stringify(got.secret), { org_id: g.orgId, provider: guidedProvider(g.app), kind: 'guided' });
    if (to === 'done') await grant(deps, g, base.base, got.secret, { id: userId, name: member.displayName });
  } catch (e) {
    // Back to open, with nothing kept, so the person can check again.
    await deps.vault.remove(name).catch(() => {});
    await deps.store.update(g.id, { status: to }, { status: 'open', completedBy: null, history: g.history }).catch(() => false);
    throw e;
  }
  await deps.store.updateCard(g.messageId, g.id, { status: to, doneBy: member.displayName });
  return { ok: true, status: to };
}

async function decidable(deps: GuideDeps, userId: string, id: unknown) {
  const g = await load(deps, id);
  // Which accounts an agent reaches is an owner's call: anyone else hears the same refusal.
  const owner = await requireOwner(deps.store, g.orgId, userId);
  if (g.status !== 'checked') throw new Refusal(409, 'already_decided', 'this guide was already decided');
  notWhileWriting(g);
  return { g, owner };
}

/** An owner approves a member's grant: the access is written, for the guide's agent only. */
export async function approveGuide(deps: GuideDeps, userId: string, id: unknown): Promise<{ status: 'done' }> {
  const { g, owner } = await decidable(deps, userId, id);
  const base = [...g.history].reverse().find((e): e is Extract<GuideHistoryEntry, { type: 'checked' }> => e.type === 'checked')?.base;
  const secret = secretOf(g.landing.auth, await deps.vault.get(guidedSecretName(g.orgId, g.id)));
  const completedBy = g.completedBy;
  if (!base || !secret || !completedBy) throw new Refusal(409, 'gone', 'the access is no longer kept; the guide has to be done again');
  if (!(await deps.store.update(g.id, { status: 'checked' }, { status: 'done', decidedBy: userId }))) {
    throw new Refusal(409, 'already_decided', 'this guide was already decided');
  }
  try {
    const completer = await deps.store.membership(g.orgId, completedBy);
    await grant(deps, g, base, secret, { id: completedBy, name: completer?.displayName ?? 'Alguien' });
  } catch (e) {
    await deps.store.update(g.id, { status: 'done', notResumed: true }, { status: 'checked', decidedBy: null }).catch(() => false);
    throw e;
  }
  await deps.store.updateCard(g.messageId, g.id, { status: 'done', decidedBy: owner.displayName });
  return { status: 'done' };
}

/** An owner turns a member's grant down: the credential goes, and the card tells the agent. */
export async function rejectGuide(deps: GuideDeps, userId: string, id: unknown): Promise<{ status: 'rejected' }> {
  const { g, owner } = await decidable(deps, userId, id);
  if (!(await deps.store.update(g.id, { status: 'checked' }, { status: 'rejected', decidedBy: userId }))) {
    throw new Refusal(409, 'already_decided', 'this guide was already decided');
  }
  await deps.store.updateCard(g.messageId, g.id, { status: 'rejected', decidedBy: owner.displayName });
  await deps.vault.remove(guidedSecretName(g.orgId, g.id));
  return { status: 'rejected' };
}

/**
 * A done guide, for the agent to go on once (`resumeInThread` in chat.ts).
 * Refused while it is not done (a member's grant waits for an owner), and once it went on.
 */
export async function guideResumable(store: GuideStore, threadId: string, guideId: string): Promise<Resumable> {
  const g = await store.guide(guideId);
  if (!g || g.threadId !== threadId) throw new Refusal(404, 'not_found', 'guide not found');
  if (g.resumedAt) throw new Refusal(409, 'already_done', 'the agent already went on');
  if (g.status !== 'done') throw new Refusal(409, 'not_yet', 'the agent does not have that access yet');
  if (g.messageState === 'working') throw new Refusal(409, 'still_writing', 'the agent is still writing that message');
  return {
    agentId: g.agentId,
    name: g.app,
    ready: async (_agent: ChatAgent) => {},
    claim: (_userId) => store.update(g.id, { status: 'done', notResumed: true }, { resumedAt: new Date().toISOString() }),
    release: async () => {
      await store.update(g.id, { status: 'done' }, { resumedAt: null });
    },
    // The card already says who finished it.
    settle: async () => {},
    memberName: async (userId) => (await store.membership(g.orgId, userId))?.displayName ?? null,
  };
}

// ---------------------------------------------------------------------------
// The store over Supabase

const COLUMNS = 'id, org_id, thread_id, message_id, agent_id, app, goal, why, landing, history, status, blocked_reason, undo, started_by, completed_by, decided_by, resumed_at, updated_at, messages(state)';

/** The GuideStore over Supabase with the service role. */
export function supabaseGuideStore(admin: SupabaseClient): GuideStore {
  const check = <T>(r: { data: T; error: unknown }): T => {
    if (r.error) throw r.error;
    return r.data;
  };
  const columns: Record<keyof GuidePatch, string> = {
    status: 'status',
    history: 'history',
    undo: 'undo',
    blockedReason: 'blocked_reason',
    completedBy: 'completed_by',
    decidedBy: 'decided_by',
    resumedAt: 'resumed_at',
  };
  return {
    async create(g) {
      const r = check(
        await admin
          .from('guides')
          .insert({
            org_id: g.orgId,
            thread_id: g.threadId,
            message_id: g.messageId,
            agent_id: g.agentId,
            app: g.app.slice(0, 80),
            goal: g.goal.slice(0, 200),
            why: g.why,
            landing: g.landing,
            started_by: g.startedBy,
          })
          .select('id')
          .single(),
      );
      if (!r) throw new Error('guide not recorded');
      return r.id as string;
    },
    async guide(id) {
      const r = check(await admin.from('guides').select(COLUMNS).eq('id', id).maybeSingle()) as Record<string, any> | null;
      if (!r) return null;
      const message = Array.isArray(r.messages) ? r.messages[0] : r.messages;
      return {
        id: r.id,
        orgId: r.org_id,
        threadId: r.thread_id,
        messageId: r.message_id,
        agentId: r.agent_id,
        app: r.app,
        goal: r.goal,
        why: r.why,
        landing: r.landing,
        history: Array.isArray(r.history) ? r.history : [],
        status: r.status,
        blockedReason: r.blocked_reason ?? null,
        undo: r.undo ?? null,
        startedBy: r.started_by ?? null,
        completedBy: r.completed_by ?? null,
        decidedBy: r.decided_by ?? null,
        resumedAt: r.resumed_at ?? null,
        updatedAt: r.updated_at,
        messageState: message?.state ?? 'done',
      };
    },
    async update(id, cond, patch) {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) row[columns[k as keyof GuidePatch]] = v;
      let q = admin.from('guides').update(row).eq('id', id).eq('status', cond.status);
      if (cond.updatedAt !== undefined) q = q.eq('updated_at', cond.updatedAt);
      if (cond.notResumed) q = q.is('resumed_at', null);
      const rows = check(await q.select('id')) ?? [];
      return rows.length === 1;
    },
    async updateCard(messageId, guideId, patch) {
      const r = check(await admin.from('messages').select('parts').eq('id', messageId).maybeSingle());
      if (!r) return;
      const parts = (r.parts as MessagePart[]).map((p) => (isGuidePart(p) && p.guideId === guideId ? { ...p, ...patch } : p));
      check(await admin.from('messages').update({ parts }).eq('id', messageId));
    },
    async membership(orgId, userId) {
      const r = check(await admin.from('memberships').select('role, display_name').eq('org_id', orgId).eq('user_id', userId).maybeSingle());
      return r ? { role: r.role, displayName: r.display_name } : null;
    },
    async identity(orgId, agentId) {
      const [agent, org] = await Promise.all([
        admin.from('agents').select('slug, name').eq('id', agentId).eq('org_id', orgId).maybeSingle(),
        admin.from('organizations').select('slug').eq('id', orgId).maybeSingle(),
      ]);
      const a = check(agent);
      const o = check(org);
      if (!a || !o) return null;
      return { orgSlug: o.slug as string, agent: { slug: (a.slug as string | null) ?? null, name: a.name as string } };
    },
  };
}
