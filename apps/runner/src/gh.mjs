// `gh` for the agent (the image's /usr/local/bin/gh runs this before the real one at /usr/bin/gh), the way
// credential-helper.mjs is git's: it works out which repo the call is for, asks the runner on 127.0.0.1
// (GHOSTAFF_TOKENS, tokens.ts) for that repo's current token, and runs the real gh with it as GH_TOKEN, for
// that one process. No token is in Claude Code's environment, a file or a command line. The runner answers
// only for a repo whose pull requests the agent handles (agents.repos `prs`), whose token may do that;
// any other repo, the record included, gets no gh. Plain node, no tsx: pr:land calls gh dozens of times.
//
//   gh <args>  →  node /opt/runner/apps/runner/src/gh.mjs /usr/bin/gh <args>
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** `owner/name` from what gh takes for a repo: `owner/name`, `github.com/owner/name`, or its URL; null for anything else. */
function repoName(s) {
  if (typeof s !== 'string') return null;
  const m = /^(?:(?:https:\/\/)?github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(s.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Which repo a gh call is for, as gh itself decides it: `-R`/`--repo`, then GH_REPO, then (for `gh api`) a
 * `repos/<owner>/<name>/…` path, then the `origin` of the clone it runs in. Null when nothing says.
 */
export function ghRepo(args, env, originUrl) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') break;
    if (a === '-R' || a === '--repo') return repoName(args[i + 1]);
    if (a.startsWith('--repo=')) return repoName(a.slice('--repo='.length));
    if (/^-R./.test(a)) return repoName(a.slice(2));
  }
  if (env.GH_REPO) return repoName(env.GH_REPO);
  if (args[0] === 'api') {
    const path = args.slice(1).find((a) => /^\/?repos\//.test(a));
    const m = path ? /^\/?repos\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[/?#]|$)/.exec(path) : null;
    if (m) return `${m[1]}/${m[2]}`;
  }
  return repoName(originUrl());
}

function origin() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The repo's token from the runner: `{ token }`, or `{ repos }` with the ones gh may use, or null when it cannot ask. */
async function tokenFor(repo) {
  const base = process.env.GHOSTAFF_TOKENS;
  if (!base || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(base)) return null;
  const res = await fetch(`${base}/gh?${new URLSearchParams({ repo })}`).catch(() => null);
  if (!res) return null;
  return res.json().catch(() => null);
}

const list = (repos) => repos.map((r) => `\`${r}\``).join(', ');

async function main() {
  const [real, ...args] = process.argv.slice(2);
  const env = { ...process.env, GH_HOST: 'github.com', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.GH_ENTERPRISE_TOKEN;
  delete env.GITHUB_ENTERPRISE_TOKEN;
  delete env.GHOSTAFF_TOKENS;
  const repo = ghRepo(args, process.env, origin);
  if (repo) {
    const answer = await tokenFor(repo);
    if (!answer?.token) {
      const repos = Array.isArray(answer?.repos) ? answer.repos : [];
      process.stderr.write(
        repos.length
          ? `gh: aquí solo funciona con ${list(repos)}, no con \`${repo}\`. Pásale -R <owner/repo> o úsalo desde su clon.\n`
          : `gh: en esta ejecución no tienes ningún repo con gh, y \`${repo}\` tampoco.\n`,
      );
      return 4;
    }
    env.GH_TOKEN = answer.token;
  }
  const r = spawnSync(real, args, { stdio: 'inherit', env });
  if (r.error) {
    process.stderr.write(`gh: ${r.error.message}\n`);
    return 1;
  }
  if (r.signal) process.kill(process.pid, r.signal);
  return r.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await main();
