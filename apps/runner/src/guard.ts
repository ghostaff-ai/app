// Claude Code's PreToolUse hook for Bash: what the runner's constitution
// forbids every agent, ported from ghostaff-ai/agents' arranque/guardia.py.
// managed-settings.json declares it; both are root's and read-only in the
// image, so no agent can change them. Claude Code passes the call on stdin as
// JSON; exiting 2 blocks it, and what goes to stderr is shown to the agent.
//
// It is a net, not the wall: the record token reaches only the record repo,
// and GitHub's branch rules are what really stop a write. This keeps the agent
// from trying, and tells it the right way.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES: [RegExp, string][] = [
  [
    /\bgit\b[^|;&]*\s(?:commit|push|merge|rebase|am|cherry-pick)\b[^|;&]*\s(?:--no-verify|-n)(?=\s|$)/,
    'Nada de saltarse los hooks: el pre-commit del registro es lo que protege tu memoria. Si te bloquea, déjalo escrito.',
  ],
  [/\bcore\.hooksPath\b|\bgit\b[^|;&]*\s-c\s+core\.hooks/, 'Los hooks del registro los configura el arranque; ningún agente los cambia.'],
  [/\bgit\b[^|;&]*\sremote\s+(?:add|set-url|rename|remove|rm)\b/, 'El registro tiene un solo remoto, `origin`, y no se cambia.'],
  [/\bgit\b[^|;&]*\s-c\s+(?:credential|http|url)\./, 'Las credenciales de git las pone el arranque; ningún agente las cambia.'],
];

const PUSH = /\bgit\s+(?:-C\s+(?<dir>\S+)\s+)?push\b(?<args>[^|;&]*)/g;
const FORCE = /(?:^|\s)(?:--force|--force-with-lease|--force-if-includes|-f|--mirror|--all|--delete|-d)(?=[\s=]|$)/;
const CD = /(?:^|[;&|]\s*)cd\s/;
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?^\s*\2\s*$/gm;
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"/g;
const RUNS_TEXT = /\b(?:bash|sh|zsh)\s+-\w*c\b|\beval\b/;

/**
 * The command without what is only written or passed as data (heredoc bodies,
 * quoted strings), so a commit message that only mentions a forbidden command
 * is not blocked. A command that runs text (`bash -c`, `eval`) is read whole.
 */
export function onlyWhatRuns(command: string): string {
  if (RUNS_TEXT.test(command)) return command;
  return command.replace(HEREDOC, '').replace(QUOTED, "''");
}

export interface PushContext {
  /** The record's clone: the only place a push may come from. */
  record: string;
  /** The record's default branch: the only branch a push may go to. */
  defaultBranch: string;
  /** The branch checked out in a directory, or null. */
  currentBranch(dir: string): string | null;
}

/** Why `command` is blocked, or null when it may run. */
export function blockReason(command: string, cwd: string, ctx: PushContext): string | null {
  const c = onlyWhatRuns(command);
  for (const [re, why] of RULES) if (re.test(c)) return why;
  for (const m of c.matchAll(PUSH)) {
    const args = m.groups?.args ?? '';
    if (FORCE.test(args)) return 'Nada de push forzado ni de borrar ramas: el registro solo avanza.';
    const positional = args.split(/\s+/).filter((p) => p && !p.startsWith('-') && !/[<>]/.test(p));
    const [remote, ...refspecs] = positional;
    if (remote !== undefined && remote !== 'origin') return 'Solo se hace push a `origin`, el registro.';
    if (refspecs.some((r) => r.startsWith('+'))) return 'Nada de push forzado: el registro solo avanza.';
    const dirArg = m.groups?.dir;
    const dir = dirArg ? (isAbsolute(dirArg) ? dirArg : join(cwd, dirArg)) : cwd;
    if (CD.test(c) || dir.replace(/\/+$/, '') !== ctx.record.replace(/\/+$/, '')) {
      return `Solo se hace push desde el registro (${ctx.record}), sin \`cd\`: usa \`git -C ${ctx.record} push\`.`;
    }
    const targets = refspecs.length ? refspecs.map((r) => r.split(':').pop()!.replace(/^refs\/heads\//, '')) : [ctx.currentBranch(dir)];
    for (const t of targets) {
      const branch = t === 'HEAD' ? ctx.currentBranch(dir) : t;
      if (branch !== ctx.defaultBranch) return `Solo se hace push a \`${ctx.defaultBranch}\`, la rama principal del registro.`;
    }
  }
  return null;
}

function git(dir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

/** Where the runner clones the record (main.ts); the hook runs with Claude's environment, which says only HOME. */
export const recordDir = (home: string) => join(home, 'registro');

function main(): number {
  const call = JSON.parse(readFileSync(0, 'utf8')) as { tool_input?: { command?: string }; cwd?: string };
  const record = recordDir(process.env.HOME ?? '/home/agente');
  const head = git(record, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const why = blockReason(call.tool_input?.command ?? '', call.cwd ?? record, {
    record,
    defaultBranch: head?.replace(/^origin\//, '') ?? 'main',
    currentBranch: (d) => git(d, ['symbolic-ref', '--short', 'HEAD']),
  });
  if (!why) return 0;
  process.stderr.write(`Bloqueado por la constitución de los agentes: ${why}\n`);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
