// git's credential helper for the record (main.ts sets it in the agent's ~/.gitconfig):
// it asks the runner, on 127.0.0.1, for the record's current GitHub token, so the token
// is never in a URL, a command line, a file or Claude Code's environment. Plain node, no
// tsx: git calls it on every fetch and push.
//
//   credential.helper = !node /opt/runner/apps/runner/src/credential-helper.mjs <port>
import { readFileSync } from 'node:fs';

const [port, op] = process.argv.slice(2);
if (op !== 'get') process.exit(0);
const asked = Object.fromEntries(
  readFileSync(0, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (asked.protocol !== 'https' || asked.host !== 'github.com') process.exit(0);
const res = await fetch(`http://127.0.0.1:${port}/token`).catch(() => null);
if (!res?.ok) process.exit(0);
process.stdout.write(`username=x-access-token\npassword=${(await res.text()).trim()}\n`);
