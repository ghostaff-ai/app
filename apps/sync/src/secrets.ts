// `org set-secret`: an organisation's secret into the vault, for the agents whose row names it
// (agents.secrets; docs/plans/ongoing/ordago-agents-in-ghostaff.md, «What Ghostaff builds for it», item 3).
//
// The vault is Secret Manager in the environment's own Google Cloud project (apps/engine/src/vault.ts),
// written here through `gcloud` as whoever runs the command, like scripts/connector-app.sh. The value comes
// from a hidden prompt or stdin and reaches gcloud on its stdin: never argv, never a file, never printed.

import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

/**
 * Each hosted Supabase project's Google Cloud project (scripts/env.sh): the secret goes to the vault of the
 * environment whose database names it, never another.
 */
const VAULT_PROJECTS: Record<string, string> = {
  rggvcvnstbitbdptiwtk: 'ghostaff-beta',
  krhhndjjqmmkzjmwwazv: 'ghostaff-prod',
};

/** Where the engine keeps its secrets: one EU region, never automatic replication (SECRETS_LOCATION). */
export const VAULT_LOCATION = 'europe-west1';

/** The Google Cloud project whose vault goes with this Supabase project. */
export function vaultProjectFor(supabaseUrl: string): string {
  const ref = /^https:\/\/([a-z0-9]{20})\.supabase\.co\/?$/.exec(supabaseUrl)?.[1];
  const project = ref ? VAULT_PROJECTS[ref] : undefined;
  if (!project) {
    throw new Error(
      `No vault for ${supabaseUrl}: a local engine keeps its keys in memory (VAULT=memory). Use the beta or production service-role key.`,
    );
  }
  return project;
}

/** The value as typed or piped: one trailing newline dropped, and refused if `redact` could not hide it or an environment could not hold it. */
export function secretValue(raw: string): string {
  const value = raw.replace(/\r?\n$/, '');
  if (value.length < 8) throw new Error('The value is shorter than 8 characters: the runner could not hide it from its logs.');
  if (value.length > 65536) throw new Error('The value is longer than 64 KB.');
  if (value.includes('\0')) throw new Error('The value has a NUL character, which no environment variable can hold.');
  return value;
}

/** Reads a line without echoing it. */
function readHidden(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const muted = new Writable({ write: (_chunk, _enc, done) => done() });
  const rl = createInterface({ input: process.stdin, output: muted, terminal: true });
  return new Promise((resolve) =>
    rl.question('', (line) => {
      rl.close();
      process.stderr.write('\n');
      resolve(line);
    }),
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** The value from a hidden prompt, typed twice, or from stdin when it is piped. */
export async function readSecretValue(name: string): Promise<string> {
  if (!process.stdin.isTTY) return secretValue(await readStdin());
  const first = await readHidden(`Value of «${name}» (hidden): `);
  const again = await readHidden('Again: ');
  if (first !== again) throw new Error('The two values differ: nothing stored.');
  return secretValue(first);
}

/** One gcloud call: its stdout, or an error with gcloud's own message (which never holds the value: that goes on stdin). */
export type Gcloud = (args: string[], input?: string) => string;

export const gcloud: Gcloud = (args, input) => {
  try {
    return execFileSync('gcloud', args, { input: input ?? '', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    const said = (e as { stderr?: string }).stderr?.trim();
    throw new Error(`gcloud ${args.slice(0, 3).join(' ')} failed${said ? `: ${said}` : ''}`);
  }
};

/**
 * Creates the secret if needed (EU only, labelled with its organisation), makes `value` its only live version
 * and destroys the ones before it: the same as the engine's SecretManagerVault.put.
 */
export function putSecret(run: Gcloud, p: { project: string; id: string; value: string; labels: Record<string, string> }): void {
  const at = ['--project', p.project];
  let exists = true;
  try {
    run(['secrets', 'describe', p.id, ...at, '--format', 'value(name)']);
  } catch {
    exists = false;
  }
  if (!exists) {
    const labels = Object.entries(p.labels).map(([k, v]) => `${k}=${v}`).join(',');
    run(['secrets', 'create', p.id, ...at, '--replication-policy', 'user-managed', '--locations', VAULT_LOCATION, '--labels', labels]);
  }
  const added = run(['secrets', 'versions', 'add', p.id, ...at, '--data-file=-', '--format', 'value(name.basename())'], p.value).trim();
  const enabled = run(['secrets', 'versions', 'list', p.id, ...at, '--filter', 'state=ENABLED', '--format', 'value(name.basename())'])
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
  // Never destroy anything without knowing which version is the new one.
  if (!/^\d+$/.test(added) || !enabled.includes(added)) throw new Error(`gcloud did not confirm the new version of ${p.id}: older versions kept`);
  for (const v of enabled) if (v !== added) run(['secrets', 'versions', 'destroy', v, '--secret', p.id, ...at, '--quiet']);
}
