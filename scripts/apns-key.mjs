#!/usr/bin/env node
// Puts the APNs key, the one the engine signs iPhone pushes with, into an environment's Secret Manager
// as a new version of the secret `apns-auth-key`: `{ teamId, keyId, privateKey }`, the shape the engine
// reads (parseApnsSecret in apps/engine/src/push/apns.ts). The script reads the .p8 itself; the key is
// never printed. Run it once per environment, then deploy the engine (scripts/deploy-engine.sh).
//
//   node scripts/apns-key.mjs beta ~/Downloads/AuthKey_ABC123DEFG.p8 ABC123DEFG 8HWS4483VD
//                             <env> <path-to-.p8>                     <keyId>    <teamId>
//
// Needs node 22 and gcloud signed in with rights on the environment's project (scripts/env.sh says
// which project and which gcloud configuration).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SECRET = 'apns-auth-key';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(message);
  process.exit(2);
}

const [env, p8Path, keyId, teamId] = process.argv.slice(2);
if (!env || !p8Path || !keyId || !teamId) fail('usage: node scripts/apns-key.mjs beta|prod <path-to-.p8> <keyId> <teamId>');
// The engine's checks, and Apple's shape of a Key ID: a secret the engine would refuse is not worth storing.
if (!/^[A-Z0-9]{10}$/.test(teamId)) fail(`teamId must be Apple's 10-character Team ID (got '${teamId}')`);
if (!/^[A-Z0-9]{10}$/.test(keyId)) fail(`keyId must be the key's 10-character Key ID (got '${keyId}')`);
let privateKey;
try {
  privateKey = readFileSync(p8Path, 'utf8').trim();
} catch (e) {
  fail(`cannot read ${p8Path}: ${e.code ?? e.message}`);
}
if (!privateKey.includes('PRIVATE KEY')) fail(`${p8Path} is not a .p8 key (no PRIVATE KEY block)`);

// The environment's project, region and gcloud configuration, from scripts/env.sh: one place for them.
const sourced = spawnSync(
  'bash',
  ['-c', 'source scripts/env.sh "$1" >/dev/null && printf "%s\\n%s\\n%s" "$P" "$R" "${CLOUDSDK_ACTIVE_CONFIG_NAME:-}"', '_', env],
  { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
);
if (sourced.status !== 0) process.exit(sourced.status ?? 2);
const [project, region, config] = sourced.stdout.split('\n');
const gcloudEnv = { ...process.env, ...(config ? { CLOUDSDK_ACTIVE_CONFIG_NAME: config } : {}) };
const gcloud = (args, opts = {}) => spawnSync('gcloud', [...args, '--project', project], { env: gcloudEnv, ...opts });

const secret = JSON.stringify({ teamId, keyId, privateKey });
const exists = gcloud(['secrets', 'describe', SECRET], { stdio: 'ignore' }).status === 0;
const args = exists
  ? ['secrets', 'versions', 'add', SECRET, '--data-file=-']
  : ['secrets', 'create', SECRET, '--replication-policy', 'user-managed', '--locations', region, '--data-file=-'];
// Pipe to pipe: the key goes on gcloud's stdin, never on a command line or the screen.
const stored = gcloud(args, { input: secret, stdio: ['pipe', 'inherit', 'inherit'] });
if (stored.status !== 0) fail(`gcloud could not store ${SECRET} in ${project} (exit ${stored.status})`);
// The engine reads it: it administers the project's secrets (scripts/setup-env.sh), so no grant is needed here.
console.log(`APNs key ${keyId} (team ${teamId}) stored as ${SECRET} in ${project}. Deploy the engine to use it: bash scripts/deploy-engine.sh ${env}`);
