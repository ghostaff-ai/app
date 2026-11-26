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
  /**
   * The record: cloned from `cloneUrl` (GitHub, or our record store on the VPC) with `token` as the
   * password of `username`. The token is new for this run (never cached or shared); renew it at `expiresAt`.
   */
  record: { repo: string; cloneUrl: string; username: string; token: string; expiresAt: string };
  /**
   * The other repos the agent may use, each cloned into `~/repos/<dir>` with its own token (read-only unless
   * `write`): GitHub only. Absent from an engine older than them: none.
   */
  repos?: RepoAccess[];
  author: { name: string; email: string };
  claudeToken: string;
  decisionsDir: string;
  /**
   * The organisation's Google Cloud: a one-hour token as its own service account, and the project
   * `gcloud` and `bq` default to (null: none). Absent or null when the organisation has no account.
   */
  google?: GoogleAccess | null;
  /**
   * The organisation's secrets the agent's row names, as variables of Claude Code. Absent from an engine
   * older than them: none.
   */
  secrets?: SecretVar[];
}

/** One of the organisation's secrets: Claude Code gets `value` as the variable `env`. */
export interface SecretVar {
  env: string;
  value: string;
}

export interface RepoAccess {
  repo: string;
  dir: string;
  cloneUrl: string;
  write: boolean;
  /** May push to `main` and `beta` too (guard.ts). Absent from an engine older than it: no. */
  main?: boolean;
  token: string;
  /** When to ask the engine for another (POST /runs/:id/repo-token). */
  expiresAt: string;
}

export interface GoogleAccess {
  account: string;
  project: string | null;
  token: string;
  /** When to ask the engine for another (POST /runs/:id/google-token). */
  expiresAt: string;
}

/** The report the engine takes at POST /runs/report. */
export interface Report {
  run: string;
  nonce: string;
  ok: boolean;
  text: string | null;
  noteworthy: boolean;
  decisions: { id: string; question: string }[];
  /** What Claude Code used (its `result` event's usage), for the subscription's card in Ghostaff. */
  usage?: unknown;
  /** The last `rate_limit_info` Claude Code reported: the subscription's 5-hour and weekly limits. */
  rateLimit?: unknown;
  model?: string;
  /** How the run ended (its `result` event): turns, and the subtype (success, error_max_turns…). */
  turns?: number;
  ending?: string;
}

/** What a scheduled run's last message is when there is nothing to tell. */
export const NOTHING_NEW = 'SIN NOVEDAD';

const isRepo = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s);
const isName = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(s);
/** A git URL with nothing in it a shell or git could read as an option: GitHub over HTTPS, or our record store. */
const isCloneUrl = (s: unknown): s is string =>
  typeof s === 'string' &&
  (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(s) || /^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?\/records\/[a-z0-9-]+\.git$/.test(s));
const isGitUser = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(s);
/** A Google Cloud project id, as Google allows them. */
const isProject = (s: unknown): s is string => typeof s === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(s);
const isServiceAccount = (s: unknown): s is string =>
  typeof s === 'string' && /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/.test(s);
/** A token that can go in a file as one line: no whitespace, nothing a shell would read. */
const isAccessToken = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9._~+/=-]{20,4096}$/.test(s);

/** A folder name under ~/repos: one path segment, nothing git or a shell reads as an option. */
const isDir = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/.test(s) && s !== '..';

function isRepos(r: unknown): boolean {
  if (r === undefined) return true;
  if (!Array.isArray(r) || r.length > 10) return false;
  const dirs = new Set<string>();
  return r.every((x: Record<string, unknown>) => {
    const ok =
      x !== null && typeof x === 'object' &&
      isRepo(x.repo) && x.cloneUrl === `https://github.com/${x.repo}.git` &&
      isDir(x.dir) && !dirs.has(x.dir.toLowerCase()) &&
      typeof x.write === 'boolean' &&
      (x.main === undefined || (typeof x.main === 'boolean' && (x.write || !x.main))) &&
      typeof x.token === 'string' && x.token.length > 0 &&
      typeof x.expiresAt === 'string' && !Number.isNaN(Date.parse(x.expiresAt));
    if (ok) dirs.add((x.dir as string).toLowerCase());
    return ok;
  });
}

/** Variables the runner sets itself (GHOSTAFF_RUNS too), or that change how a shell, Claude Code, gcloud, git, node or the loader behave. */
const RESERVED_ENV = new Set(['HOME', 'PATH', 'LANG', 'USER', 'SHELL', 'PWD', 'TMPDIR', 'BASH_ENV', 'ENV', 'IFS']);
const RESERVED_ENV_PREFIX = /^(CLAUDE_|ANTHROPIC_|CLOUDSDK_|GOOGLE_|GHOSTAFF_|GIT_|LD_|NODE_|SSH_)/;

/**
 * Whether a secret may become this variable: upper case, digits and underscores, and none the runner or a tool
 * relies on. The same rule as the database's (20261127100000_agent_secrets.sql) and the engine's
 * (packages/shared/src/record/agents.ts, isSecretEnv); checked again here, where the environment is built.
 */
export const isSecretEnv = (env: unknown): env is string =>
  typeof env === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(env) && !RESERVED_ENV.has(env) && !RESERVED_ENV_PREFIX.test(env);

/**
 * A secret's value: long enough for `redact` to hide it (8 characters), with no NUL (an environment cannot
 * hold one), and at most 64 KB.
 */
const isSecretValue = (v: unknown): v is string => typeof v === 'string' && v.length >= 8 && v.length <= 65536 && !v.includes('\0');

function isSecrets(s: unknown): boolean {
  if (s === undefined) return true;
  if (!Array.isArray(s) || s.length > 20) return false;
  const envs = new Set<string>();
  return s.every((x: Record<string, unknown>) => {
    const ok = x !== null && typeof x === 'object' && isSecretEnv(x.env) && !envs.has(x.env) && isSecretValue(x.value);
    if (ok) envs.add(x.env as string);
    return ok;
  });
}

function isGoogle(g: unknown): boolean {
  if (g === undefined || g === null) return true;
  const x = g as Record<string, unknown>;
  return (
    isServiceAccount(x.account) &&
    (x.project === null || isProject(x.project)) &&
    isAccessToken(x.token) &&
    typeof x.expiresAt === 'string' && !Number.isNaN(Date.parse(x.expiresAt))
  );
}

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
    isRepo(record.repo) && isCloneUrl(record.cloneUrl) && isGitUser(record.username) &&
    typeof record.token === 'string' && record.token.length > 0 &&
    typeof record.expiresAt === 'string' && !Number.isNaN(Date.parse(record.expiresAt)) &&
    typeof author.name === 'string' && typeof author.email === 'string' &&
    typeof b.claudeToken === 'string' && b.claudeToken.length > 0 &&
    typeof b.decisionsDir === 'string' && /^[a-z0-9_-]+$/.test(b.decisionsDir) &&
    isRepos(b.repos) &&
    isGoogle(b.google) &&
    isSecrets(b.secrets);
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
 * Claude Code's whole environment: its credential, its home, PATH and LANG, the organisation's Google Cloud
 * and the organisation's secrets its agent row names. Nothing of the runner's. The secrets go in first, so
 * that nothing the runner sets can be replaced by one, even past readSpec's check.
 *
 * KNOWN GAP (before any customer organisation uses this runner): the
 * organisation's Claude subscription token and its secrets are in this
 * environment, so the agent can read them with Bash (`env`), and so can anyone
 * who can talk the agent into printing them. Today only Órdago's own agents run
 * here. The runner hides every one of them from what it prints and reports
 * (`redact`), not from the agent. The fix is a local proxy that holds them
 * outside the agent's reach (docs/plans/ongoing/ordago-agents-in-ghostaff.md,
 * step 5 and item 3).
 */
export function agentEnv(
  claudeToken: string,
  home: string,
  /** The organisation's Google Cloud: `gcloud` and `bq` read the token from this file, which root renews. */
  google?: { tokenFile: string; project: string | null } | null,
  /** Where `ghostaff ejecuciones` and `ghostaff leer` ask for earlier runs: the runner on 127.0.0.1 (pastRuns.ts). */
  pastRuns?: string | null,
  secrets: SecretVar[] = [],
): Record<string, string> {
  return {
    ...Object.fromEntries(secrets.filter((s) => isSecretEnv(s.env)).map((s) => [s.env, s.value])),
    CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
    HOME: home,
    PATH: '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8',
    ...(pastRuns ? { GHOSTAFF_RUNS: pastRuns } : {}),
    ...(google
      ? {
          CLOUDSDK_AUTH_ACCESS_TOKEN_FILE: google.tokenFile,
          CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
          ...(google.project ? { CLOUDSDK_CORE_PROJECT: google.project } : {}),
        }
      : {}),
  };
}

/** git's environment as the agent's user, for the runner's own git calls (no Claude credential). */
export function gitEnv(home: string): Record<string, string> {
  return { HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C.UTF-8', GIT_TERMINAL_PROMPT: '0' };
}

/**
 * What a stream-json line tells about usage: the subscription's limits (a
 * `rate_limit_event`) or the tokens (the `result` event). Neither holds a secret.
 */
export function usageOf(line: string): { rateLimit?: unknown; usage?: unknown } {
  try {
    const e = JSON.parse(line) as { type?: string; rate_limit_info?: unknown; usage?: unknown };
    if (e.type === 'rate_limit_event' && e.rate_limit_info) return { rateLimit: e.rate_limit_info };
    if (e.type === 'result' && e.usage) return { usage: e.usage };
  } catch {
    // not JSON: nothing to read
  }
  return {};
}

/** How the run ended, from the final stream-json event: its turns and its subtype, when it is a `result`. */
export function endingOf(lastLine: string): { turns?: number; ending?: string } {
  try {
    const e = JSON.parse(lastLine) as { type?: string; num_turns?: unknown; subtype?: unknown };
    if (e.type !== 'result') return {};
    return {
      ...(Number.isInteger(e.num_turns) ? { turns: e.num_turns as number } : {}),
      ...(typeof e.subtype === 'string' && /^[a-z_]{1,40}$/.test(e.subtype) ? { ending: e.subtype } : {}),
    };
  } catch {
    return {};
  }
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

/** Where the runner clones the agent's other repos: `~/repos/<dir>`. */
export const reposDir = (home: string) => join(home, 'repos');

/**
 * git's arguments to clone one of the other repos: a read-only one shallow, as it is only read and can be big
 * (`ordago-apps`), and one the agent may write with its history but its files fetched as needed.
 */
export function cloneArgs(r: Pick<RepoAccess, 'cloneUrl' | 'write'>, dest: string): string[] {
  return ['clone', '--quiet', ...(r.write ? ['--filter=blob:none'] : ['--depth', '1', '--single-branch']), r.cloneUrl, dest];
}

/** What the guard is told about the other repos the agent may push to (guard.ts PUSH_RULES): the ones it writes and cloned. */
export function pushRules(repos: Pick<RepoAccess, 'repo' | 'dir' | 'write' | 'main'>[], home: string, cloned: Set<string>): { repo: string; dir: string; main: boolean }[] {
  return repos.filter((r) => r.write && cloned.has(r.repo)).map((r) => ({ repo: r.repo, dir: join(reposDir(home), r.dir), main: r.main === true }));
}

/** A repo as git's credential helper asks for it (`credential.useHttpPath`): its scheme, host and path, normalised. */
export function credentialKey(protocol: string, host: string, path: string): string {
  return `${protocol}://${host.toLowerCase()}/${path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').toLowerCase()}`;
}

/** The same key for a clone URL. */
export const credentialKeyOf = (cloneUrl: string) => {
  const u = new URL(cloneUrl);
  return credentialKey(u.protocol.replace(':', ''), u.host, u.pathname);
};

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

/**
 * The most of a run's transcript kept, before gzip: Órdago's longest so far was under 1 MB. The engine
 * takes at most this gzipped, so a transcript within it always fits.
 */
export const MAX_TRANSCRIPT_BYTES = 20 * 1024 * 1024;

/** The line a transcript cut at its size ends with, before the run's final `result` event. */
export const CUT_EVENT = 'ghostaff_cut';

/**
 * Where a run's stream-json goes, line by line, already redacted: up to `max` bytes. Past it, one
 * `ghostaff_cut` line and nothing more, but the final event (`end`), so a cut transcript still says how
 * the run ended.
 */
export function transcriptSink(write: (text: string) => void, max = MAX_TRANSCRIPT_BYTES) {
  let bytes = 0;
  let cut = false;
  let lastWritten = '';
  return {
    line(redacted: string) {
      if (cut || !redacted.trim()) return;
      const text = `${redacted}\n`;
      const size = Buffer.byteLength(text);
      if (bytes + size > max) {
        cut = true;
        write(`${JSON.stringify({ type: CUT_EVENT, bytes, max })}\n`);
        return;
      }
      write(text);
      bytes += size;
      lastWritten = redacted;
    },
    end(lastRedacted: string) {
      if (cut && lastRedacted.trim() && lastRedacted !== lastWritten) write(`${lastRedacted}\n`);
    },
  };
}

const TOOL_DETAIL = 160;

function toolLine(block: { name?: unknown; input?: unknown }): string {
  const input = (block.input ?? {}) as Record<string, unknown>;
  const raw = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ?? input.description ?? '';
  let detail = typeof raw === 'string' ? (raw.split('\n')[0] ?? '') : '';
  if (detail.length > TOOL_DETAIL) detail = `${detail.slice(0, TOOL_DETAIL)}…`;
  return detail ? `  → ${String(block.name)}: ${detail}` : `  → ${String(block.name)}`;
}

/**
 * A stream-json transcript as a person (or Dirección) reads it: what the agent said, which tool it used
 * and on what, and how it ended. Ported from ghostaff-ai/agents' herramientas/agente.py `resumir`.
 */
export function readableTranscript(lines: Iterable<string>): string {
  const out: string[] = [];
  for (const line of lines) {
    let e: { type?: string; message?: { content?: unknown }; is_error?: boolean; num_turns?: unknown; result?: unknown; max?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'assistant' && Array.isArray(e.message?.content)) {
      for (const b of e.message.content as { type?: string; text?: unknown; name?: unknown; input?: unknown }[]) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push(b.text.trim());
        else if (b.type === 'tool_use') out.push(toolLine(b));
      }
    } else if (e.type === CUT_EVENT) {
      out.push(`\n[… transcripción cortada: pasaba de ${Number(e.max) / 1024 / 1024} MB …]`);
    } else if (e.type === 'result') {
      const how = e.is_error ? 'con error' : 'bien';
      const turns = typeof e.num_turns === 'number' ? `, en ${e.num_turns} turnos` : '';
      out.push(`\n=== Acabó ${how}${turns} ===\n${typeof e.result === 'string' ? e.result.trim() : ''}`.trimEnd());
    }
  }
  return out.join('\n');
}
