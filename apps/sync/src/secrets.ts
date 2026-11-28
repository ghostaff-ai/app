// `org set-secret`: an organisation's secret into the vault, for the agents whose row names it
// (agents.secrets; docs/plans/ongoing/ordago-agents-in-ghostaff.md, «What Ghostaff builds for it», item 3).
//
// The vault is Secret Manager in the environment's own Google Cloud project (apps/engine/src/vault.ts),
// written here through `gcloud` as whoever runs the command, like scripts/connector-app.sh. The value comes
// from a hidden prompt or stdin and reaches gcloud on its stdin: never argv, never a file, never printed.

import { execFileSync } from 'node:child_process';
import { cleanSecretValue, secretLabelFromName, secretValueProblem } from '@ghostaff/shared';
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

/** The value as typed or piped: one trailing newline dropped, and refused if `redact` could not hide it or an environment could not hold it (the engine's rule too). */
export function secretValue(raw: string): string {
  const value = cleanSecretValue(raw);
  const problem = secretValueProblem(value);
  if (problem === 'too_short') throw new Error('The value is shorter than 8 characters: the runner could not hide it from its logs.');
  if (problem === 'too_long') throw new Error('The value is longer than 64 KB.');
  if (problem === 'nul') throw new Error('The value has a NUL character, which no environment variable can hold.');
  return value;
}

/** Who stored a key when no person did: `org set-secret` and the backfill are Ghostaff's support. */
export const OPERATOR_NAME = 'Ghostaff';

/** What the org_secrets row already says about a key, when there is one. */
export interface ExistingKeyRow {
  label: string;
  maker: string | null;
  stored_at: string | null;
}

function labelAndMaker(p: { name: string; existing: ExistingKeyRow | null; label?: string; maker?: string }) {
  const label = p.label?.trim() || p.existing?.label || secretLabelFromName(p.name);
  if (label.length > 80) throw new Error('--label is at most 80 characters');
  const maker = p.maker ?? p.existing?.maker ?? null;
  if (maker !== null && !/^[a-z][a-z0-9-]{0,40}$/.test(maker)) throw new Error('--maker is lower case, digits and hyphens (elevenlabs, gmail…)');
  return { label, maker };
}

/**
 * The org_secrets row `org set-secret` writes with the value (docs/plans/ongoing/secrets-from-the-app.md): stored
 * now by Ghostaff, healthy again. A label or maker a person gave stays unless new ones are given; a member's
 * value waiting for an owner is left as it is.
 */
export function storedRow(p: { orgId: string; name: string; existing: ExistingKeyRow | null; at: string; label?: string; maker?: string }) {
  return {
    org_id: p.orgId,
    name: p.name,
    ...labelAndMaker(p),
    stored_by: null,
    stored_by_name: OPERATOR_NAME,
    stored_at: p.at,
    status: 'ok' as const,
    updated_at: p.at,
  };
}

/**
 * `org register-secrets`: the row of a secret the vault already has (stored before the rows existed), as Ghostaff
 * on the day the vault made it. One already listed only gets the label or maker given; null when nothing changes.
 */
export interface RegisteredRow {
  org_id: string;
  name: string;
  label: string;
  maker: string | null;
  updated_at: string;
  stored_by?: null;
  stored_by_name?: string;
  stored_at?: string;
}

export function registeredRow(p: { orgId: string; name: string; existing: ExistingKeyRow | null; createdAt: string; at: string; label?: string; maker?: string }): RegisteredRow | null {
  const { label, maker } = labelAndMaker(p);
  if (p.existing) {
    if (label === p.existing.label && maker === p.existing.maker) return null;
    return { org_id: p.orgId, name: p.name, label, maker, updated_at: p.at };
  }
  return { org_id: p.orgId, name: p.name, label, maker, stored_by: null, stored_by_name: OPERATOR_NAME, stored_at: p.createdAt, updated_at: p.at };
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

/** When the vault made the secret (RFC 3339), or null when it has none by that id. Reads no value. */
export function vaultCreatedAt(run: Gcloud, project: string, id: string): string | null {
  try {
    return run(['secrets', 'describe', id, '--project', project, '--format', 'value(createTime)']).trim() || null;
  } catch (e) {
    // Only «there is none» is null: a gcloud that cannot read the project must not read as an empty vault.
    if (e instanceof Error && /NOT_FOUND|not found/i.test(e.message)) return null;
    throw e;
  }
}
