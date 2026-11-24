// The team chat's shapes and the pure helpers around them (docs/plans/ongoing/
// team-chat.md). Threads and messages live in the database
// (supabase/migrations/20261118000000_team_chat.sql); a message is a list of
// parts in the AI SDK's shape, so the agents can later add tool calls, files or
// decisions beside the text.

import type { GuideStatus } from './guides';
import type { ConversationVisibility } from './models';

export type MessagePart = { type: 'text'; text: string } | { type: string; [key: string]: unknown };

/**
 * An action the agent proposes in its message: something outside Ghostaff it
 * will do only once an owner approves it (apps/engine/src/actions.ts). The
 * card shows it; the engine runs what it stored, never what the part says.
 */
export interface ActionPart {
  type: 'action';
  actionId: string;
  /** What it will do, in Spanish («Publicar en Instagram»). */
  label: string;
  /** The details a person needs to decide, as readable text. */
  preview: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'rejected';
  /** What came of it: the tool's answer, or its error. */
  result?: string;
  /** Who approved or rejected it. */
  decidedBy?: string;
  /** Who decides it: an owner (absent), or the person who asked, for their own «Solo para mí» routine (agent-routines.md). */
  decider?: 'owner' | 'requester';
  /** Who asked for it, when that person decides. */
  requestedBy?: string;
}

export function isActionPart(p: MessagePart): p is ActionPart & MessagePart {
  return p.type === 'action' && typeof (p as { actionId?: unknown }).actionId === 'string';
}

/**
 * An agent asking, in its message, for an account it lacks (docs/plans/ongoing/
 * connector-in-chat.md): «Necesito acceso a Notion» and, for an owner, the
 * button that gets it. Once the account is there, the agent goes on
 * (apps/engine/src/accountAsks.ts); the engine trusts its own row, never the part.
 * A type, not an interface, so a part of a message can be one as it is.
 */
export type AccountAskPart = {
  type: 'account_ask';
  askId: string;
  /** The catalogue's id (connectors.ts); absent when the app is not in it. */
  connector?: string;
  /** The app's name as the person reads it. */
  name: string;
  /** Why the agent needs it, in one line. */
  why: string;
  /** What is missing: the account, a working one, this agent's access to it, or an app we can't connect yet. */
  need: 'connect' | 'reconnect' | 'grant' | 'unsupported';
  /** «done» once the account is there and the agent has gone on. */
  status: 'open' | 'done';
  /** Who made it possible, once done. */
  doneBy?: string;
};

export function isAccountAskPart(p: MessagePart): p is AccountAskPart & MessagePart {
  return p.type === 'account_ask' && typeof (p as { askId?: unknown }).askId === 'string';
}

/**
 * A guide in the thread (guides.ts): the card that
 * opens the guide on the app's access. The engine trusts its own row, never the
 * part. A type, not an interface, so a part of a message can be one as it is.
 */
export type GuidePart = {
  type: 'guide';
  guideId: string;
  /** The app's name as the person reads it. */
  app: string;
  /** Why the agent needs access, in one line. */
  why: string;
  status: GuideStatus;
  /** Who finished it, once done. */
  doneBy?: string;
  /** Who turned it down or handed it over. */
  decidedBy?: string;
  /** Why it cannot go on, when blocked. */
  blockedReason?: string;
};

export function isGuidePart(p: MessagePart): p is GuidePart & MessagePart {
  return p.type === 'guide' && typeof (p as { guideId?: unknown }).guideId === 'string';
}

/**
 * A voice note (docs/plans/ongoing/voice.md): the audio a person recorded, kept
 * in the private «voice-notes» bucket. Once transcribed, a text part follows
 * it with the transcript, which is what the agent and the lists read. A type,
 * not an interface, so a part of a message can be one as it is.
 */
export type VoicePart = {
  type: 'voice';
  /** In the bucket: <org_id>/<thread_id>/<message_id>.<ext>. */
  path: string;
  /** The audio's type, e.g. «audio/mp4». */
  mediaType: string;
  /** How long it lasts, as the app measured it; null when unknown. */
  durationMs: number | null;
  /** «empty» when nobody spoke. */
  transcription: 'pending' | 'done' | 'empty' | 'failed';
};

export function isVoicePart(p: MessagePart): p is VoicePart & MessagePart {
  return p.type === 'voice' && typeof (p as { path?: unknown }).path === 'string';
}

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
  /** The routine that started this answer (agent-routines.md): the chat says so above it. */
  routineId?: string | null;
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
  /** The person's own chat with the agent (one per agent). */
  personal: boolean;
  /** Who besides its opener reads or writes it; a personal chat is always private. */
  visibility: ConversationVisibility;
  /** The person opened it (or it is their chat with the agent). */
  mine: boolean;
  /** The person opened it, wrote, read or was @mentioned in it: Equipo shows it. */
  following: boolean;
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
