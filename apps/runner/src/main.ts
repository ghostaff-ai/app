// Ghostaff's agent runner: one run of one agent, from start to end, as one
// execution of the Cloud Run job `agent-runner` in ghostaff-prod
// (docs/plans/ongoing/ordago-agents-in-ghostaff.md, «Our runner»).
//
// The engine starts it with three variables only:
//   GHOSTAFF_RUN    the run (a row in agent_runs)
//   GHOSTAFF_NONCE  the run's one-time nonce; the engine keeps only its hash
//   ENGINE_URL      where to fetch the spec and report
//
// This process is root, and keeps every secret to itself. It proves who it is
// with a Google ID token from the metadata server and the nonce, fetches its
// spec once (prompt, model, tools, the record and a GitHub token for it, the
// organisation's Claude subscription), serves the record token to git on
// 127.0.0.1 through a credential helper, clones the record as the user
// `agente` and runs the unmodified Claude Code there as `agente`, with nothing
// in its environment but its credential, HOME, PATH and LANG. At the end, or
// on any crash before it, it reports to the engine (best effort).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { recordDir } from './guard';
import {
  agentEnv,
  claudeArgs,
  crashText,
  failureText,
  gitEnv,
  newDecisions,
  noteworthy,
  passwdIds,
  readSpec,
  redact,
  type Report,
  resultOf,
  type RunSpec,
} from './lib';

const METADATA_IDENTITY = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
const HELPER = '/opt/runner/apps/runner/src/credential-helper.mjs';
const AGENT_USER = 'agente';
/** A record token lasts an hour; a fresh one is asked for after this. */
const TOKEN_FRESH_MS = 40 * 60_000;

const run = process.env.GHOSTAFF_RUN ?? '';
const nonce = process.env.GHOSTAFF_NONCE ?? '';
const engine = (process.env.ENGINE_URL ?? '').replace(/\/+$/, '');
delete process.env.GHOSTAFF_NONCE;

/** Every secret this run holds, so none is ever printed or reported. */
const secrets: string[] = [nonce];
let reported = false;

async function idToken(): Promise<string> {
  const url = `${METADATA_IDENTITY}?${new URLSearchParams({ audience: engine, format: 'full' })}`;
  const res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`metadata server ${res.status}`);
  return (await res.text()).trim();
}

async function callEngine(path: string, body: unknown, timeoutMs = 60_000): Promise<Response> {
  return fetch(`${engine}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await idToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function report(r: Omit<Report, 'run' | 'nonce'>): Promise<void> {
  if (reported || !engine || !run) return;
  reported = true;
  const body: Report = { run, nonce, ...r, text: r.text === null ? null : redact(r.text, secrets) };
  // The engine answers once the reply is in its thread and the record is read: it gets time.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await callEngine('/runs/report', body, 300_000);
      if (res.ok) return;
      console.error(`the engine refused the report: ${res.status}`);
      if (res.status < 500) return;
    } catch (e) {
      console.error('report not sent', crashText(e, secrets));
    }
    if (attempt < 2) await new Promise((ok) => setTimeout(ok, 5_000 * (attempt + 1)));
  }
}

/** The record token for git, on 127.0.0.1 only, renewed through the engine before it expires. */
async function serveRecordToken(first: string): Promise<{ port: number; close(): void }> {
  let token = first;
  let since = Date.now();
  const server = createServer(async (req, res) => {
    if (req.url !== '/token') return res.writeHead(404).end();
    try {
      if (Date.now() - since > TOKEN_FRESH_MS) {
        const r = await callEngine(`/runs/${run}/record-token`, { nonce });
        if (r.ok) {
          token = ((await r.json()) as { token: string }).token;
          secrets.push(token);
          since = Date.now();
        }
      }
    } catch (e) {
      console.error('record token not renewed', crashText(e, secrets));
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end(token);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { port: (server.address() as AddressInfo).port, close: () => server.close() };
}

function asAgent(ids: { uid: number; gid: number }, env: Record<string, string>, cwd?: string) {
  return (args: string[]) => {
    const r = spawnSync('git', args, { uid: ids.uid, gid: ids.gid, env, cwd: cwd ?? env.HOME, stdio: ['ignore', 'inherit', 'inherit'] });
    if (r.status !== 0) throw new Error(`git ${args[0]} failed (${r.status ?? r.signal})`);
  };
}

const yamlNames = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.yaml')) : []);

/** Runs Claude Code as the agent; its exit code (null when killed) and its last stream-json line. */
function runClaude(spec: RunSpec, ids: { uid: number; gid: number; home: string }, cwd: string): Promise<{ code: number | null; last: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', claudeArgs(spec), {
      uid: ids.uid,
      gid: ids.gid,
      cwd,
      env: agentEnv(spec.claudeToken, ids.home),
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let last = '';
    child.on('error', reject);
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      last = line;
      process.stdout.write(`${redact(line, secrets)}\n`);
    });
    child.on('close', (code) => resolve({ code, last }));
    child.stdin.end(spec.prompt);
  });
}

async function main(): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(run) || nonce.length < 32 || !/^https?:\/\//.test(engine)) {
    throw new Error('set GHOSTAFF_RUN, GHOSTAFF_NONCE and ENGINE_URL');
  }
  const res = await callEngine(`/runs/${run}/spec`, { nonce });
  if (!res.ok) {
    // 409: the engine closed the run itself (no subscription, no record) and said why in Ghostaff.
    reported = res.status === 409;
    throw new Error(`the engine refused the spec: ${res.status}`);
  }
  const spec = readSpec(await res.json());
  secrets.push(spec.claudeToken, spec.record.token);

  const ids = passwdIds(readFileSync('/etc/passwd', 'utf8'), AGENT_USER);
  const tokens = await serveRecordToken(spec.record.token);
  try {
    const env = gitEnv(ids.home);
    const git = asAgent(ids, env);
    git(['config', '--global', 'user.name', spec.author.name]);
    git(['config', '--global', 'user.email', spec.author.email]);
    git(['config', '--global', 'credential.helper', `!node ${HELPER} ${tokens.port}`]);
    git(['config', '--global', 'push.default', 'current']);
    const record = recordDir(ids.home);
    git(['clone', '--quiet', `https://github.com/${spec.record.repo}.git`, record]);
    if (existsSync(join(record, '.githooks'))) asAgent(ids, env, record)(['config', 'core.hooksPath', '.githooks']);

    const decisions = join(record, spec.decisionsDir);
    const before = new Set(yamlNames(decisions));
    const { code, last } = await runClaude(spec, ids, record);
    const result = resultOf(last);
    const ok = code === 0 && result.ok;
    const opened = newDecisions(
      yamlNames(decisions).map((name) => ({ name, content: readFileSync(join(decisions, name), 'utf8') })),
      before,
      spec.slug,
    );
    await report({
      ok,
      text: ok ? result.text : failureText(code, result.text),
      noteworthy: !ok || noteworthy(result.text) || opened.length > 0,
      decisions: opened,
    });
    return ok ? 0 : 1;
  } finally {
    tokens.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch(async (e: unknown) => {
    const what = crashText(e, secrets);
    console.error('run failed', what);
    await report({ ok: false, text: `Se cortó antes de acabar (${what}).`, noteworthy: true, decisions: [] }).catch(() => {});
    process.exit(1);
  });
