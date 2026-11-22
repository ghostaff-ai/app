// Starts the engine's HTTP service. Configuration comes from the environment
// (see .env.example); on Cloud Run the service-role key comes from Secret
// Manager and Google credentials from the service's own identity.

import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { GoogleAuth } from 'google-auth-library';
import { type AccountDeps, accessTokens, supabaseAccountStore, supabaseRefreshLeases, toolsFor } from './accounts';
import { supabaseActionStore } from './actions';
import { createApp } from './app';
import { costOf, supabaseChatStore, writerFactory } from './chatStore';
import { supabaseStore } from './connections';
import { spawnSetupToken } from './claudeCode';
import { CONNECTORS } from '@ghostaff/shared';
import { googleOAuth, googleTools } from './google';
import { googleBusinessTools } from './googleBusiness';
import { googleInsightsTools } from './googleInsights';
import { instagramOAuth, instagramTools } from './instagram';
import { tiktokOAuth, tiktokTools } from './tiktok';
import { mcpOAuth } from './mcp';
import { appClient } from './apps';
import { microsoftOAuth, microsoftTools } from './microsoft';
import { checkAnthropicKey, checkOpenAiKey, checkVertexProject } from './providers';
import { MemoryVault, SecretManagerVault, type Vault } from './vault';
import { freshRepoToken, repoTokens } from './githubApp';
import { googleCaller } from './googleCaller';
import { supabaseRecordStore } from './recordStore';
import { syncAll, syncOrg } from './recordSync';
import { expireRuns } from './jobs';
import type { ChatDeps } from './chat';
import { cloudRunLauncher, supabaseJobStore, supabaseRunnerStore } from './jobsStore';
import { type RunnerDeps, startScheduled } from './runner';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} (see apps/engine/.env.example).`);
  return v;
}

const supabaseUrl = required('SUPABASE_URL');
const admin = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

let vault: Vault;
if (process.env.VAULT === 'memory') {
  console.warn('VAULT=memory: keys are kept in memory and lost on restart. Local work only.');
  vault = new MemoryVault();
} else {
  vault = new SecretManagerVault(auth, required('GCP_PROJECT'), process.env.SECRETS_LOCATION ?? 'europe-west1');
}

// Google: our OAuth client «Ghostaff Conectores». The ID is public; the secret
// comes from Secret Manager on Cloud Run and from .env locally. Without them
// the engine runs, and connecting Google answers «not configured».
const googleClientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
// Instagram and TikTok: our own apps on each platform. Same rule: IDs public, secrets from Secret Manager or .env.
const instagramAppId = process.env.INSTAGRAM_APP_ID;
const instagramAppSecret = process.env.INSTAGRAM_APP_SECRET;
const tiktokClientKey = process.env.TIKTOK_CLIENT_KEY;
const tiktokClientSecret = process.env.TIKTOK_CLIENT_SECRET;
const publicUrl = process.env.ENGINE_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const accounts: AccountDeps = {
  accounts: supabaseAccountStore(admin),
  leases: supabaseRefreshLeases(admin),
  vault,
  providers: {
    // The makers' MCP servers need nothing configured: the engine registers itself with each, or uses our own
    // app from the vault (`app: true`). A server that takes only a client metadata document needs the engine
    // on https, so a local engine leaves it off.
    ...Object.fromEntries(
      CONNECTORS.flatMap((c) =>
        c.kind === 'mcp' && (!('httpsOnly' in c) || publicUrl.startsWith('https://')) ? [[c.id, mcpOAuth(c, { vault, publicUrl })]] : [],
      ),
    ),
    // Every Google card of the catalogue, through our one OAuth client.
    ...(googleClientId && googleClientSecret
      ? Object.fromEntries(
          CONNECTORS.flatMap((c) =>
            c.kind === 'google' ? [[c.id, googleOAuth({ clientId: googleClientId, clientSecret: googleClientSecret }, c)]] : [],
          ),
        )
      : {}),
    // Our Entra app, from the vault (scripts/connector-app.sh): until it is there, the card says «not available yet».
    microsoft: microsoftOAuth(appClient(vault, 'microsoft')),
    ...(instagramAppId && instagramAppSecret ? { instagram: instagramOAuth({ appId: instagramAppId, appSecret: instagramAppSecret }) } : {}),
    ...(tiktokClientKey && tiktokClientSecret ? { tiktok: tiktokOAuth({ clientKey: tiktokClientKey, clientSecret: tiktokClientSecret }) } : {}),
  },
  publicUrl,
  returnOrigins: (process.env.APP_RETURN_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  tools: [...googleTools(), ...googleBusinessTools(), ...googleInsightsTools(), ...microsoftTools(), ...instagramTools(), ...tiktokTools()],
};
for (const [id, vars] of [
  ['google', 'GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET'],
  ['instagram', 'INSTAGRAM_APP_ID and INSTAGRAM_APP_SECRET'],
  ['tiktok', 'TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET'],
] as const) {
  if (!accounts.providers[id]) console.warn(`${id} connector off: set ${vars}.`);
}
const tokenFor = accessTokens(accounts);

// The record connector: our GitHub App «Ghostaff Registro» (scripts/github-app-registro.mjs). Its ID is public;
// its key comes from Secret Manager on Cloud Run and from .env locally. Without them nothing syncs.
const githubAppId = process.env.GITHUB_APP_ID;
const githubAppKey = process.env.GITHUB_APP_KEY?.replace(/\\n/g, '\n');
if (!githubAppId || !githubAppKey) console.warn('record connector off: set GITHUB_APP_ID and GITHUB_APP_KEY.');
const recordSync = {
  store: supabaseRecordStore(admin),
  tokens: repoTokens(async () => (githubAppId && githubAppKey ? { appId: githubAppId, privateKey: githubAppKey } : null)),
};
const caller = googleCaller();
// Ghostaff's own runner (runner.ts, apps/runner): the Cloud Run job `agent-runner` beside the engine, running as
// RUNNER_IDENTITY (scripts/deploy-runner.sh). Without it, an agent on our runner says it cannot start.
const runnerIdentity = process.env.RUNNER_IDENTITY?.trim().toLowerCase();
if (!runnerIdentity) console.warn('our agent runner off: set RUNNER_IDENTITY.');
const runner: RunnerDeps | undefined = runnerIdentity
  ? {
      store: supabaseRunnerStore(admin),
      job: {
        project: process.env.GCP_PROJECT ?? 'ghostaff-prod',
        region: process.env.RUNNER_REGION ?? 'europe-west1',
        name: process.env.RUNNER_JOB ?? 'agent-runner',
        identity: runnerIdentity,
      },
      engineUrl: publicUrl,
      vault,
      async record(orgId) {
        const org = await recordSync.store.orgWithRecord(orgId);
        return org ? { repo: org.repo, installation: org.installation } : null;
      },
      freshToken: freshRepoToken(async () => (githubAppId && githubAppKey ? { appId: githubAppId, privateKey: githubAppKey } : null)),
      commitEmail: process.env.RECORD_COMMIT_EMAIL ?? 'ghostaff-registro[bot]@users.noreply.github.com',
    }
  : undefined;
const jobs = {
  runner,
  jobs: supabaseJobStore(admin),
  launch: cloudRunLauncher(auth),
  async syncOrg(orgId: string) {
    if (!githubAppId || !githubAppKey) return;
    const org = await recordSync.store.orgWithRecord(orgId);
    if (org) console.log((await syncOrg(recordSync, org)).summary);
  },
};
const chatDeps: ChatDeps = {
  chat: supabaseChatStore(admin),
  writerFor: writerFactory(vault, auth),
  costOf,
  toolsFor: (orgId) => toolsFor(accounts, tokenFor, orgId),
  jobs,
};
const cronCallers = (process.env.CRON_CALLERS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

const app = createApp({
  store: supabaseStore(admin),
  vault,
  checks: {
    anthropic: (key) => checkAnthropicKey(key),
    openai: (key) => checkOpenAiKey(key),
    vertex: (project) =>
      checkVertexProject(project, async (url, data) => {
        const client = await auth.getClient();
        const res = await client.request({ url, method: 'POST', data, validateStatus: () => true });
        return { status: res.status, data: res.data };
      }),
  },
  async userFromToken(token) {
    const { data, error } = await admin.auth.getUser(token);
    return error ? null : (data.user?.id ?? null);
  },
  serviceAccount: process.env.ENGINE_SERVICE_ACCOUNT ?? '',
  chat: chatDeps,
  reports: { callerFromToken: caller, audience: publicUrl },
  claudeSignIn: { spawn: spawnSetupToken },
  accounts,
  actions: { actions: supabaseActionStore(admin), toolsFor: (orgId) => toolsFor(accounts, tokenFor, orgId) },
  cron: {
    callerFromToken: caller,
    audience: publicUrl,
    callers: cronCallers,
    async tick() {
      const synced = githubAppId && githubAppKey ? await syncAll(recordSync) : [];
      for (const s of synced) console.log(s.summary);
      const expired = await expireRuns(chatDeps, jobs);
      const started = await startScheduled(chatDeps, jobs);
      return { synced: synced.map((s) => ({ org: s.org, ok: s.ok })), expired, started };
    },
  },
});

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, () => console.log(`engine listening on :${port}`));
app.injectWebSocket(server);
