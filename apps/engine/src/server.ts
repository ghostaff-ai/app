// Starts the engine's HTTP service. Configuration comes from the environment
// (see .env.example); on Cloud Run the service-role key comes from Secret
// Manager and Google credentials from the service's own identity.

import { serve } from '@hono/node-server';
import { createClient } from '@supabase/supabase-js';
import { GoogleAuth } from 'google-auth-library';
import { createApp } from './app';
import { supabaseChatStore, writerFactory } from './chatStore';
import { supabaseStore } from './connections';
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
  chat: { chat: supabaseChatStore(admin), writerFor: writerFactory(vault, auth) },
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`engine listening on :${port}`));
