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

/** The team's jobs nobody does yet, in the order the team is drawn (team-chat.md, decision 8). */
export function vacancies(agents: Agent[]): GhostId[] {
  const taken = new Set(agents.map((a) => a.ghost));
  return GHOST_ORDER.filter((g) => g !== 'base' && !taken.has(g));
}
