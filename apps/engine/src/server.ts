// Starts the engine's HTTP service. Configuration comes from the environment
// (see .env.example); on Cloud Run the service-role key comes from Secret
// Manager and Google credentials from the service's own identity.

import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { GoogleAuth } from 'google-auth-library';
import { type AccountDeps, accessTokens, supabaseAccountStore, supabaseRefreshLeases, toolsFor } from './accounts';
import { supabaseActionStore } from './actions';
import { createApp } from './app';
import { supabaseChatStore, writerFactory } from './chatStore';
import { supabaseStore } from './connections';
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
  chat: {
    chat: supabaseChatStore(admin),
    writerFor: writerFactory(vault, auth),
    toolsFor: (orgId) => toolsFor(accounts, tokenFor, orgId),
  },
  accounts,
  actions: { actions: supabaseActionStore(admin), toolsFor: (orgId) => toolsFor(accounts, tokenFor, orgId) },
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`engine listening on :${port}`));
