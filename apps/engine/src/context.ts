// What a chat agent reads on each turn (docs/plans/ongoing/agent-context.md).
//
// An agent has one chat that grows without end, and people never open a new
// one, so a turn never carries the whole conversation: it carries a summary of
// everything older, the latest messages word for word, and a tool to search the
// rest. Once the latest messages pass RECENT_BUDGET, after a reply, the summary
// is rewritten by the organisation's own AI account (a key, Vertex AI or the
// Claude subscription, through the same Writer as a reply) and kept in
// Postgres, one per agent and conversation.
//
// Sizes are estimated (characters ÷ 3, near what Spanish costs) rather than
// counted: the subscription has no token-counting call, and a turn needs no
// more than a bound.

import { audioLines, type ChatMessage, type Limits, messageText, type TokenUsage } from '@ghostaff/shared';
import { isDecisionPart, isDecisionQuotePart, isForwardPart, isQuotePart } from '@ghostaff/shared';
import { askLines } from './accountAsks';
import { AiFailure, type AiAccount, type AiUse, type ChatAgent, type ChatDeps, type ChatThreadHead, failureKind, recordUse } from './chat';
import { type DecisionBrief, decisionLine } from './decisionAsks';
import { guideLines } from './guides';
import { type AgentTools, clip, NO_TOOLS, type ToolOutcome } from './tools';

/** Past this, after a reply, the summary is rewritten. Jaime, 2026-11-26 (decision 2). */
export const RECENT_BUDGET = 30_000;
/** The newest messages a new summary leaves out, so the next turn still reads the last exchanges word for word. */
export const KEEP_VERBATIM = 10_000;
/** The most a turn carries while the summary is behind (one that failed): the older messages wait for it, searchable. */
export const TURN_CEILING = 60_000;
/** The most one summary pass reads: a longer backlog is summarised over several replies, oldest first. */
export const SUMMARY_PASS = 150_000;

export const estimateTokens = (text: string): number => Math.ceil(text.length / 3);

/** A conversation's summary, as the engine keeps it: what it says, and the newest message it covers. */
export interface ConversationSummary {
  text: string;
  throughAt: string;
  throughMessage: string;
}

/** What an agent has of a conversation: its summary, if any, and every message after it, oldest first. */
export interface Conversation {
  summary: ConversationSummary | null;
  messages: ChatMessage[];
}

/** A message the search found. */
export interface FoundMessage {
  id: string;
  authorKind: 'person' | 'agent';
  authorName: string;
  authorAgentId: string | null;
  createdAt: string;
  text: string;
}

export interface MessageQuery {
  /** Every one must be in the text, case and accents aside; none for any. */
  words: string[];
  since: string | null;
  until: string | null;
  max: number;
}

/** The database as summaries and search need it (service role). */
export interface ContextStore {
  conversation(threadId: string, agentId: string): Promise<Conversation>;
  /** Keeps it only if it reaches further than the one stored; true when kept. */
  saveSummary(s: { threadId: string; agentId: string } & ConversationSummary): Promise<boolean>;
  /** Newest first. */
  searchMessages(threadId: string, q: MessageQuery): Promise<FoundMessage[]>;
  aiAccounts(orgId: string): Promise<AiAccount[]>;
  recordAiUse(use: AiUse): Promise<void>;
}

/** «mié 26 nov 2026, 10:30», in Madrid: when something was said; empty for a time that isn't one. */
export function stampOf(iso: string): string {
  if (Number.isNaN(Date.parse(iso))) return '';
  const parts = new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => (parts.find((p) => p.type === t)?.value ?? '').replace(/\.$/, '');
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}, ${get('hour')}:${get('minute')}`;
}

/**
 * What the model reads of one message: a decision a person asks about before
 * their words, then the text, then the cards the agent left (an account or a
 * guide it asked for, a decision it asked for) as lines.
 */
export function bodyOf(m: ChatMessage, briefs: ReadonlyMap<string, DecisionBrief> = new Map()): string {
  if (m.deletedAt) return '';
  const replying = m.parts.filter(isQuotePart).map((p) => `[En respuesta a ${p.authorName}: «${p.kind === 'voice' && !p.text ? 'una nota de voz' : p.text}»]`);
  const forwarded = m.parts
    .filter(isForwardPart)
    .map((p) => `[Reenviado desde ${p.from}, de ${p.authorName}${stampOf(p.at) ? ` (${stampOf(p.at)})` : ''}${p.kind === 'voice' ? ', nota de voz' : ''}: «${p.text}»]`);
  const quoted = [...replying, ...forwarded, ...m.parts.filter(isDecisionQuotePart).map((p) => decisionLine(briefs.get(p.decisionId), 'quoted', p.question))];
  const asked = m.parts.filter(isDecisionPart).map((p) => decisionLine(briefs.get(p.decisionId), 'mine', p.question));
  return [...quoted, messageText(m.parts).trim(), ...audioLines(m.parts), ...askLines(m.parts), ...guideLines(m.parts), ...asked].filter(Boolean).join('\n\n');
}

/** How a message is signed for the agent: its own as «Tú», anyone else's with their name and when. */
function signed(m: ChatMessage, agentId: string): string {
  return m.authorKind === 'agent' && m.authorAgentId === agentId ? 'Tú' : personOf(m);
}

/** «Ana (mié 26 nov 2026, 10:30)»: who wrote a message and when, as the agent reads it. */
export function personOf(m: Pick<ChatMessage, 'authorName' | 'createdAt'>): string {
  const when = stampOf(m.createdAt);
  return when ? `${m.authorName} (${when})` : m.authorName;
}

const tokensOf = (m: ChatMessage) => estimateTokens(`${m.authorName} (${m.createdAt}): ${bodyOf(m)}`);

/** The messages a turn carries: every one after the summary, or the newest under TURN_CEILING (always the last). */
export function windowOf(messages: ChatMessage[], ceiling = TURN_CEILING): ChatMessage[] {
  let used = 0;
  let from = messages.length;
  while (from > 0) {
    const next = used + tokensOf(messages[from - 1]!);
    if (next > ceiling && from < messages.length) break;
    used = next;
    from -= 1;
  }
  return messages.slice(from);
}

/**
 * Which messages a new summary should take in, or null when the latest
 * messages still fit RECENT_BUDGET: the oldest, up to the first reply still
 * being written, leaving at least KEEP_VERBATIM out, at most SUMMARY_PASS.
 */
export function toFold(messages: ChatMessage[]): ChatMessage[] | null {
  const sizes = messages.map(tokensOf);
  const all = sizes.reduce((a, b) => a + b, 0);
  if (all <= RECENT_BUDGET) return null;
  let rest = all;
  let folded = 0;
  let k = 0;
  while (k < messages.length && messages[k]!.state !== 'working') {
    const size = sizes[k]!;
    if (rest - size < KEEP_VERBATIM || (k > 0 && folded + size > SUMMARY_PASS)) break;
    rest -= size;
    folded += size;
    k += 1;
  }
  return k > 0 ? messages.slice(0, k) : null;
}

/** The turn that opens a conversation with a summary: up to when it goes, and how to find the detail. */
export function summaryTurn(s: ConversationSummary): string {
  return (
    `[Resumen de esta conversación hasta el ${stampOf(s.throughAt)}. Los mensajes anteriores no los ves; ` +
    `si necesitas el detalle de algo, búscalo con ${CONVERSATION_TOOL}.]\n\n${s.text}`
  );
}

const SUMMARY_SYSTEM = [
  'Resumes la conversación de un agente de Ghostaff con las personas de su organización, para que el agente la siga sin leerla entera. El resumen es para el agente: escríbele de tú («te pidieron…, quedaste en…»).',
  'Conserva, con fechas: quién pidió qué; lo que se decidió y quién lo decidió; lo que el agente prometió o tiene pendiente; las instrucciones y preferencias que dieron las personas; cifras, nombres, cuentas, enlaces y datos concretos; lo que quedó sin resolver.',
  'Quita saludos, rodeos y lo que ya no importa. No inventes nada ni añadas consejos.',
  'Si hay un resumen anterior, intégralo: el tuyo lo sustituye entero.',
  'Escribe en español, como mucho unas 1.500 palabras, con listas cortas si ayudan. Devuelve solo el resumen, sin introducción.',
].join('\n');

/** The one turn the summariser reads: the previous summary, then the messages it folds in, signed. */
export function summaryPrompt(previous: ConversationSummary | null, fold: ChatMessage[], agentId: string, briefs?: ReadonlyMap<string, DecisionBrief>): string {
  const lines = fold
    .filter((m) => !(m.authorKind === 'agent' && m.state === 'working'))
    .map((m) => [m, bodyOf(m, briefs)] as const)
    .filter(([, body]) => body)
    .map(([m, body]) => `${signed(m, agentId)}: ${body}`);
  return [
    previous ? `El resumen anterior, hasta el ${stampOf(previous.throughAt)}:\n<resumen>\n${previous.text}\n</resumen>\n` : '',
    'Los mensajes que siguen, en orden («Tú» es el agente):',
    '<conversacion>',
    lines.join('\n\n'),
    '</conversacion>',
    '',
    'Escribe el resumen de toda la conversación hasta el último de estos mensajes.',
  ]
    .filter((l, i) => i > 0 || l)
    .join('\n');
}

export type SummaryDeps = Pick<ChatDeps, 'writerFor' | 'costOf' | 'decisions'> & { chat: ContextStore };

/**
 * After a reply: when the latest messages pass RECENT_BUDGET, folds the oldest
 * into a new summary with the organisation's AI accounts, in their order, and
 * keeps it. Never throws: a failed summary leaves the old one, and the turn
 * carries the newest messages under TURN_CEILING meanwhile.
 */
export async function summarizeIfLong(deps: SummaryDeps, thread: ChatThreadHead, agent: ChatAgent): Promise<void> {
  try {
    const conversation = await deps.chat.conversation(thread.id, agent.id);
    const fold = toFold(conversation.messages);
    if (!fold) return;
    const last = fold[fold.length - 1]!;
    const prompt = summaryPrompt(conversation.summary, fold, agent.id);
    const text = await writeOnce(deps, { orgId: agent.orgId, agentId: agent.id }, SUMMARY_SYSTEM, prompt);
    if (!text) return;
    await deps.chat.saveSummary({ threadId: thread.id, agentId: agent.id, text, throughAt: last.createdAt, throughMessage: last.id });
  } catch (e) {
    console.error('summary not written', e instanceof Error ? e.message.slice(0, 200) : typeof e);
  }
}

/**
 * One text the engine writes for itself (a summary), with the organisation's
 * AI accounts in their order, no tools: from the first account that writes it;
 * empty when none could. Each try is recorded against `who`.
 */
export async function writeOnce(
  deps: Pick<SummaryDeps, 'writerFor' | 'costOf'> & { chat: Pick<ContextStore, 'aiAccounts' | 'recordAiUse'> },
  who: { orgId: string; agentId: string | null },
  system: string,
  prompt: string,
): Promise<string> {
  const accounts = await deps.chat.aiAccounts(who.orgId);
  for (const [i, account] of accounts.entries()) {
    let text = '';
    const got: { usage: { model: string; tokens: TokenUsage; limits: Limits | null } | null } = { usage: null };
    try {
      const write = await deps.writerFor(who.orgId, account, { busyFails: i < accounts.length - 1 });
      await write({
        system,
        messages: [{ role: 'user', content: prompt }],
        tools: NO_TOOLS,
        onText: (t) => {
          text += t;
        },
        onTool: () => {},
        onUsage: (u) => {
          got.usage = u;
        },
      });
      await recordUse(deps.chat, deps.costOf, who, account, 'ok', got.usage);
      return text.trim();
    } catch (e) {
      const kind = failureKind(e);
      console.warn('summary account failed', account.provider, kind, e instanceof Error ? e.message.slice(0, 200) : typeof e);
      if (kind !== 'busy') await recordUse(deps.chat, deps.costOf, who, account, kind, got.usage, e instanceof AiFailure ? e.limits : null);
    }
  }
  return '';
}

/** The tool an agent searches its conversation with. */
export const CONVERSATION_TOOL = 'conversation_search';
const MAX_FOUND = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** When a day starts in Madrid, as an instant: «2026-12-01» → 2026-11-30T23:00:00.000Z. */
export function madridDayStart(day: string): string {
  const noon = new Date(`${day}T12:00:00Z`);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'longOffset' })
    .formatToParts(noon)
    .find((p) => p.type === 'timeZoneName')?.value; // «GMT+01:00»
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(offset ?? '');
  const minutes = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return new Date(Date.parse(`${day}T00:00:00Z`) - minutes * 60_000).toISOString();
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** How a search tool over one chat presents itself to the model. */
interface SearchFace {
  name: string;
  description: string;
  step: string;
  /** What it says when nothing matches. */
  none: string;
}

/**
 * The search over the conversation the agent answers in, and nothing else: by
 * words, by Madrid days, or both. It reads Ghostaff's own messages, so it
 * writes nothing and needs no approval.
 */
export function conversationTools(store: Pick<ContextStore, 'searchMessages'>, threadId: string, agentId: string): AgentTools {
  return searchTools(store, threadId, agentId, {
    name: CONVERSATION_TOOL,
    description:
      'Busca en los mensajes anteriores de esta conversación (lo que ya no ves: solo ves un resumen y los últimos mensajes). ' +
      'Úsalo cuando necesites el detalle exacto de algo que se dijo antes: una cifra, un nombre, una instrucción, quién pidió qué. ' +
      'Busca por palabras (todas deben aparecer, sin importar mayúsculas ni tildes), por días, o por ambas. Devuelve hasta 20 mensajes, del más antiguo al más reciente.',
    step: 'Buscando en la conversación',
    none: 'Nada en esta conversación con eso.',
  });
}

/** A search over one chat's messages (`threadId`), by words, by Madrid days, or both. */
export function searchTools(store: Pick<ContextStore, 'searchMessages'>, threadId: string, agentId: string, face: SearchFace): AgentTools {
  return {
    specs: [
      {
        name: face.name,
        description: face.description,
        input_schema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Palabras que deben aparecer en el mensaje, separadas por espacios. Pocas y concretas.' },
            from: { type: 'string', description: 'Primer día, AAAA-MM-DD, hora de Madrid.' },
            to: { type: 'string', description: 'Último día, AAAA-MM-DD, incluido.' },
          },
        },
      },
    ],
    accounts: [],
    stepFor: () => face.step,
    writes: () => false,
    actionFor: (name) => name,
    run: async (name, input): Promise<ToolOutcome> => {
      if (name !== face.name) return NO_TOOLS.run(name, input);
      const i = (typeof input === 'object' && input !== null ? input : {}) as { query?: unknown; from?: unknown; to?: unknown };
      const words = typeof i.query === 'string' ? i.query.split(/\s+/).filter(Boolean).slice(0, 8) : [];
      const from = typeof i.from === 'string' && i.from ? i.from : null;
      const to = typeof i.to === 'string' && i.to ? i.to : null;
      if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return { content: 'Las fechas van como AAAA-MM-DD.', isError: true };
      if (words.length === 0 && !from && !to) return { content: 'Di qué palabras buscar, o entre qué días.', isError: true };
      const found = await store.searchMessages(threadId, {
        words,
        since: from ? madridDayStart(from) : null,
        until: to ? madridDayStart(nextDay(to)) : null,
        max: MAX_FOUND,
      });
      if (found.length === 0) return { content: face.none, isError: false };
      const lines = [...found]
        .reverse()
        .map((m) => `[${stampOf(m.createdAt)}] ${m.authorKind === 'agent' && m.authorAgentId === agentId ? 'Tú' : m.authorName}: ${m.text.length > 1500 ? `${m.text.slice(0, 1500)}…` : m.text}`);
      return { content: clip(`${found.length} mensajes, del más antiguo al más reciente:\n\n${lines.join('\n\n')}`), isError: false };
    },
  };
}
