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
// agent's other repos with a token each, the organisation's Claude subscription
// and, when it has one, a token as its own Google Cloud account, kept in a file
// root renews), serves each repo's token to git on 127.0.0.1 through a credential
// helper, for that repo only, clones the record and the other repos (shallow
// when read-only) as the user `agente` and runs the unmodified Claude Code there as `agente`, with nothing
// in its environment but its credential, HOME, PATH and LANG, its Google Cloud and the organisation's
// secrets its agent row names (every one of them hidden from what this process prints, keeps and reports).
// It keeps Claude Code's stream-json, redacted, in a file of its own, and serves the agent its earlier runs
// on 127.0.0.1 (pastRuns.ts). At the end, or on any crash before it, it sends the transcript and reports to
// the engine (best effort).

import { spawn } from 'node:child_process';
import { chmodSync, chownSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { run as runCommand } from './exec';
import { PUSH_RULES, recordDir } from './guard';
import { servePastRuns } from './pastRuns';
import { type RepoCredential, serveTokens } from './tokens';
import {
  agentEnv,
  claudeArgs,
  cloneArgs,
  crashText,
  credentialKeyOf,
  decisionFiles,
  engineClosedRun,
  failureText,
  gitEnv,
  newDecisions,
  noteworthy,
  passwdIds,
  pushRules,
  type GoogleAccess,
  readSpec,
  redact,
  reposDir,
  type Report,
  resultOf,
  type RunSpec,
  transcriptSink,
  usageOf,
  tokenNearExpiry,
  endingOf,
} from './lib';

const METADATA_IDENTITY = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';
const HELPER = '/opt/runner/apps/runner/src/credential-helper.mjs';
const AGENT_USER = 'agente';

const run = process.env.GHOSTAFF_RUN ?? '';
const nonce = process.env.GHOSTAFF_NONCE ?? '';
const engine = (process.env.ENGINE_URL ?? '').replace(/\/+$/, '');
delete process.env.GHOSTAFF_NONCE;

/** Every secret this run holds, so none is ever printed, reported or kept in the transcript. */
const secrets: string[] = [nonce];
let reported = false;
/** The run's transcript, root's alone until it is sent: set once Claude Code starts. */
let transcript: string | null = null;

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

/**
 * Sends the run's transcript to the engine (transcripts.ts), gzipped, before the report: once the run has
 * reported, the engine takes nothing more from it. Best effort: a run without one still reports.
 */
async function sendTranscript(): Promise<void> {
  if (!transcript || !existsSync(transcript) || statSync(transcript).size === 0) return;
  try {
    const res = await fetch(`${engine}/runs/${run}/transcript`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await idToken()}`, 'X-Ghostaff-Nonce': nonce, 'Content-Type': 'application/gzip' },
      body: gzipSync(readFileSync(transcript)),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) console.error(`the engine refused the transcript: ${res.status}`);
  } catch (e) {
    console.error('transcript not sent', crashText(e, secrets));
  }
}

async function report(r: Omit<Report, 'run' | 'nonce'>): Promise<void> {
  if (reported || !engine || !run) return;
  reported = true;
  await sendTranscript();
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

/**
 * The organisation's Google Cloud token, in a file `gcloud` and `bq` read on every call
 * (CLOUDSDK_AUTH_ACCESS_TOKEN_FILE). Root writes it and renews it through the engine before it
 * expires; the agent can read it, not replace it: the folder is root's, the file root's and its group's.
 */
function serveGoogleToken(first: GoogleAccess, gid: number): { file: string; close(): void } {
  const dir = mkdtempSync('/tmp/ghostaff-gcloud-');
  chmodSync(dir, 0o711);
  const file = join(dir, 'token');
  const write = (token: string) => {
    const next = join(dir, 'token.next');
    writeFileSync(next, token, { mode: 0o640 });
    chownSync(next, 0, gid);
    chmodSync(next, 0o640);
    renameSync(next, file);
  };
  write(first.token);
  let expiresAt = first.expiresAt;
  let renewing = false;
  const timer = setInterval(async () => {
    if (renewing || !tokenNearExpiry(expiresAt, Date.now())) return;
    renewing = true;
    try {
      const r = await callEngine(`/runs/${run}/google-token`, { nonce });
      if (r.ok) {
        const fresh = (await r.json()) as { token: string; expiresAt: string };
        secrets.push(fresh.token);
        write(fresh.token);
        expiresAt = fresh.expiresAt;
      }
    } catch (e) {
      console.error('google token not renewed', crashText(e, secrets));
    } finally {
      renewing = false;
    }
  }, 30_000);
  return {
    file,
    close() {
      clearInterval(timer);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** git as the agent, never blocking: the record token server above answers git's helper from this process (exec.ts). */
function asAgent(ids: { uid: number; gid: number }, env: Record<string, string>, cwd?: string) {
  return (args: string[]) => runCommand('git', args, { uid: ids.uid, gid: ids.gid, env, cwd: cwd ?? env.HOME });
}

const yamlNames = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.yaml')) : []);

/**
 * Runs Claude Code as the agent; its exit code (null when killed), its last stream-json line, and what it used.
 * Each line goes, redacted, to the logs and to the run's transcript (`transcriptFile`, root's alone).
 */
function runClaude(
  spec: RunSpec,
  ids: { uid: number; gid: number; home: string },
  cwd: string,
  google: { tokenFile: string; project: string | null } | null,
  pastRuns: string,
  transcriptFile: string,
): Promise<{ code: number | null; last: string; usage?: unknown; rateLimit?: unknown }> {
  return new Promise((resolve, reject) => {
    const fd = openSync(transcriptFile, 'w', 0o600);
    const sink = transcriptSink((text) => writeSync(fd, text));
    const child = spawn('claude', claudeArgs(spec), {
      uid: ids.uid,
      gid: ids.gid,
      cwd,
      env: agentEnv(spec.claudeToken, ids.home, google, pastRuns, spec.secrets),
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    let last = '';
    const used: { usage?: unknown; rateLimit?: unknown } = {};
    child.on('error', (e) => {
      closeSync(fd);
      reject(e);
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      last = line;
      Object.assign(used, usageOf(line));
      const clean = redact(line, secrets);
      process.stdout.write(`${clean}\n`);
      sink.line(clean);
    });
    child.on('close', (code) => {
      sink.end(redact(last, secrets));
      closeSync(fd);
      resolve({ code, last, ...used });
    });
    child.stdin.end(spec.prompt);
  });
}

async function main(): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(run) || nonce.length < 32 || !/^https?:\/\//.test(engine)) {
    throw new Error('set GHOSTAFF_RUN, GHOSTAFF_NONCE and ENGINE_URL');
  }
  const res = await callEngine(`/runs/${run}/spec`, { nonce });
  if (!res.ok) {
    // The engine closed the run itself (no subscription, no record) and said why in Ghostaff;
    // any other refusal leaves the run open, and the failure report below closes it.
    reported = engineClosedRun(res.status, await res.json().catch(() => null));
    throw new Error(`the engine refused the spec: ${res.status}`);
  }
  const spec = readSpec(await res.json());
  const others = spec.repos ?? [];
  // Every secret of the run, before anything starts that could print one: none is ever printed or reported.
  secrets.push(spec.claudeToken, spec.record.token, ...others.map((r) => r.token), ...(spec.secrets ?? []).map((s) => s.value));
  if (spec.google) secrets.push(spec.google.token);

  const ids = passwdIds(readFileSync('/etc/passwd', 'utf8'), AGENT_USER);
  const credentials = new Map<string, RepoCredential>([
    [credentialKeyOf(spec.record.cloneUrl), { ...spec.record, renew: () => callEngine(`/runs/${run}/record-token`, { nonce }) }],
    ...others.map((r): [string, RepoCredential] => [
      credentialKeyOf(r.cloneUrl),
      { username: 'x-access-token', token: r.token, expiresAt: r.expiresAt, renew: () => callEngine(`/runs/${run}/repo-token`, { nonce, repo: r.repo }) },
    ]),
  ]);
  const tokens = await serveTokens(credentials, (token) => secrets.push(token), (e) => console.error('repo token not renewed', crashText(e, secrets)));
  const google = spec.google ? serveGoogleToken(spec.google, ids.gid) : null;
  // Earlier runs for the agent's `ghostaff` command, asked of the engine with this run's nonce.
  const past = await servePastRuns(
    (path, body) => callEngine(`/runs/${run}${path}`, { ...body, nonce }),
    (e) => console.error('earlier runs not read', crashText(e, secrets)),
  );
  // Root's folder (0700): the agent can neither read the transcript nor change what is sent.
  const transcriptDir = mkdtempSync('/tmp/ghostaff-transcript-');
  try {
    const env = gitEnv(ids.home);
    const git = asAgent(ids, env);
    await git(['config', '--global', 'user.name', spec.author.name]);
    await git(['config', '--global', 'user.email', spec.author.email]);
    // git says which repo it wants (useHttpPath), and the helper answers only for the run's own, each with its token.
    await git(['config', '--global', 'credential.helper', `!node ${HELPER} ${tokens.port}`]);
    await git(['config', '--global', 'credential.useHttpPath', 'true']);
    await git(['config', '--global', 'push.default', 'current']);
    const record = recordDir(ids.home);
    await git(['clone', '--quiet', spec.record.cloneUrl, record]);
    if (existsSync(join(record, '.githooks'))) await asAgent(ids, env, record)(['config', 'core.hooksPath', '.githooks']);
    // The other repos: one that does not clone leaves the run going without it.
    const cloned = new Set<string>();
    for (const r of others) {
      const dir = join(reposDir(ids.home), r.dir);
      try {
        await git(cloneArgs(r, dir));
        if (r.write && existsSync(join(dir, '.githooks'))) await asAgent(ids, env, dir)(['config', 'core.hooksPath', '.githooks']);
        cloned.add(r.repo);
      } catch (e) {
        console.error('repo not cloned', r.repo, crashText(e, secrets));
      }
    }
    // Which of them the agent may push to, for the guard: root's, readable, never the agent's to change.
    mkdirSync(dirname(PUSH_RULES), { recursive: true, mode: 0o755 });
    writeFileSync(PUSH_RULES, JSON.stringify(pushRules(others, ids.home, cloned)), { mode: 0o644 });

    const decisions = join(record, spec.decisionsDir);
    const before = new Set(yamlNames(decisions));
    transcript = join(transcriptDir, 'run.jsonl');
    const { code, last, usage, rateLimit } = await runClaude(
      spec,
      ids,
      record,
      google && spec.google ? { tokenFile: google.file, project: spec.google.project } : null,
      past.url,
      transcript,
    );
    const result = resultOf(last);
    const ok = code === 0 && result.ok;
    const opened = newDecisions(decisionFiles(decisions), before, spec.slug, secrets);
    await report({
      ok,
      text: ok ? result.text : failureText(code, result.text),
      noteworthy: !ok || noteworthy(result.text) || opened.length > 0,
      decisions: opened,
      usage,
      rateLimit,
      model: spec.model,
      ...endingOf(last),
    });
    return ok ? 0 : 1;
  } finally {
    tokens.close();
    google?.close();
    past.close();
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
