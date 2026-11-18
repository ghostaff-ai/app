// Starts the engine's HTTP service. Configuration comes from the environment
// (see .env.example); on Cloud Run the service-role key comes from Secret
// Manager and Google credentials from the service's own identity.

import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { GoogleAuth } from 'google-auth-library';
import { type AccountDeps, accessTokens, supabaseAccountStore, toolsFor } from './accounts';
import { createApp } from './app';
import { supabaseChatStore, writerFactory } from './chatStore';
import { supabaseStore } from './connections';
import { CONNECTORS } from '@ghostaff/shared';
import { googleOAuth, googleTools } from './google';
import { mcpOAuth } from './mcp';
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
const publicUrl = process.env.ENGINE_PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 8787}`;
const accounts: AccountDeps = {
  accounts: supabaseAccountStore(admin),
  vault,
  providers: {
    // The makers' MCP servers need nothing configured: the engine registers itself with each.
    ...Object.fromEntries(CONNECTORS.flatMap((c) => (c.kind === 'mcp' ? [[c.id, mcpOAuth(c, { vault, publicUrl })]] : []))),
    ...(googleClientId && googleClientSecret ? { google: googleOAuth({ clientId: googleClientId, clientSecret: googleClientSecret }) } : {}),
  },
  publicUrl,
  returnOrigins: (process.env.APP_RETURN_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
  tools: googleTools(),
};
if (!accounts.providers.google) console.warn('Google connector off: set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET.');
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
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`engine listening on :${port}`));
