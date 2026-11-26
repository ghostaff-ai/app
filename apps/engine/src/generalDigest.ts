// What the agents learn from General, the people's chat
// (docs/plans/ready/general-chat.md, decision 2): once a day ends in Madrid,
// the tick summarises what the organisation's people said there that day,
// with the organisation's own AI accounts; every agent then reads the latest
// summaries, and a chat agent can search General for the detail.
//
// The summaries live in `general_digests` (engine only). A day is summarised
// once; a failed one is tried again on the next tick; a tick catches up on the
// last week at most, a few days at a time.

import type { ChatMessage } from '@ghostaff/shared';
import { messageFromRow } from '@ghostaff/shared/services';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChatDeps } from './chat';
import { bodyOf, type ContextStore, madridDayStart, searchTools, writeOnce } from './context';
import type { AgentTools } from './tools';

/** One day of General, summarised. */
export interface GeneralDigest {
  /** The Madrid day, AAAA-MM-DD. */
  day: string;
  summary: string;
}

/** The database as the daily summary needs it (service role). */
export interface GeneralStore extends Pick<ContextStore, 'searchMessages'> {
  /** The organisation's General, or null. */
  chatOf(orgId: string): Promise<string | null>;
  /** The latest summaries, newest first. */
  digests(orgId: string, limit: number): Promise<GeneralDigest[]>;
  /** Each organisation's General with messages on a Madrid day in [since, until) and no summary yet, oldest first. */
  due(since: string, until: string): Promise<Array<{ orgId: string; threadId: string; day: string }>>;
  /** General's messages in [from, to), oldest first. */
  messagesBetween(threadId: string, from: string, to: string): Promise<ChatMessage[]>;
  /** Keeps it unless the day already has one. */
  saveDigest(d: { orgId: string; day: string; summary: string; throughMessage: string }): Promise<void>;
}

/** How many days back a tick catches up on, and how many summaries it writes at most. */
export const CATCH_UP_DAYS = 7;
export const PER_TICK = 3;
/** How many daily summaries an agent reads. */
export const DIGESTS_READ = 7;
/** A day with nothing worth keeping is saved as this, so it isn't tried again. */
export const NOTHING = 'Sin nada relevante.';

/** Today in Madrid, AAAA-MM-DD. */
export function madridToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

/** «miércoles 26 de noviembre»: a day as a person says it. */
export function dayName(day: string): string {
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${day}T12:00:00Z`));
}

const DIGEST_SYSTEM = [
  'Resumes lo que hablaron un día las personas de una organización en General, su chat interno, casi siempre con notas de voz (lees su transcripción). Lo leerán los agentes de la organización para estar al día de lo que piensan y deciden las personas.',
  'Conserva, diciendo quién: lo que se decidió; lo que quedó pendiente y de quién; datos concretos (cifras, nombres, fechas, clientes, proveedores, enlaces); planes, ideas y preocupaciones que se plantearon; lo que se pidió a algún agente.',
  'Quita saludos, bromas y charla sin contenido. No inventes nada ni añadas consejos.',
  `Escribe en español, como mucho unas 400 palabras, con listas cortas si ayudan. Devuelve solo el resumen, sin introducción. Si no se habló de nada que importe, devuelve exactamente: ${NOTHING}`,
].join('\n');

/** The one turn the summariser reads: the day's messages, each signed with who and when. */
export function digestPrompt(day: string, messages: ChatMessage[]): string {
  const time = (iso: string) => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const lines = messages
    .filter((m) => !(m.authorKind === 'agent' && m.state === 'working'))
    .map((m) => [m, bodyOf(m)] as const)
    .filter(([, body]) => body)
    .map(([m, body]) => `${m.authorName} (${time(m.createdAt)}): ${body}`);
  return [`Lo que se habló en General el ${dayName(day)}, en orden:`, '<general>', lines.join('\n\n'), '</general>', '', 'Escribe el resumen de ese día.'].join('\n');
}

export type DigestDeps = Pick<ChatDeps, 'writerFor' | 'costOf'> & {
  chat: Pick<ContextStore, 'aiAccounts' | 'recordAiUse'>;
  general: GeneralStore;
  now?: () => Date;
};

/**
 * The tick's part: summarises the finished days of General that have none,
 * oldest first, at most PER_TICK. Returns how many it wrote. Never throws: a
 * day that fails stays due for the next tick.
 */
export async function digestDue(deps: DigestDeps): Promise<number> {
  const now = deps.now ? deps.now() : new Date();
  const today = madridToday(now);
  let due: Array<{ orgId: string; threadId: string; day: string }>;
  try {
    due = await deps.general.due(madridDayStart(shiftDay(today, -CATCH_UP_DAYS)), madridDayStart(today));
  } catch (e) {
    console.error('general digests not listed', e instanceof Error ? e.message.slice(0, 200) : typeof e);
    return 0;
  }
  let written = 0;
  for (const d of due.slice(0, PER_TICK)) {
    try {
      const messages = await deps.general.messagesBetween(d.threadId, madridDayStart(d.day), madridDayStart(shiftDay(d.day, 1)));
      const last = messages[messages.length - 1];
      if (!last) continue;
      const summary = await writeOnce(deps, { orgId: d.orgId, agentId: null }, DIGEST_SYSTEM, digestPrompt(d.day, messages));
      if (!summary) continue; // no account could write it: due again next tick
      await deps.general.saveDigest({ orgId: d.orgId, day: d.day, summary, throughMessage: last.id });
      written += 1;
    } catch (e) {
      console.error('general digest not written', e instanceof Error ? e.message.slice(0, 200) : typeof e);
    }
  }
  return written;
}

/** The tool a chat agent searches General with. */
export const GENERAL_TOOL = 'general_search';

/**
 * What every agent is told about General: the latest daily summaries, newest
 * first, and that it is the team's own talk. Empty when there is none.
 */
export function heardBlock(orgName: string, digests: GeneralDigest[], canSearch: boolean): string {
  const said = digests.filter((d) => d.summary.trim() !== NOTHING);
  if (said.length === 0) return '';
  return [
    `Lo que han hablado las personas de ${orgName} en General, su chat interno, resumido por días (del más reciente al más antiguo). ` +
      'Úsalo para estar al día de lo que deciden y les preocupa. Es interno: nunca lo cites ni lo cuentes a nadie de fuera de la organización.' +
      (canSearch ? ` Si necesitas el detalle exacto de algo, búscalo con ${GENERAL_TOOL}.` : ''),
    '<general>',
    said.map((d) => `## ${dayName(d.day)}\n${d.summary.trim()}`).join('\n\n'),
    '</general>',
  ].join('\n');
}

/** The search over General's messages, for a chat agent that isn't answering there. */
export function generalTools(store: Pick<ContextStore, 'searchMessages'>, threadId: string, agentId: string): AgentTools {
  return searchTools(store, threadId, agentId, {
    name: GENERAL_TOOL,
    description:
      'Busca en General, el chat interno donde hablan entre ellas las personas de la organización (casi todo notas de voz transcritas). ' +
      'Úsalo cuando necesites el detalle exacto de algo que dijeron: una cifra, un nombre, una decisión, quién dijo qué. ' +
      'Busca por palabras (todas deben aparecer, sin importar mayúsculas ni tildes), por días, o por ambas. Devuelve hasta 20 mensajes, del más antiguo al más reciente.',
    step: 'Buscando en General',
    none: 'Nada en General con eso.',
  });
}

const MESSAGE_COLUMNS = 'id, thread_id, author_kind, author_user, author_agent, author_name, parts, state, steps, routine_id, reply_to, created_at';

export function supabaseGeneralStore(admin: SupabaseClient, search: ContextStore['searchMessages']): GeneralStore {
  const check = <T>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  return {
    searchMessages: search,
    async chatOf(orgId) {
      const row = check(await admin.from('threads').select('id').eq('org_id', orgId).eq('kind', 'general').maybeSingle());
      return (row as { id: string } | null)?.id ?? null;
    },
    async digests(orgId, limit) {
      const rows = check(await admin.from('general_digests').select('day, summary').eq('org_id', orgId).order('day', { ascending: false }).limit(limit));
      return ((rows ?? []) as Array<{ day: string; summary: string }>).map((r) => ({ day: r.day, summary: r.summary }));
    },
    async due(since, until) {
      const rows = check(await admin.rpc('general_digests_due', { since, until }));
      return ((rows ?? []) as Array<{ org_id: string; thread_id: string; day: string }>).map((r) => ({ orgId: r.org_id, threadId: r.thread_id, day: r.day }));
    },
    async messagesBetween(threadId, from, to) {
      const rows = check(
        await admin.from('messages').select(MESSAGE_COLUMNS).eq('thread_id', threadId).gte('created_at', from).lt('created_at', to).order('created_at').limit(2000),
      );
      return ((rows ?? []) as Parameters<typeof messageFromRow>[0][]).map(messageFromRow);
    },
    async saveDigest(d) {
      check(
        await admin
          .from('general_digests')
          .upsert({ org_id: d.orgId, day: d.day, summary: d.summary.slice(0, 20000), through_message: d.throughMessage }, { onConflict: 'org_id,day', ignoreDuplicates: true }),
      );
    },
  };
}
