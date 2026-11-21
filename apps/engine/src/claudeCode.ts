// The unmodified Claude Code program, as the engine runs it for an organisation
// (docs/plans/ongoing/llm-connectors.md, «Anthropic's wording on subscriptions»).
// Two uses: its own sign-in (`claude setup-token`), so an owner connects the
// organisation's Claude subscription, and `claude -p`, so an agent answers in the
// chat on that subscription. We never touch Claude Code's sign-in itself: the
// person signs in at Anthropic, pastes the code into the program, and the program
// prints the long-lived token, which goes straight to the vault.
//
// Every run gets a throwaway HOME and only the environment it needs: never the
// engine's own secrets (the service-role key…), never ANTHROPIC_API_KEY.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/**
 * Claude Code's long-lived sign-in token, as `claude setup-token` prints it.
 * Only once something follows it: output arrives in pieces, and a token cut at
 * the end of a piece must not be taken for the whole one.
 */
const TOKEN = /sk-ant-oat01-[A-Za-z0-9_-]{20,}(?=[^A-Za-z0-9_-])/;
/** Where Claude Code sends the person to sign in. Only these hosts are passed on to the app. */
const SIGN_IN_HOSTS = ['claude.com', 'claude.ai', 'anthropic.com', 'console.anthropic.com', 'platform.claude.com'];

/** Terminal escapes out, so what is left is the text a person would read. */
export function stripTerminal(raw: string): string {
  return (
    raw
      // OSC (hyperlinks, titles…), ended by BEL or ESC \.
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      // CSI: colours, cursor moves, modes.
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ' ')
      // Charset selection (ESC ( B) and the other two-character escapes (ESC 7, ESC 8…).
      .replace(/\x1b[()*+][0-9A-Za-z]/g, '')
      .replace(/\x1b[@-_0-9=<>]/g, '')
      // Other control characters, keeping line breaks.
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (c) => (c === '\r' ? '\n' : ''))
  );
}

function signInUrl(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') return null;
    if (!SIGN_IN_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return null;
    if (!url.pathname.includes('oauth')) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export interface SignInOutput {
  /** Anthropic's sign-in page, once printed. */
  url: string | null;
  /** The long-lived token, once printed. */
  token: string | null;
  /** Claude Code refused the pasted code. */
  badCode: boolean;
}

/** Reads what `claude setup-token` has printed so far. */
export function parseSignInOutput(raw: string): SignInOutput {
  // The link is printed as an OSC 8 hyperlink: its target is the whole URL, never wrapped.
  let url: string | null = null;
  for (const m of raw.matchAll(/\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b]+)(?:\x07|\x1b\\)/g)) {
    url = signInUrl(m[1] ?? '');
    if (url) break;
  }
  const text = stripTerminal(raw);
  if (!url) {
    for (const m of text.matchAll(/https:\/\/[^\s]+/g)) {
      url = signInUrl(m[0]);
      if (url) break;
    }
  }
  return {
    url,
    token: text.match(TOKEN)?.[0] ?? null,
    badCode: /OAuth\s*error/i.test(text) || /invalid\s+code/i.test(text),
  };
}

/** The bits of a child process the engine uses; tests give a fake. */
export interface SignInProcess {
  onOutput(cb: (chunk: string) => void): void;
  onExit(cb: (code: number | null) => void): void;
  write(s: string): void;
  /** Kills it; resolves once it has exited, so its HOME can go. */
  kill(): Promise<void>;
}

/** Starts `claude setup-token` with `home` as its HOME. */
export type SignInSpawner = (home: string) => SignInProcess;

/** Only what Claude Code needs; nothing of the engine's own environment. */
export function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    LANG: 'C.UTF-8',
    TERM: 'xterm-256color',
    // No browser in the container: Claude Code prints the link instead.
    BROWSER: 'true',
    DISABLE_AUTOUPDATER: '1',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    ...extra,
  };
}

/**
 * Stops the child and resolves once it has exited. SIGTERM first: `script`
 * passes it on to Claude Code in its terminal and waits for it, so nothing is
 * written to its HOME afterwards. SIGKILL to the group if it lingers.
 */
function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return Promise.resolve();
  const pid = child.pid;
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(-pid, s);
    } catch {
      child.kill(s);
    }
  };
  return new Promise<void>((resolve) => {
    const hard = setTimeout(() => signal('SIGKILL'), 3_000);
    const giveUp = setTimeout(resolve, 6_000);
    child.once('exit', () => {
      clearTimeout(hard);
      clearTimeout(giveUp);
      resolve();
    });
    signal('SIGTERM');
  });
}

/**
 * The real sign-in: Claude Code needs a terminal, so it runs under `script`
 * (util-linux), which gives it one and passes our stdin through. The terminal
 * is 2000 columns wide so the token is printed on one line.
 */
export const spawnSetupToken: SignInSpawner = (home) => {
  const child = spawn('script', ['-qfc', 'stty cols 2000 rows 50; exec claude setup-token', '/dev/null'], {
    cwd: home,
    env: childEnv(home),
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdin?.on('error', () => {});
  return {
    onOutput(cb) {
      child.stdout?.setEncoding('utf8').on('data', cb);
      child.stderr?.setEncoding('utf8').on('data', cb);
    },
    onExit(cb) {
      child.on('exit', (code) => cb(code));
      child.on('error', () => cb(null));
    },
    write(s) {
      child.stdin?.write(s);
    },
    kill: () => stop(child),
  };
};

/** A throwaway HOME for one run of Claude Code. */
export async function makeHome(): Promise<{ path: string; remove: () => Promise<void> }> {
  const path = await mkdtemp(join(tmpdir(), 'claude-'));
  return { path, remove: () => rm(path, { recursive: true, force: true }) };
}

/** One `claude -p` run: its stdout lines, and how it ended. */
export interface PrintRun {
  lines: AsyncIterable<string>;
  done: Promise<number | null>;
  /** Kills it; resolves once it has exited. */
  kill(): Promise<void>;
}

/** Runs `claude` with `args`, `stdin` written in and closed, the token in its environment. */
export type PrintRunner = (args: string[], opts: { home: string; token: string; stdin: string }) => PrintRun;

export const runClaudePrint: PrintRunner = (args, { home, token, stdin }) => {
  const child = spawn('claude', args, {
    cwd: home,
    env: childEnv(home, { CLAUDE_CODE_OAUTH_TOKEN: token }),
    stdio: ['pipe', 'pipe', 'ignore'],
    detached: true,
  });
  child.stdin?.on('error', () => {});
  child.stdin?.end(stdin);
  const done = new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
    child.on('error', () => resolve(null));
  });
  return {
    lines: createInterface({ input: child.stdout!, crlfDelay: Infinity }),
    done,
    kill: () => stop(child),
  };
};
