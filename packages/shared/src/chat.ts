// The team chat's shapes and the pure helpers around them (docs/plans/ongoing/
// team-chat.md). Threads and messages live in the database
// (supabase/migrations/20261118000000_team_chat.sql); a message is a list of
// parts in the AI SDK's shape, so the agents can later add tool calls, files or
// decisions beside the text.

export type MessagePart = { type: 'text'; text: string } | { type: string; [key: string]: unknown };

export interface ChatMessage {
  id: string;
  threadId: string;
  authorKind: 'person' | 'agent';
  authorUserId: string | null;
  authorAgentId: string | null;
  /** How the author signs, kept if they leave. */
  authorName: string;
  parts: MessagePart[];
  /** An agent's reply is «working» while it is written, then «done» (or «failed»). */
  state: 'working' | 'done' | 'failed';
  /** What the agent did, one plain line per step. */
  steps: string[];
  createdAt: string;
}

/** A thread as the lists show it: its last message and whether it waits for you. */
export interface ChatThread {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  lastAuthor: string | null;
  lastText: string | null;
  unread: boolean;
}

export interface OrgMember {
  userId: string;
  displayName: string;
  role: 'owner' | 'member';
}

/** The text of a message: its text parts, joined. */
export function messageText(parts: MessagePart[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n\n');
}

export type TextSegment = { text: string; mention: boolean };

/**
 * Splits a message into plain text and @mentions of the given names (people
 * and agents), longest name first so «@Ana María» wins over «@Ana». Matching
 * ignores case; a mention must start the text or follow a space, and end
 * before a letter or digit.
 */
export function splitMentions(text: string, names: string[]): TextSegment[] {
  const sorted = [...new Set(names.filter((n) => n.trim()))].sort((a, b) => b.length - a.length);
  if (sorted.length === 0) return text ? [{ text, mention: false }] : [];
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(^|\\s)(@(?:${escaped.join('|')}))(?![\\p{L}\\p{N}])`, 'giu');
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const lead = m[1] ?? '';
    const name = m[2] ?? '';
    const start = (m.index ?? 0) + lead.length;
    if (start > last) out.push({ text: text.slice(last, start), mention: false });
    out.push({ text: name, mention: true });
    last = start + name.length;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out;
}

/** The half-typed name after an @ at the end of the text, or null when the person isn't mentioning anyone. */
export function mentionQuery(textBeforeCursor: string): string | null {
  const m = /(?:^|\s)@([\p{L}\p{N} ]{0,30})$/u.exec(textBeforeCursor);
  const q = m?.[1];
  if (q === undefined) return null;
  // Two spaces in a row end it; one could still be inside a two-word name.
  return q.includes('  ') ? null : q;
}

/** The names that start with what was typed after the @, at most `limit`. */
export function mentionSuggestions(query: string, names: string[], limit = 5): string[] {
  const q = query.trim().toLocaleLowerCase('es');
  return [...new Set(names)].filter((n) => n.toLocaleLowerCase('es').startsWith(q)).slice(0, limit);
}

/** Replaces the half-typed @query at the end of `before` with the full name and a space. */
export function completeMention(before: string, name: string): string {
  return before.replace(/@([\p{L}\p{N} ]{0,30})$/u, `@${name} `);
}
