// Claude Code's PreToolUse hook for Bash: what the runner's constitution
// forbids every agent, ported from ghostaff-ai/agents' arranque/guardia.py.
// managed-settings.json declares it; both are root's and read-only in the
// image, so no agent can change them. Claude Code passes the call on stdin as
// JSON; exiting 2 blocks it, and what goes to stderr is shown to the agent.
//
// It is a net, not the wall: each repo's token reaches only that repo (and a
// repo the agent may only read gets a read-only token), and GitHub's branch
// rules are what really stop a write. This keeps the agent from trying, and
// tells it the right way. A push goes from the record to its default branch,
// or from a repo the agent may write (agents.repos), or a worktree of it, to any
// branch but `main` and `beta`, unless that repo lets it push to main too. Which
// repos those are the runner writes, as root, to PUSH_RULES before the agent
// starts. Where the agent has `gh` (a repo whose pull requests it handles), a PR
// lands through the repo's own flow (Órdago's `pnpm pr:land`), never `gh pr
// merge`; no PR is opened against production's branches; and branches and
// merges are not written through the API, which would get round the push rules.
// The repos it may not write have no branch rules on GitHub's free plan: there,
// this is the only net.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RULES: [RegExp, string][] = [
  [
    /\bgit\b[^|;&]*\s(?:commit|push|merge|rebase|am|cherry-pick)\b[^|;&]*\s(?:--no-verify|-n)(?=\s|$)/,
    'Nada de saltarse los hooks: el pre-commit del registro es lo que protege tu memoria. Si te bloquea, déjalo escrito.',
  ],
  [/\bcore\.hooksPath\b|\bgit\b[^|;&]*\s-c\s+core\.hooks/, 'Los hooks del registro los configura el arranque; ningún agente los cambia.'],
  [/\bgit\b[^|;&]*\sremote\s+(?:add|set-url|rename|remove|rm)\b/, 'El registro tiene un solo remoto, `origin`, y no se cambia.'],
  [/\bgit\b[^|;&]*\s-c\s+(?:credential|http|url)\./, 'Las credenciales de git las pone el arranque; ningún agente las cambia.'],
  [
    /\bgh\b[^|;&]*\spr\s+merge\b/,
    'Un PR se aterriza con el flujo del repo (`pnpm pr:land`, que lleva el bucle con el revisor y sus comprobaciones), nunca con `gh pr merge`.',
  ],
];

const GH = /\bgh\b(?<args>[^|;&]*)/g;
const GH_PR_BASE = /\spr\s+(?:create|edit)\b/;
const GH_API = /^\s*api\b/;
/** A `gh api` call that writes (a method, or fields, which make it a POST) to a branch or a merge. */
const GH_API_WRITE = /(?:^|\s)(?:-X|--method)(?:\s+|=)?(?!GET\b)[A-Za-z]+|(?:^|\s)(?:-f|-F|--field|--raw-field|--input)(?=[\s=])/i;
const GH_API_BRANCHES = /\brepos\/[^\s/]+\/[^\s/]+\/(?:git\/refs|merges\b|pulls\/[^\s/]+\/merge\b|branches\/)/;

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
  /** The record's clone: a push from it goes to its default branch only. */
  record: string;
  /** The record's default branch. */
  defaultBranch: string;
  /** The branch checked out in a directory, or null. */
  currentBranch(dir: string): string | null;
  /** The other repos the agent may push to: their clone, and whether `main` and `beta` too. */
  writable?: WritableClone[];
  /** A directory's git common dir (absolute), so a worktree is known as its clone's; null when it is not a repo. */
  commonDir?(dir: string): string | null;
  /** The agent's home, for `~` and `$HOME` in a path; the record's parent when not given. */
  home?: string;
}

/** A `git -C` path as the shell would read it: `~` and `$HOME` are the agent's home, a relative one is from `cwd`. */
function pathOf(arg: string, cwd: string, home: string): string {
  const expanded = arg.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, home);
  return isAbsolute(expanded) ? expanded : join(cwd, expanded);
}

export interface WritableClone {
  repo: string;
  dir: string;
  main: boolean;
}

/** Branches of another repo an agent pushes to only when that repo says so: production's. */
export const PROTECTED_BRANCHES = ['main', 'beta'];

/** Where the runner writes, as root, which other repos the agent may push to (a JSON list of WritableClone). */
export const PUSH_RULES = '/run/ghostaff/push.json';

const same = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** The repo the agent may write whose clone, or a worktree of it, `dir` is. */
function writableAt(dir: string, ctx: PushContext): WritableClone | undefined {
  const direct = ctx.writable?.find((w) => same(w.dir, dir));
  if (direct) return direct;
  const common = ctx.commonDir?.(dir);
  return common ? ctx.writable?.find((w) => same(join(w.dir, '.git'), common)) : undefined;
}

/** Why a `gh` call is blocked: a PR against production's branches, or a branch or a merge written through the API. */
function ghReason(args: string, cwd: string, ctx: PushContext): string | null {
  if (GH_API.test(args)) {
    return GH_API_WRITE.test(args) && GH_API_BRANCHES.test(args)
      ? 'Las ramas y los merges no se tocan por la API: push con `git -C <clon> push origin <rama>`, y los PRs con el flujo del repo (`pnpm pr:land`).'
      : null;
  }
  if (!GH_PR_BASE.test(args)) return null;
  const base = /(?:^|\s)(?:--base|-B)(?:\s+|=)(\S+)/.exec(args)?.[1];
  if (!base || !PROTECTED_BRANCHES.includes(base)) return null;
  const named = /(?:^|\s)(?:--repo|-R)(?:\s+|=)?(\S+)/.exec(args)?.[1]?.replace(/^(?:https:\/\/)?github\.com\//, '').replace(/\.git$/, '');
  const repo = named ? ctx.writable?.find((w) => w.repo.toLowerCase() === named.toLowerCase()) : writableAt(cwd, ctx);
  if (repo?.main) return null;
  return `Un PR a \`${base}\`${repo ? ` de \`${repo.repo}\`` : ''} no lo abres tú: es de producción. Ábrelo contra \`develop\` (o la rama base del repo).`;
}

/** Why `command` is blocked, or null when it may run. */
export function blockReason(command: string, cwd: string, ctx: PushContext): string | null {
  const c = onlyWhatRuns(command);
  for (const [re, why] of RULES) if (re.test(c)) return why;
  for (const m of c.matchAll(GH)) {
    const why = ghReason(m.groups?.args ?? '', cwd, ctx);
    if (why) return why;
  }
  for (const m of c.matchAll(PUSH)) {
    const args = m.groups?.args ?? '';
    if (FORCE.test(args)) return 'Nada de push forzado ni de borrar ramas: lo publicado solo avanza.';
    const positional = args.split(/\s+/).filter((p) => p && !p.startsWith('-') && !/[<>]/.test(p));
    const [remote, ...refspecs] = positional;
    if (remote !== undefined && remote !== 'origin') return 'Solo se hace push a `origin`, el registro.';
    if (refspecs.some((r) => r.startsWith('+'))) return 'Nada de push forzado: el registro solo avanza.';
    const dirArg = m.groups?.dir;
    const dir = dirArg ? pathOf(dirArg, cwd, ctx.home ?? dirname(ctx.record)) : cwd;
    const other = writableAt(dir, ctx);
    if (CD.test(c) || (!same(dir, ctx.record) && !other)) {
      const others = ctx.writable?.length ? ` o desde ${ctx.writable.map((w) => w.dir).join(', ')}` : '';
      return `Solo se hace push desde el registro (${ctx.record})${others}, sin \`cd\`: usa \`git -C <clon> push\`.`;
    }
    const targets = refspecs.length ? refspecs.map((r) => r.split(':').pop()!.replace(/^refs\/heads\//, '')) : [ctx.currentBranch(dir)];
    for (const t of targets) {
      const branch = t === 'HEAD' ? ctx.currentBranch(dir) : t;
      if (!other) {
        if (branch !== ctx.defaultBranch) return `Solo se hace push a \`${ctx.defaultBranch}\`, la rama principal del registro.`;
      } else if (!branch) {
        return 'No sé a qué rama va este push: nómbrala (`git -C <clon> push origin <rama>`).';
      } else if (!other.main && PROTECTED_BRANCHES.includes(branch)) {
        return `A \`${branch}\` de \`${other.repo}\` no haces push: es de producción. Usa otra rama (\`develop\` o una tuya).`;
      }
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

/** The other repos the agent may push to, as the runner wrote them; none when the file is missing or unreadable. */
export function readPushRules(path = PUSH_RULES): WritableClone[] {
  try {
    if (!existsSync(path)) return [];
    const rules = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(rules)) return [];
    return rules.filter(
      (r): r is WritableClone => !!r && typeof r.repo === 'string' && typeof r.dir === 'string' && isAbsolute(r.dir) && typeof r.main === 'boolean',
    );
  } catch {
    return [];
  }
}

function main(): number {
  const call = JSON.parse(readFileSync(0, 'utf8')) as { tool_input?: { command?: string }; cwd?: string };
  const record = recordDir(process.env.HOME ?? '/home/agente');
  const head = git(record, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const why = blockReason(call.tool_input?.command ?? '', call.cwd ?? record, {
    record,
    defaultBranch: head?.replace(/^origin\//, '') ?? 'main',
    currentBranch: (d) => git(d, ['symbolic-ref', '--short', 'HEAD']),
    writable: readPushRules(),
    commonDir: (d) => git(d, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    home: process.env.HOME,
  });
  if (!why) return 0;
  process.stderr.write(`Bloqueado por la constitución de los agentes: ${why}\n`);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
