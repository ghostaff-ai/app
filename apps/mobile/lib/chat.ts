import type { Agent, ChatMessage, ChatThread } from '@ghostaff/shared';
import { isMainAgent } from '@ghostaff/shared/services';
import { shortDate, todayIso } from './format';
import { GHOST_ORDER, type GhostId } from './team';

// The team chat's small rules for the screens (docs/plans/ongoing/team-chat.md).

const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** When a thread last moved: `10:42` today, `ayer`, the weekday this week, else `7 nov`. */
export function shortTime(iso: string, now = new Date()): string {
  const t = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  const days = Math.round((Date.parse(todayIso(now)) - Date.parse(todayIso(t))) / 86_400_000);
  if (days <= 0) return `${p(t.getHours())}:${p(t.getMinutes())}`;
  if (days === 1) return 'ayer';
  if (days < 7) return WEEKDAYS[t.getDay()] ?? shortDate(todayIso(t));
  return shortDate(todayIso(t));
}

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * The pill between days in a chat, as WhatsApp says it (chat-like-whatsapp.md):
 * «Hoy», «Ayer», the weekday within the week, then «12 de noviembre», with the
 * year when it isn't this one. In the phone's own time.
 */
export function dayLabel(iso: string, now = new Date()): string {
  const t = new Date(iso);
  const days = Math.round((Date.parse(todayIso(now)) - Date.parse(todayIso(t))) / 86_400_000);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 7) return DAYS[t.getDay()] ?? '';
  const date = `${t.getDate()} de ${MONTHS_LONG[t.getMonth()]}`;
  return t.getFullYear() === now.getFullYear() ? date : `${date} de ${t.getFullYear()}`;
}

/** Each person's colour in a group (their name, their avatar), the same on every screen. Mid tones, read on light and dark. */
export const PERSON_COLOURS = ['#1D9E75', '#378ADD', '#D4537E', '#BA7517', '#7F77DD', '#D85A30', '#3E8A8A', '#639922'];

export function personColour(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PERSON_COLOURS[h % PERSON_COLOURS.length] ?? PERSON_COLOURS[0]!;
}

/** `10:42`: when a message was written, in the phone's own time, inside its bubble. */
export function timeOf(iso: string): string {
  const t = new Date(iso);
  return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
}

/** One row of a chat's list: a day's pill, where the unread begin, or a message. */
export type ChatRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: string; count: number }
  | {
      kind: 'message';
      key: string;
      message: ChatMessage;
      /** The first of a run by the same author: it carries the tail and, in a group, the name. */
      first: boolean;
      /** Arrived since the person last read the chat. */
      unread: boolean;
    };

/** Same author, same day, within five minutes: one run, as WhatsApp groups them. */
function sameRun(prev: ChatMessage, m: ChatMessage): boolean {
  const same = prev.authorKind === m.authorKind && (prev.authorUserId ?? prev.authorAgentId) === (m.authorUserId ?? m.authorAgentId) && prev.authorName === m.authorName;
  return same && todayIso(new Date(prev.createdAt)) === todayIso(new Date(m.createdAt)) && Date.parse(m.createdAt) - Date.parse(prev.createdAt) <= 5 * 60_000;
}

/**
 * A chat's messages as the list draws them: a pill where each day starts, and
 * «N mensajes sin leer» before the first message someone else wrote after
 * `readAt` (the person's read mark when the chat opened; none, nothing unread).
 */
export function chatRows(messages: ChatMessage[], opts: { me?: string; readAt?: string | null; now?: Date } = {}): ChatRow[] {
  const rows: ChatRow[] = [];
  const isNew = (m: ChatMessage) => !!opts.readAt && Date.parse(m.createdAt) > Date.parse(opts.readAt) && !(m.authorKind === 'person' && m.authorUserId === opts.me);
  const firstNew = opts.readAt ? messages.findIndex(isNew) : -1;
  const unreadCount = firstNew < 0 ? 0 : messages.slice(firstNew).filter(isNew).length;
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    const day = todayIso(new Date(m.createdAt));
    if (!prev || todayIso(new Date(prev.createdAt)) !== day) rows.push({ kind: 'day', key: `day-${day}`, label: dayLabel(m.createdAt, opts.now) });
    if (i === firstNew) rows.push({ kind: 'unread', key: 'unread', count: unreadCount });
    rows.push({ kind: 'message', key: m.id, message: m, first: !prev || i === firstNew || !sameRun(prev, m), unread: firstNew >= 0 && i >= firstNew && isNew(m) });
  });
  return rows;
}

/** Whether each message shows its author: not when it follows the same author within five minutes. */
export function showAuthors(messages: ChatMessage[]): boolean[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    if (!prev) return true;
    const same = prev.authorKind === m.authorKind && (prev.authorUserId ?? prev.authorAgentId) === (m.authorUserId ?? m.authorAgentId) && prev.authorName === m.authorName;
    return !same || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > 5 * 60_000;
  });
}

/** A row in Equipo: an agent, opening its chat (`last` is that chat, with its newest word). */
export interface TeamRow {
  agent: Agent;
  last: ChatThread | null;
  unread: boolean;
}

/**
 * Equipo's list (three-tabs.md, decision 4): one row per agent, as in WhatsApp,
 * each its one chat, shared by everyone who may see the agent
 * (group-chat-per-agent.md). The main agent first, then whatever moved last,
 * then the quiet agents in the team's order.
 */
export function teamRows(agents: Agent[], threads: ChatThread[]): TeamRow[] {
  const rows: TeamRow[] = agents.map((agent) => {
    const last = threads.find((t) => t.agentId === agent.id && t.lastText !== null) ?? null;
    return { agent, last, unread: last?.unread ?? false };
  });
  const order = (r: TeamRow) => GHOST_ORDER.indexOf(r.agent.ghost);
  return rows.sort((a, b) => {
    const main = Number(isMainAgent(b.agent)) - Number(isMainAgent(a.agent));
    if (main) return main;
    if (a.last && b.last) return b.last.lastMessageAt.localeCompare(a.last.lastMessageAt);
    if (a.last || b.last) return a.last ? -1 : 1;
    return order(a) - order(b) || a.agent.name.localeCompare(b.agent.name);
  });
}

/**
 * General's chat for Equipo (general-chat.md): the people's chat, pinned
 * first, once the organisation has someone to talk to (two people or more).
 * Alone there is nobody, so no row; the same in a company and a personal space.
 */
export function generalChat(threads: ChatThread[], people: number): ChatThread | null {
  if (people < 2) return null;
  return threads.find((t) => t.kind === 'general') ?? null;
}

/** A voice note's length as WhatsApp shows it: `0:38`, `12:05`. */
export function noteLength(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** An agent's chat's last line for Equipo: «Bea: hoy la cierro yo», or the agent's own words unsigned. */
export function agentLastLine(agentName: string, t: ChatThread | null): string | null {
  if (!t?.lastText) return null;
  return t.lastAuthor && t.lastAuthor !== agentName ? `${t.lastAuthor}: ${t.lastText}` : t.lastText;
}

/** General's last line: «Ana: Nota de voz · 0:38» for a voice note (its transcript stays folded), else «Ana: hola». */
export function generalLastLine(t: ChatThread): string | null {
  const said = t.lastVoiceMs !== null ? `Nota de voz · ${noteLength(t.lastVoiceMs)}` : t.lastText;
  if (!said) return null;
  return t.lastAuthor ? `${t.lastAuthor}: ${said}` : said;
}

/** The ids of the agents among `names` (a voice note's tags; people's names are left out). */
export function agentIdsNamed(agents: Agent[], names: string[]): string[] {
  const key = (n: string) => n.toLocaleLowerCase('es');
  const wanted = new Set(names.map(key));
  return agents.filter((a) => wanted.has(key(a.name))).map((a) => a.id);
}

/** «Álvaro está escribiendo…», «Álvaro y Bea están grabando un audio…»: the header's line while others type. */
export function typingLine(others: Array<{ name: string; kind: 'typing' | 'recording' }>): string | null {
  if (others.length === 0) return null;
  const names = others.map((o) => o.name || 'Alguien');
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
  const recording = others.every((o) => o.kind === 'recording');
  const verb = others.length === 1 ? (recording ? 'está grabando un audio' : 'está escribiendo') : recording ? 'están grabando un audio' : 'están escribiendo';
  return `${who} ${verb}…`;
}

/** The first web link in a text, for its preview. */
export function firstLink(text: string): string | null {
  return text.match(/https?:\/\/[^\s<>"')]+/)?.[0]?.replace(/[.,;:!?]+$/, '') ?? null;
}

/** One emoji: a pictograph (with its modifiers and joiners) or a flag, i.e. a pair of regional indicators. */
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})/u;
const GRAPHEME = /\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|\P{M}\p{M}*/gu;

/** Splits a text into user-perceived characters; Hermes may lack Intl.Segmenter, so a regex stands in. */
function graphemes(text: string): string[] {
  const Segmenter = (Intl as { Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment: (s: string) => Iterable<{ segment: string }> } }).Segmenter;
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (s) => s.segment);
  return text.match(GRAPHEME) ?? [];
}

/** A text of one to three emoji and nothing else but whitespace: WhatsApp draws it big, without a bubble. */
export function emojiOnly(text: string): boolean {
  const parts = graphemes(text.trim());
  return parts.length >= 1 && parts.length <= 3 && parts.every((g) => EMOJI.test(g));
}

/** The team's jobs nobody does yet, in the order the team is drawn (team-chat.md, decision 8). */
export function vacancies(agents: Agent[]): GhostId[] {
  const taken = new Set(agents.map((a) => a.ghost));
  return GHOST_ORDER.filter((g) => g !== 'base' && !taken.has(g));
}
