#!/usr/bin/env node
// Creates our GitHub App «Ghostaff Registro», the record connector
// (docs/plans/ongoing/ordago-agents-in-ghostaff.md), from a manifest: two clicks
// in the browser, and the App's private key goes straight into Secret Manager
// in ghostaff-prod. It is never written to disk or printed.
//
//   node scripts/github-app-registro.mjs
//
// 1. Opens a local page that sends GitHub the App's settings; GitHub asks you to
//    confirm («Create GitHub App for ghostaff-ai»).
// 2. GitHub comes back here with a one-time code; the script swaps it for the App
//    and its key, and stores the key as the secret `github-app-registro-key`.
// 3. Opens the App's install page: install it on ordago-app, «Only select
//    repositories», `business`. The script waits for that and prints the two
//    numbers the next steps need (the App id and the installation id).
//
// Needs node 22, gcloud with the `ghostaff` configuration (ghostaff.ai@gmail.com).

import { spawn, spawnSync } from 'node:child_process';
import { createSign, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const ORG = 'ghostaff-ai';
const PORT = 47321;
const PROJECT = 'ghostaff-prod';
const REGION = 'europe-west1';
const SECRET = 'github-app-registro-key';
const GCLOUD_ENV = { ...process.env, CLOUDSDK_ACTIVE_CONFIG_NAME: process.env.CLOUDSDK_ACTIVE_CONFIG_NAME ?? 'ghostaff' };
const state = randomBytes(16).toString('hex');
const back = `http://127.0.0.1:${PORT}`;

const manifest = {
  name: 'Ghostaff Registro',
  url: 'https://ghostaff.ai',
  description: 'Ghostaff lee y escribe el registro de tu organización: las decisiones por tomar y sus respuestas.',
  hook_attributes: { url: 'https://ghostaff.ai', active: false },
  redirect_url: `${back}/creada`,
  // Installable by any account: each organisation installs it on its own record repo.
  public: true,
  // contents for the record and the agents' repos; actions to read a repo's CI queue (an agent's `ritmo`); pull
  // requests, issues, checks and statuses for an agent that handles a repo's PRs with `gh` (agents.repos `prs`).
  // Each token asks only for what its use needs (apps/engine/src/githubApp.ts repoPermissions).
  default_permissions: {
    contents: 'write',
    metadata: 'read',
    actions: 'read',
    pull_requests: 'write',
    issues: 'write',
    checks: 'read',
    statuses: 'read',
  },
  default_events: [],
};

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const page = (body) => `<!doctype html><meta charset="utf-8"><title>Ghostaff Registro</title>
<body style="font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem">${body}</body>`;

function appJwt(appId, pem) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000) - 60;
  const head = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat, exp: iat + 540, iss: String(appId) })}`;
  return `${head}.${createSign('RSA-SHA256').update(head).sign(pem).toString('base64url')}`;
}

function storeKey(pem) {
  const exists = spawnSync('gcloud', ['secrets', 'describe', SECRET, '--project', PROJECT], { env: GCLOUD_ENV, stdio: 'ignore' }).status === 0;
  const args = exists
    ? ['secrets', 'versions', 'add', SECRET, '--project', PROJECT, '--data-file=-']
    : ['secrets', 'create', SECRET, '--project', PROJECT, '--replication-policy', 'user-managed', '--locations', REGION, '--data-file=-'];
  const r = spawnSync('gcloud', args, { env: GCLOUD_ENV, input: pem, stdio: ['pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`gcloud could not store the key (exit ${r.status})`);
  // The engine reads it.
  spawnSync('gcloud', ['secrets', 'add-iam-policy-binding', SECRET, '--project', PROJECT,
    '--member', `serviceAccount:engine@${PROJECT}.iam.gserviceaccount.com`, '--role', 'roles/secretmanager.secretAccessor'],
    { env: GCLOUD_ENV, stdio: 'ignore' });
}

async function waitForInstall(app, pem) {
  console.log('\nWaiting for you to install it on ordago-app (only the repo `business`)…');
  for (let i = 0; i < 120; i++) {
    const res = await fetch('https://api.github.com/app/installations', {
      headers: { Authorization: `Bearer ${appJwt(app.id, pem)}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ghostaff' },
    });
    const list = res.ok ? await res.json() : [];
    const found = list.find((x) => x.account?.login?.toLowerCase() === 'ordago-app');
    if (found) {
      console.log(`\nDone.\n  App id:          ${app.id}\n  Installation id: ${found.id}\n`);
      console.log('Tell the agent these two numbers; neither is a secret.');
      return;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  console.log(`\nNot installed after 10 minutes. The App id is ${app.id}; install it later from https://github.com/apps/${app.slug}/installations/new`);
}

function open(url) {
  const profile = process.env.CHROME_PROFILE ?? 'Default';
  const child = spawn('chrome-open', [profile, url], { stdio: 'ignore', detached: true });
  child.on('error', () => console.log(`Open this in your browser: ${url}`));
  child.unref();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, back);
  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(`<p>Enviando la configuración de «Ghostaff Registro» a GitHub…</p>
<form id="f" method="post" action="https://github.com/organizations/${ORG}/settings/apps/new?state=${state}">
<input type="hidden" name="manifest" value="${esc(JSON.stringify(manifest))}"><button>Continuar en GitHub</button></form>
<script>document.getElementById('f').submit()</script>`));
    return;
  }
  if (url.pathname === '/creada') {
    if (url.searchParams.get('state') !== state || !url.searchParams.get('code')) {
      res.writeHead(400).end('Este enlace no es de esta ejecución.');
      return;
    }
    try {
      const conv = await fetch(`https://api.github.com/app-manifests/${url.searchParams.get('code')}/conversions`, {
        method: 'POST',
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ghostaff' },
      });
      if (!conv.ok) throw new Error(`GitHub ${conv.status}`);
      const app = await conv.json();
      storeKey(app.pem);
      const install = `https://github.com/apps/${app.slug}/installations/new`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(page(`<h2>Creada</h2><p>La clave ya está en Secret Manager. Ahora instálala en <b>ordago-app</b>,
eligiendo <i>Only select repositories</i> → <b>business</b>.</p><p><a href="${install}">Instalar Ghostaff Registro</a></p>`));
      console.log(`App «${app.name}» created (id ${app.id}); key stored as ${SECRET} in ${PROJECT}.`);
      open(install);
      server.close();
      await waitForInstall(app, app.pem);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`No ha salido: ${e.message}`);
      console.error(e.message);
      process.exitCode = 1;
      server.close();
    }
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Opening ${back} …`);
  open(back);
});
