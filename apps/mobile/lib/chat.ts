import type { Agent, AgentLevel, ChatMessage } from '@ghostaff/shared';
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
 * Who the mic talks to (app-design.md #2): Secretaría, if the person may talk
 * to her; else the first agent they may talk to; else nobody.
 */
export function talkTarget(agents: Agent[], levels: Record<string, AgentLevel>): Agent | null {
  const talk = agents.filter((a) => levels[a.id] === 'talk');
  return talk.find((a) => a.ghost === 'secretaria') ?? talk[0] ?? null;
}

/** The team's jobs nobody does yet, in the order the team is drawn (team-chat.md, decision 8). */
export function vacancies(agents: Agent[]): GhostId[] {
  const taken = new Set(agents.map((a) => a.ghost));
  return GHOST_ORDER.filter((g) => g !== 'base' && !taken.has(g));
}

/** `text` with the transcript after it: a space between, none in an empty box. */
export function appendDictation(text: string, transcript: string): string {
  if (text.trim() === '') return transcript;
  return /\s$/.test(text) ? text + transcript : `${text} ${transcript}`;
}
