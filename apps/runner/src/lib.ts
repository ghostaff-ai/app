// The pure parts of Ghostaff's agent runner (main.ts), apart so they can be
// tested: what Claude Code is run with, what its last message was, which
// decisions the agent opened, and what the engine is told at the end. Ported
// from ghostaff-ai/agents' arranque/arrancar.py, not copied.

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

/** What the engine gives a run, once (apps/engine/src/runner.ts, RunSpec). */
export interface RunSpec {
  run: string;
  slug: string;
  prompt: string;
  model: string;
  tools: string[];
  maxTurns: number;
  /** The record token is new for this run (never cached or shared) and stops working at `expiresAt`. */
  record: { repo: string; token: string; expiresAt: string };
  author: { name: string; email: string };
  claudeToken: string;
  decisionsDir: string;
}

/** The report the engine takes at POST /runs/report. */
export interface Report {
  run: string;
  nonce: string;
  ok: boolean;
  text: string | null;
  noteworthy: boolean;
  decisions: { id: string; question: string }[];
}

/** What a scheduled run's last message is when there is nothing to tell. */
export const NOTHING_NEW = 'SIN NOVEDAD';

const isRepo = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s);
const isName = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s);

/** The spec as the engine sent it, checked: nothing in it reaches a command line unchecked. */
export function readSpec(body: unknown): RunSpec {
  const b = (body ?? {}) as Record<string, unknown>;
  const record = (b.record ?? {}) as Record<string, unknown>;
  const author = (b.author ?? {}) as Record<string, unknown>;
  const ok =
    typeof b.run === 'string' &&
    typeof b.slug === 'string' && /^[a-z][a-z0-9_-]{0,40}$/.test(b.slug) &&
    typeof b.prompt === 'string' && b.prompt.length > 0 &&
    typeof b.model === 'string' && /^[a-z0-9][a-z0-9.[\]-]{0,63}$/.test(b.model) &&
    Array.isArray(b.tools) && b.tools.every(isName) &&
    Number.isInteger(b.maxTurns) && (b.maxTurns as number) > 0 &&
    isRepo(record.repo) && typeof record.token === 'string' && record.token.length > 0 &&
    typeof record.expiresAt === 'string' && !Number.isNaN(Date.parse(record.expiresAt)) &&
    typeof author.name === 'string' && typeof author.email === 'string' &&
    typeof b.claudeToken === 'string' && b.claudeToken.length > 0 &&
    typeof b.decisionsDir === 'string' && /^[a-z0-9_-]+$/.test(b.decisionsDir);
  if (!ok) throw new Error('the engine sent a spec this runner cannot read');
  return b as unknown as RunSpec;
}

/** `claude -p`'s arguments: the agent's model, tools and turns, never asking, every event as JSON. */
export function claudeArgs(spec: Pick<RunSpec, 'model' | 'tools' | 'maxTurns'>): string[] {
  return [
    '-p',
    '--model', spec.model,
    '--permission-mode', 'dontAsk',
    '--allowedTools', spec.tools.join(','),
    '--max-turns', String(spec.maxTurns),
    '--output-format', 'stream-json',
    '--verbose',
  ];
}

/**
 * Claude Code's whole environment: its credential, its home, PATH and LANG. Nothing of the runner's.
 *
 * KNOWN GAP (before any customer organisation uses this runner): the
 * organisation's Claude subscription token is in this environment, so the
 * agent can read it with Bash (`env`), and so can anyone who can talk the
 * agent into printing it. Today only Órdago's own agents run here. The fix is
 * a local proxy that holds the token outside the agent's reach
 * (docs/plans/ongoing/ordago-agents-in-ghostaff.md, step 5).
 */
export function agentEnv(claudeToken: string, home: string): Record<string, string> {
  return {
    CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
    HOME: home,
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
  };
}

/** git's environment as the agent's user, for the runner's own git calls (no Claude credential). */
export function gitEnv(home: string): Record<string, string> {
  return { HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', GIT_TERMINAL_PROMPT: '0' };
}

/** The final stream-json event: whether it is a successful result, and what Claude said last. */
export function resultOf(lastLine: string): { ok: boolean; text: string | null } {
  try {
    const e = JSON.parse(lastLine) as { type?: string; is_error?: boolean; result?: unknown };
    const text = e.type === 'result' && typeof e.result === 'string' && e.result.trim() ? e.result.trim() : null;
    return { ok: e.type === 'result' && !e.is_error, text };
  } catch {
    return { ok: false, text: null };
  }
}

/** Whether the agent has something to tell people: anything but `SIN NOVEDAD` (in backticks or bold, too). */
export function noteworthy(text: string | null): boolean {
  return text !== null && text.replace(/^[`*\s]+|[`*\s]+$/g, '') !== NOTHING_NEW;
}

/**
 * The decisions this run opened: files new in the decisions folder whose
 * `propone` is the agent. A file another agent or a person added meanwhile
 * (brought in by a pull) is not this run's.
 */
export function newDecisions(
  files: { name: string; content: string }[],
  before: Set<string>,
  slug: string,
  secrets: (string | null | undefined)[] = [],
): { id: string; question: string }[] {
  const out: { id: string; question: string }[] = [];
  for (const f of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!f.name.endsWith('.yaml') || before.has(f.name)) continue;
    let d: unknown;
    try {
      d = parse(f.content);
    } catch {
      continue;
    }
    if (!d || typeof d !== 'object') continue;
    const x = d as Record<string, unknown>;
    if (x.propone !== slug) continue;
    const id = f.name.slice(0, -'.yaml'.length);
    out.push({ id, question: redact(typeof x.pregunta === 'string' && x.pregunta.trim() ? x.pregunta.trim() : id, secrets) });
  }
  return out;
}

/** Hides every secret this run holds from a line before it is printed or sent. */
export function redact(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join('[secreto]');
  return out;
}

/** What a crash is called in the failure report: its kind and a short message, never a secret. */
export function crashText(e: unknown, secrets: (string | null | undefined)[]): string {
  const what = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return redact(what, secrets).slice(0, 300);
}

/** The uid and gid of `user` in an /etc/passwd. */
export function passwdIds(passwd: string, user: string): { uid: number; gid: number; home: string } {
  for (const line of passwd.split('\n')) {
    const [name, , uid, gid, , home] = line.split(':');
    if (name === user && uid && gid && home) return { uid: Number(uid), gid: Number(gid), home };
  }
  throw new Error(`no user ${user}`);
}

/** The engine's Spanish for a run that ended badly, in the report's text. */
export function failureText(code: number | null, said: string | null): string {
  return said ?? (code === null ? 'Claude Code se cortó sin terminar.' : `Claude Code acabó con error (${code}).`);
}

/**
 * The decision files in `dir`, read by root after the agent is done: only
 * regular files, never through a symlink the agent left (it could point at
 * anything root can read), and none bigger than 64 KB.
 */
export function decisionFiles(dir: string): { name: string; content: string }[] {
  let names: string[];
  try {
    if (!lstatSync(dir).isDirectory()) return [];
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (!name.endsWith('.yaml')) return [];
    const path = join(dir, name);
    try {
      const st = lstatSync(path);
      if (!st.isFile() || st.size > 64 * 1024) return [];
      return [{ name, content: readFileSync(path, 'utf8') }];
    } catch {
      return [];
    }
  });
}

/** Whether the record token is close enough to its end to ask the engine for a new one. */
export const tokenNearExpiry = (expiresAt: string, now: number) => Date.parse(expiresAt) - now < 5 * 60_000;

/**
 * Whether the engine closed the run itself when it refused the spec, and said
 * why in Ghostaff: then the runner sends no report. Any other refusal leaves
 * the run open, so the runner reports its failure.
 */
export function engineClosedRun(status: number, body: unknown): boolean {
  const code = (body as { error?: unknown } | null)?.error;
  return status === 409 && (code === 'no_subscription' || code === 'no_record');
}
