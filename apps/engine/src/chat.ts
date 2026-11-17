// Agents talking in the team chat (docs/plans/ongoing/team-chat.md, step 3).
//
// When a person writes in a thread, the app asks the engine to let the
// thread's agent answer. The engine checks that person may talk to the agent
// (it acts with the asker's rights), claims the thread (one reply at a time),
// and writes the reply as it comes: a «working» message with a line of what it
// is doing, its text growing, then «done». Everyone in the thread sees it live.
//
// Today an agent only talks: it has no tools and no access to the record yet,
// and says so when asked for something that needs them.

import { AGENT_JOBS, type AgentGhost, type ChatMessage, messageText, splitMentions } from '@ghostaff/shared';
import { Refusal } from './connections';

export type Level = 'none' | 'read' | 'talk';

export interface ChatAgent {
  id: string;
  orgId: string;
  name: string;
  ghost: AgentGhost;
  department: string;
}

export interface ChatThreadHead {
  id: string;
  orgId: string;
  agentId: string;
  title: string;
}

/** The organisation's AI account, as the engine uses it. */
export type AiAccount = { provider: 'anthropic' } | { provider: 'vertex'; project: string; region: string };

/** The database as the chat needs it (service role). */
export interface ChatStore {
  levelFor(agentId: string, userId: string): Promise<Level>;
  thread(id: string): Promise<ChatThreadHead | null>;
  agent(id: string): Promise<ChatAgent | null>;
  /** All the organisation's agents (to find one brought in by an @mention). */
  orgAgents(orgId: string): Promise<ChatAgent[]>;
  orgName(orgId: string): Promise<string>;
  /** Display names of the organisation's members. */
  memberNames(orgId: string): Promise<string[]>;
  /** The thread's latest messages, oldest first. */
  recentMessages(threadId: string, limit: number): Promise<ChatMessage[]>;
  /** Inserts the agent's «working» message; null when a reply is already being written. */
  startReply(thread: ChatThreadHead, agent: ChatAgent, steps: string[]): Promise<string | null>;
  updateReply(id: string, patch: { text?: string; steps?: string[]; state?: 'working' | 'done' | 'failed' }): Promise<void>;
  touchThread(threadId: string): Promise<void>;
  createThread(orgId: string, agentId: string, title: string, createdBy: string): Promise<string>;
  /** The AI account the organisation's agents use, if one is connected. */
  aiAccount(orgId: string): Promise<AiAccount | null>;
}

export interface ModelTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Streams a model reply; calls `onText` with each piece. */
export type Writer = (req: { system: string; messages: ModelTurn[]; onText: (t: string) => void }) => Promise<void>;

export interface ChatDeps {
  chat: ChatStore;
  /** A writer for this organisation's AI account. */
  writerFor(orgId: string, account: AiAccount): Promise<Writer>;
  /** How often the growing text is written to the database. */
  flushMs?: number;
  now?: () => number;
}

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

const NO_ACCOUNT =
  'Para contestarte necesito una cuenta de IA conectada. Quien es propietario de la empresa puede conectarla en Conexiones.';
const FAILED = 'No he podido contestar ahora. Vuelve a escribirme en un momento.';

/** The agent's standing instructions. Spanish, first person, «tú» (app-design.md #17). */
export function systemPrompt(agent: ChatAgent, orgName: string, broughtInto?: string): string {
  const job = AGENT_JOBS[agent.ghost]?.job ?? '';
  return [
    `Eres ${agent.name}, un agente del equipo de ${orgName} en Ghostaff, en el departamento de ${agent.department}.`,
    job ? `Tu trabajo: ${job}` : '',
    broughtInto
      ? `Te han mencionado en una conversación con ${broughtInto}, otro agente del equipo; contesta a lo que te piden a ti, sin hacer su trabajo.`
      : '',
    'Hablas en una conversación compartida: pueden escribir varias personas de la organización; cada mensaje de una persona empieza con su nombre.',
    'Contesta en español, en primera persona y de tú, breve y concreto, sin fórmulas de cortesía. Usa listas solo si ayudan.',
    'Todavía no tienes acceso al registro de la organización, a su correo ni a otras herramientas. Si te piden algo que lo necesita, dilo claramente y explica qué harías y qué necesitarías.',
    'No inventes datos de la organización. Si no sabes algo, pregúntalo.',
    'Cuando algo necesite la decisión de una persona, dilo de forma explícita.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Which agents answer the thread's last message (team-chat.md, decision 9):
 * none unless a person wrote it; the agents it @mentions, if it mentions any
 * (that is how another agent is brought in); nobody if it mentions only
 * people; otherwise the thread's own agent.
 */
export function whoAnswers(messages: ChatMessage[], threadAgent: ChatAgent, agents: ChatAgent[], memberNames: string[]): ChatAgent[] {
  const last = messages[messages.length - 1];
  if (!last || last.authorKind !== 'person') return [];
  const all = agents.some((a) => a.id === threadAgent.id) ? agents : [threadAgent, ...agents];
  const key = (n: string) => n.toLocaleLowerCase('es');
  const mentioned = splitMentions(messageText(last.parts), [...all.map((a) => a.name), ...memberNames])
    .filter((s) => s.mention)
    .map((s) => key(s.text.slice(1)));
  if (mentioned.length === 0) return [threadAgent];
  const seen = new Set<string>();
  const out: ChatAgent[] = [];
  for (const name of mentioned) {
    const a = all.find((x) => key(x.name) === name);
    if (a && !seen.has(a.id)) {
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

/** The thread as model turns: the agent's own words as the assistant, everyone else's as the user, signed. */
export function toTurns(messages: ChatMessage[], agentId: string): ModelTurn[] {
  const turns: ModelTurn[] = [];
  for (const m of messages) {
    const text = messageText(m.parts).trim();
    if (!text || (m.authorKind === 'agent' && m.state !== 'done')) continue;
    const mine = m.authorKind === 'agent' && m.authorAgentId === agentId;
    const role = mine ? 'assistant' : 'user';
    const content = mine ? text : `${m.authorName}: ${text}`;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) prev.content += `\n\n${content}`;
    else turns.push({ role, content });
  }
  // The conversation starts with a person.
  while (turns[0]?.role === 'assistant') turns.shift();
  return turns;
}

async function requireTalk(deps: ChatDeps, agentId: string, userId: string) {
  if ((await deps.chat.levelFor(agentId, userId)) !== 'talk') throw new Refusal(403, 'not_allowed', 'you may not talk to this agent');
}

/**
 * Writes one reply into the message `replyId`, streaming. Returns when done;
 * never throws (a failure is written into the message).
 */
async function writeReply(
  deps: ChatDeps,
  replyId: string,
  agent: ChatAgent,
  system: string,
  turns: ModelTurn[],
  first = 'Leyendo la conversación',
): Promise<void> {
  const now = deps.now ?? Date.now;
  const flushMs = deps.flushMs ?? 400;
  const started = now();
  let text = '';
  let flushed = 0;
  let pending: Promise<void> = Promise.resolve();
  const steps = [first, 'Escribiendo'];
  try {
    const account = await deps.chat.aiAccount(agent.orgId);
    if (!account) {
      await deps.chat.updateReply(replyId, { text: NO_ACCOUNT, steps: ['Buscando una cuenta de IA'], state: 'done' });
      return;
    }
    const write = await deps.writerFor(agent.orgId, account);
    await deps.chat.updateReply(replyId, { steps });
    await write({
      system,
      messages: turns,
      onText: (t) => {
        text += t;
        if (now() - flushed >= flushMs) {
          flushed = now();
          const snapshot = text;
          pending = pending.then(() => deps.chat.updateReply(replyId, { text: snapshot })).catch(() => {});
        }
      },
    });
    await pending;
    const seconds = Math.max(1, Math.round((now() - started) / 1000));
    await deps.chat.updateReply(replyId, { text: text.trim() || '…', steps: [...steps, `${seconds} s`], state: 'done' });
  } catch (e) {
    console.error('reply failed', e instanceof Error ? e.name : typeof e);
    await pending;
    await deps.chat
      .updateReply(replyId, { text: text.trim() ? `${text.trim()}\n\n${FAILED}` : FAILED, state: 'failed' })
      .catch(() => {});
  }
}

/**
 * Lets the thread's agent (or the agents @mentioned) answer its last message,
 * if they should, each with the rights of the person who asked. Resolves when
 * the replies are written (Cloud Run keeps the CPU only while a request is open).
 */
export async function replyInThread(deps: ChatDeps, userId: string, threadId: unknown): Promise<{ replied: boolean }> {
  if (!isUuid(threadId)) throw new Refusal(400, 'bad_request', 'thread must be a uuid');
  const thread = await deps.chat.thread(threadId);
  if (!thread) throw new Refusal(404, 'not_found', 'thread not found');
  await requireTalk(deps, thread.agentId, userId);
  const agent = await deps.chat.agent(thread.agentId);
  if (!agent) throw new Refusal(404, 'not_found', 'agent not found');

  const [names, orgName, agents] = await Promise.all([
    deps.chat.memberNames(thread.orgId),
    deps.chat.orgName(thread.orgId),
    deps.chat.orgAgents(thread.orgId),
  ]);
  let replied = false;
  let handled: string | null = null;
  // A message written while an agent was answering gets its own answer next
  // (its request found the thread busy); a few rounds at most.
  for (let round = 0; round < 3; round++) {
    const messages = await deps.chat.recentMessages(thread.id, 40);
    const last = messages[messages.length - 1];
    // An empty thread is a new agent's first one: it introduces itself.
    if (messages.length === 0) {
      const replyId = await deps.chat.startReply(thread, agent, ['Presentándome']);
      if (!replyId) break;
      await writeReply(deps, replyId, agent, systemPrompt(agent, orgName), [introTurn(orgName)], 'Presentándome');
      replied = true;
      continue;
    }
    if (!last || last.id === handled) break;
    handled = last.id;
    const responders = whoAnswers(messages, agent, agents, names);
    if (responders.length === 0) break;
    for (const [i, who] of responders.entries()) {
      // An agent the asker may not talk to stays out of it.
      if (who.id !== agent.id && (await deps.chat.levelFor(who.id, userId)) !== 'talk') continue;
      const replyId = await deps.chat.startReply(thread, who, ['Leyendo la conversación']);
      if (!replyId) return { replied }; // a reply is already being written; it will pick this up
      // A second agent reads the first one's answer too.
      const history = i === 0 ? messages : await deps.chat.recentMessages(thread.id, 40);
      const system = systemPrompt(who, orgName, who.id === agent.id ? undefined : agent.name);
      await writeReply(deps, replyId, who, system, toTurns(history, who.id));
      replied = true;
    }
  }
  if (replied) await deps.chat.touchThread(thread.id).catch(() => {});
  return { replied };
}

function introTurn(orgName: string): ModelTurn {
  return {
    role: 'user',
    content:
      `Acabas de incorporarte al equipo de ${orgName}. Preséntate en dos o tres frases: quién eres y qué vas a hacer por la organización. ` +
      'Después propón una primera tarea concreta que podrías empezar ya y termina con una pregunta para arrancar.',
  };
}

/**
 * A new agent's first thread (team-chat.md, decision 8). It opens empty and
 * returns at once; the app then asks for a reply, and in an empty thread the
 * agent introduces itself. Owners only (they are the ones who add agents).
 */
export async function agentHello(deps: ChatDeps, userId: string, agentId: unknown): Promise<{ threadId: string }> {
  if (!isUuid(agentId)) throw new Refusal(400, 'bad_request', 'agent must be a uuid');
  const agent = await deps.chat.agent(agentId);
  if (!agent) throw new Refusal(404, 'not_found', 'agent not found');
  await requireTalk(deps, agent.id, userId);
  const threadId = await deps.chat.createThread(agent.orgId, agent.id, 'Primeros pasos', userId);
  return { threadId };
}
