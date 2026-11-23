import type { Agent, AgentLevel, ChatMessage, ChatThread, ConversationVisibility } from '@ghostaff/shared';
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

/** Whether each message shows its author: not when it follows the same author within five minutes. */
export function showAuthors(messages: ChatMessage[]): boolean[] {
  return messages.map((m, i) => {
    const prev = messages[i - 1];
    if (!prev) return true;
    const same = prev.authorKind === m.authorKind && (prev.authorUserId ?? prev.authorAgentId) === (m.authorUserId ?? m.authorAgentId) && prev.authorName === m.authorName;
    return !same || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > 5 * 60_000;
  });
}

/**
 * A row in Equipo: an agent, opening the person's chat with it (`last` is that
 * chat, with its newest word), or a titled conversation they follow, opening it.
 */
export type TeamRow =
  | { kind: 'agent'; agent: Agent; last: ChatThread | null; unread: boolean }
  | { kind: 'conversation'; agent: Agent; last: ChatThread; unread: boolean };

/**
 * Equipo's list (three-tabs.md, decision 4): one row per agent, as in WhatsApp,
 * and one per titled conversation the person follows, like a group
 * (chat-permissions.md, decision 3). The main agent first, then whatever moved
 * last, then the quiet agents in the team's order.
 */
export function teamRows(agents: Agent[], threads: ChatThread[]): TeamRow[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const rows: TeamRow[] = agents.map((agent) => {
    const last = threads.find((t) => t.agentId === agent.id && t.personal && t.lastText !== null) ?? null;
    return { kind: 'agent', agent, last, unread: last?.unread ?? false };
  });
  for (const t of threads) {
    const agent = byId.get(t.agentId);
    if (agent && !t.personal && t.following) rows.push({ kind: 'conversation', agent, last: t, unread: t.unread });
  }
  const order = (r: TeamRow) => GHOST_ORDER.indexOf(r.agent.ghost);
  const isMain = (r: TeamRow) => r.kind === 'agent' && isMainAgent(r.agent);
  return rows.sort((a, b) => {
    const main = Number(isMain(b)) - Number(isMain(a));
    if (main) return main;
    if (a.last && b.last) return b.last.lastMessageAt.localeCompare(a.last.lastMessageAt);
    if (a.last || b.last) return a.last ? -1 : 1;
    return order(a) - order(b) || a.agent.name.localeCompare(b.agent.name);
  });
}

// Who reads and writes a conversation (chat-permissions.md).

/** The three choices, as the picker names them. */
export const VISIBILITY_NAMES: Record<ConversationVisibility, string> = {
  private: 'Solo yo',
  read: 'El equipo puede leer',
  write: 'El equipo puede escribir',
};

/** What each choice means, under its name. */
export function visibilityHint(v: ConversationVisibility, agentName: string): string {
  if (v === 'private') return 'Nadie más la ve, tampoco quien es propietario.';
  if (v === 'read') return `La lee quien tiene acceso a ${agentName}. Solo tú escribes.`;
  return `Escribe quien puede hablar con ${agentName}; el resto la lee.`;
}

/** A conversation's tag in a list: whether it is only the person's. */
export const visibilityTag = (v: ConversationVisibility) => (v === 'private' ? 'Solo tú' : 'Compartida');

/** The line under a conversation's header saying who sees it; `readers` once known. */
export function audienceLine(v: ConversationVisibility, agentName: string, readers: number | null): string {
  if (v === 'private') return `Solo tú y ${agentName}`;
  const people = readers === null ? '' : ` · ${readers} ${readers === 1 ? 'persona' : 'personas'}`;
  return `${v === 'read' ? 'La lee' : 'La escribe'} el equipo de ${agentName}${people}`;
}

/** Whether the person writes in a conversation: their level on its agent, lowered by who it is for. */
export function canWriteIn(c: { visibility: ConversationVisibility; mine: boolean }, level: AgentLevel | undefined): boolean {
  return level === 'talk' && (c.mine || c.visibility === 'write');
}

/** Why someone who can't write sees «Solo lectura»: their level on the agent, or the opener closed it. */
export function readOnlyNote(level: AgentLevel | undefined, opener: string | null, owner: string | null): string | null {
  if (level !== 'talk') return owner ? `Pide acceso a ${owner}` : null;
  return opener ? `La abrió ${opener}` : null;
}

/** Whether a change widens who reads it: they will see what was said before. */
export const widens = (from: ConversationVisibility, to: ConversationVisibility) => from === 'private' && to !== 'private';

/** The team's jobs nobody does yet, in the order the team is drawn (team-chat.md, decision 8). */
export function vacancies(agents: Agent[]): GhostId[] {
  const taken = new Set(agents.map((a) => a.ghost));
  return GHOST_ORDER.filter((g) => g !== 'base' && !taken.has(g));
}
