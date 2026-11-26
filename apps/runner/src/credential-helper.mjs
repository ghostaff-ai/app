// git's credential helper for the run's repos (main.ts sets it in the agent's ~/.gitconfig,
// with credential.useHttpPath, so git says which repo it wants): it asks the runner, on
// 127.0.0.1, for that repo's current token, so no token is ever in a URL, a command line,
// a file or Claude Code's environment. The runner answers only for the run's own repos
// (the record and the agent's other repos), each with its own token, and nothing for any
// other host or path. Plain node, no tsx: git calls it on every fetch and push.
//
//   credential.helper = !node /opt/runner/apps/runner/src/credential-helper.mjs <port>
import { readFileSync } from 'node:fs';

const [port, op] = process.argv.slice(2);
if (op !== 'get' || !/^\d{1,5}$/.test(port ?? '')) process.exit(0);
const asked = Object.fromEntries(
  readFileSync(0, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
if (!asked.protocol || !asked.host || !asked.path) process.exit(0);
const query = new URLSearchParams({ protocol: asked.protocol, host: asked.host, path: asked.path });
const res = await fetch(`http://127.0.0.1:${port}/token?${query}`).catch(() => null);
if (!res?.ok) process.exit(0);
const { username, password } = await res.json();
process.stdout.write(`username=${username}\npassword=${password}\n`);
