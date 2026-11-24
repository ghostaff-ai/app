// Starts the engine's HTTP service. Configuration comes from the environment
// (see .env.example); on Cloud Run the service-role key comes from Secret
// Manager and Google credentials from the service's own identity.

import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { asPersonFactory } from './settings';
import { GoogleAuth } from 'google-auth-library';
import { supabaseAskStore } from './accountAsks';
import { type AccountDeps, accessTokens, supabaseAccountStore, supabaseRefreshLeases, toolsFor } from './accounts';
import { supabaseActionStore } from './actions';
import { createApp } from './app';
import { costOf, supabaseChatStore, writerFactory } from './chatStore';
import { supabaseStore } from './connections';
import { spawnSetupToken } from './claudeCode';
import { CONNECTORS } from '@ghostaff/shared';
import { googleOAuth, googleTools } from './google';
import { guidedToolsFor, supabaseGuidedStore } from './guidedAccounts';
import { googleBusinessTools } from './googleBusiness';
import { googleInsightsTools } from './googleInsights';
import { instagramOAuth, instagramTools } from './instagram';
import { tiktokOAuth, tiktokTools } from './tiktok';
import { mcpOAuth } from './mcp';
import { appClient } from './apps';
import { microsoftOAuth, microsoftTools } from './microsoft';
import { type CheckResult, checkAnthropicKey, checkOpenAiKey, checkVertexProject } from './providers';
import { CloudAccountNotReady, type CloudAccountDeps, cloudTokens, ensureCloudAccount, type GoogleCall, supabaseCloudAccountStore } from './cloudAccounts';
import { MemoryVault, SecretManagerVault, type Vault } from './vault';
import { freshRepoToken, repoTokens } from './githubApp';
import { googleCaller } from './googleCaller';
import { type ForgejoConfig, forgejoAdmin } from './forgejo';
import { provisionRecords } from './recordProvision';
import { recordAgentsOf, supabaseRecordStore } from './recordStore';
import { canReach, type RecordSyncDeps, syncAll, syncOrg } from './recordSync';
import { expireRuns } from './jobs';
import type { ChatDeps } from './chat';
import { cloudRunLauncher, supabaseJobStore, supabaseRunnerStore } from './jobsStore';
import { startRoutines, supabaseRoutineStore } from './routines';
import { RECORD_STORE_TOKEN_HOURS, type RunnerDeps, startScheduled } from './runner';
import { DEFAULT_TRANSCRIBE_MODEL, type GoogleRequest, vertexTranscriber } from './transcribe';
import { supabaseVoiceNoteStore } from './voiceNotes';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name} (see apps/engine/.env.example).`);
  return v;
}

const supabaseUrl = required('SUPABASE_URL');
const admin = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
// The main agent's settings run as a person, never as the service role (settings.ts).
const asPerson = asPersonFactory(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'));

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const googleRequest: GoogleRequest = async (url, data, opts) => {
  const client = await auth.getClient();
  const res = await client.request({ url, method: 'POST', data, validateStatus: () => true, timeout: opts?.timeoutMs });
  return { status: res.status, data: res.data };
};

// Each organisation's own Google Cloud account, in the environment's tenants project (cloudAccounts.ts).
const googleCall: GoogleCall = async (method, url, data) => {
  const client = await auth.getClient();
  const res = await client.request({ url, method, data, validateStatus: () => true });
  return { status: res.status, data: res.data };
};
const tenantsProject = process.env.TENANTS_PROJECT;
const engineAccount = process.env.ENGINE_SERVICE_ACCOUNT;
if (!tenantsProject || !engineAccount) console.warn("Google Cloud accounts off (and Claude on Vertex with them): set TENANTS_PROJECT and ENGINE_SERVICE_ACCOUNT.");
const cloud: CloudAccountDeps | null =
  tenantsProject && engineAccount ? { store: supabaseCloudAccountStore(admin), call: googleCall, tenantsProject, engineAccount } : null;
const cloudToken = cloud ? cloudTokens(cloud) : async () => null;
/** Whether the organisation's account may call Claude on Vertex AI in the project: asked as that account, never as the engine. */
async function checkVertexAs(orgId: string, project: string): Promise<CheckResult> {
  if (!cloud) return { ok: false, reason: 'unavailable', detail: 'Google Cloud accounts are off' };
  await ensureCloudAccount(cloud, orgId);
  let token: string | null;
  try {
    token = await cloudToken(orgId);
  } catch (e) {
    // Just created: Google takes a moment to let the engine act as it. The app says to wait and retry.
    if (e instanceof CloudAccountNotReady) return { ok: false, reason: 'no_access', detail: 'the organisation’s account is not ready yet' };
    throw e;
  }
  if (!token) return { ok: false, reason: 'unavailable', detail: 'no account' };
  return checkVertexProject(project, async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  });
}

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
// Our own record store (docs/plans/ongoing/record-store.md): Forgejo on the environment's VPC, set up by
// scripts/setup-record-store.sh. Without it, organisations keep only a record they bring on GitHub.
const forgejoUrl = process.env.FORGEJO_URL?.trim();
const forgejoToken = process.env.FORGEJO_ADMIN_TOKEN?.trim();
const forgejo: ForgejoConfig | null =
  forgejoUrl && forgejoToken ? { url: forgejoUrl, adminToken: forgejoToken, adminUser: process.env.FORGEJO_ADMIN_USER ?? 'ghostaff' } : null;
if (!forgejo) console.warn('record store off: set FORGEJO_URL and FORGEJO_ADMIN_TOKEN.');
const forgejoAdminClient = forgejo ? forgejoAdmin(forgejo) : null;
const recordSync: RecordSyncDeps = {
  store: supabaseRecordStore(admin),
  tokens: githubAppId && githubAppKey ? repoTokens(async () => ({ appId: githubAppId, privateKey: githubAppKey })) : null,
  forgejo,
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
        return org && canReach(recordSync, org) ? org : null;
      },
      recordStore:
        forgejo && forgejoAdminClient ? { admin: forgejoAdminClient, adminUser: forgejo.adminUser, agentsOf: (orgId) => recordAgentsOf(admin, orgId) } : null,
      freshToken: freshRepoToken(async () => (githubAppId && githubAppKey ? { appId: githubAppId, privateKey: githubAppKey } : null)),
      commitEmail: process.env.RECORD_COMMIT_EMAIL ?? 'ghostaff-registro[bot]@users.noreply.github.com',
    }
  : undefined;
const jobs = {
  runner,
  jobs: supabaseJobStore(admin),
  launch: cloudRunLauncher(auth),
  async syncOrg(orgId: string) {
    const org = await recordSync.store.orgWithRecord(orgId);
    if (org && canReach(recordSync, org)) console.log((await syncOrg(recordSync, org)).summary);
  },
};
// An agent's own accesses to an app with an API, given through a guide (guidedAccounts.ts).
const guided = supabaseGuidedStore(admin);
const guidedTools = (orgId: string, agentId: string) => guidedToolsFor(guided, vault, orgId, agentId);
const chatDeps: ChatDeps = {
  chat: supabaseChatStore(admin),
  writerFor: writerFactory(vault, cloudToken),
  costOf,
  toolsFor: (orgId) => toolsFor(accounts, tokenFor, orgId),
  asPerson,
  jobs,
  asks: supabaseAskStore(admin),
  guidedToolsFor: guidedTools,
};
// Voice notes' transcripts: Gemini on Vertex AI in the EU, billed to Ghostaff's own project (transcribe.ts).
const gcpProject = process.env.GCP_PROJECT;
if (!gcpProject) console.warn('voice notes off: set GCP_PROJECT.');
const transcriber = gcpProject
  ? vertexTranscriber({ project: gcpProject, model: process.env.TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL, request: googleRequest })
  : undefined;
const routineStore = supabaseRoutineStore(admin);
const cronCallers = (process.env.CRON_CALLERS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

const app = createApp({
  store: supabaseStore(admin),
  vault,
  checks: {
    anthropic: (key) => checkAnthropicKey(key),
    openai: (key) => checkOpenAiKey(key),
    vertex: checkVertexAs,
  },
  async userFromToken(token) {
    const { data, error } = await admin.auth.getUser(token);
    return error ? null : (data.user?.id ?? null);
  },
  ...(cloud ? { cloudAccount: (orgId: string) => ensureCloudAccount(cloud, orgId) } : {}),
  chat: chatDeps,
  reports: { callerFromToken: caller, audience: publicUrl },
  claudeSignIn: { spawn: spawnSetupToken },
  voice: supabaseVoiceNoteStore(admin),
  transcriber,
  accounts,
  actions: { actions: supabaseActionStore(admin), toolsFor: (orgId) => toolsFor(accounts, tokenFor, orgId), guidedToolsFor: guidedTools, asPerson },
  cron: {
    callerFromToken: caller,
    audience: publicUrl,
    callers: cronCallers,
    async tick() {
      // The record store being down never stops the rest of the tick.
      const made =
        forgejo && forgejoAdminClient
          ? await provisionRecords({ store: recordSync.store, admin: forgejoAdminClient, adminUser: forgejo.adminUser, agentsOf: (orgId) => recordAgentsOf(admin, orgId) }).catch(
              (e) => [`records not made: ${e instanceof Error ? e.message : e}`],
            )
          : [];
      for (const m of made) console.log(m);
      const synced = await syncAll(recordSync);
      for (const s of synced) console.log(s.summary);
      if (forgejoAdminClient) {
        const before = new Date(Date.now() - RECORD_STORE_TOKEN_HOURS * 3_600_000);
        try {
          for (const user of await forgejoAdminClient.agentUsers()) await forgejoAdminClient.sweepRunTokens(user, before);
        } catch (e) {
          console.error('run tokens not swept', e instanceof Error ? e.message : e);
        }
      }
      const expired = await expireRuns(chatDeps, jobs);
      const started = await startScheduled(chatDeps, jobs);
      // Routines (agent-routines.md): a failure here never hides what the rest of the tick did.
      const routines = await startRoutines(chatDeps, jobs, routineStore).catch((e) => {
        console.error('routines not started', e instanceof Error ? e.message : e);
        return 0;
      });
      return { records: made.length, synced: synced.map((s) => ({ org: s.org, ok: s.ok })), expired, started, routines };
    },
  },
});

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, () => console.log(`engine listening on :${port}`));
app.injectWebSocket(server);
