// Each organisation's own identity in Google Cloud (docs/architecture.md,
// «A customer's Google Cloud»; docs/plans/ongoing/customer-cloud-access.md).
//
// A customer lets Ghostaff into their Google Cloud by granting roles to a
// service account that belongs to their organisation alone. Were it one
// account shared by every customer, our code would be the only thing keeping
// them apart: an organisation that typed another's project would get in. With
// one each, Google itself refuses.
//
// The engine creates the account the first time an owner asks for it, in the
// environment's tenants project (where it administers service accounts and
// nothing else), lets itself mint tokens as that account only, and keeps it
// for the organisation's life, so the customer's grants survive reconnecting.
// No key is ever made: every use is a token of at most an hour.

import type { SupabaseClient } from '@supabase/supabase-js';

/** An authenticated Google API call, as the engine. */
export type GoogleCall = (method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) => Promise<{ status: number; data: unknown }>;

export interface CloudAccount {
  email: string;
  /** Google's numeric id: an account re-created under the same email is another account. */
  uniqueId: string;
}

/** The `cloud_accounts` table (service role only). */
export interface CloudAccountStore {
  get(orgId: string): Promise<CloudAccount | null>;
  put(orgId: string, account: CloudAccount): Promise<void>;
}

export interface CloudAccountDeps {
  store: CloudAccountStore;
  call: GoogleCall;
  /** Where the organisations' accounts live: `ghostaff-tenants-<env>`. */
  tenantsProject: string;
  /** The engine's own service account, the only one let to mint tokens as an organisation's. */
  engineAccount: string;
  /** Waits between retries; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** A token as the organisation's account, for at most an hour. */
export interface CloudToken {
  /** The organisation's service account the token is for. */
  account: string;
  token: string;
  expiresAt: string;
}

/**
 * The organisation's account cannot be used yet: it was just created and
 * Google has not spread the engine's right to it, or that right is gone.
 */
export class CloudAccountNotReady extends Error {}

const IAM = 'https://iam.googleapis.com/v1';
const CREDENTIALS = 'https://iamcredentials.googleapis.com/v1';
const TOKEN_CREATOR = 'roles/iam.serviceAccountTokenCreator';
const CLOUD_PLATFORM = 'https://www.googleapis.com/auth/cloud-platform';

/**
 * `org-` and the first 24 hex digits of the organisation's id: Google allows
 * 30 characters, and 96 bits never collide by chance. The display name holds
 * the whole id, and is checked before an account found by name is adopted.
 */
export const accountIdFor = (orgId: string) => `org-${orgId.replace(/-/g, '').toLowerCase().slice(0, 24)}`;
export const accountEmail = (orgId: string, tenantsProject: string) => `${accountIdFor(orgId)}@${tenantsProject}.iam.gserviceaccount.com`;
const displayName = (orgId: string) => `Ghostaff org ${orgId}`;

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The organisation's account, created the first time; returns its email. Safe to call again after any failure. */
export async function ensureCloudAccount(deps: CloudAccountDeps, orgId: string): Promise<string> {
  const known = await deps.store.get(orgId);
  if (known) return known.email;
  const email = accountEmail(orgId, deps.tenantsProject);
  const accounts = `${IAM}/projects/${deps.tenantsProject}/serviceAccounts`;
  let res = await deps.call('POST', accounts, {
    accountId: accountIdFor(orgId),
    serviceAccount: { displayName: displayName(orgId), description: 'Ghostaff: this organisation’s agents reach its Google Cloud as this account.' },
  });
  // Created by an earlier attempt that failed before it was stored.
  if (res.status === 409) res = await deps.call('GET', `${accounts}/${email}`);
  if (res.status !== 200) throw new Error(`the organisation's service account could not be created: ${res.status}`);
  const made = res.data as { email?: string; uniqueId?: string; displayName?: string };
  if (made.email !== email || made.displayName !== displayName(orgId) || !made.uniqueId) {
    throw new Error('a service account with that name belongs to someone else');
  }
  await allowEngine(deps, email);
  await deps.store.put(orgId, { email, uniqueId: made.uniqueId });
  return email;
}

/**
 * Lets the engine mint tokens as this one account (token creator on the
 * account, not the project). A new account can be missing for a few seconds,
 * and two writers can race on the policy: both are retried.
 */
async function allowEngine(deps: CloudAccountDeps, email: string): Promise<void> {
  const sleep = deps.sleep ?? defaultSleep;
  const resource = `${IAM}/projects/${deps.tenantsProject}/serviceAccounts/${email}`;
  const member = `serviceAccount:${deps.engineAccount}`;
  for (let attempt = 0; ; attempt++) {
    const got = await deps.call('POST', `${resource}:getIamPolicy`, {});
    if (got.status === 200) {
      const policy = (got.data ?? {}) as { bindings?: { role: string; members?: string[] }[]; etag?: string };
      const bindings = policy.bindings ?? [];
      const binding = bindings.find((b) => b.role === TOKEN_CREATOR);
      if (binding?.members?.includes(member)) return;
      const next = binding
        ? bindings.map((b) => (b === binding ? { ...b, members: [...(b.members ?? []), member] } : b))
        : [...bindings, { role: TOKEN_CREATOR, members: [member] }];
      const set = await deps.call('POST', `${resource}:setIamPolicy`, { policy: { ...policy, bindings: next } });
      if (set.status === 200) return;
      if (set.status !== 409 || attempt >= 4) throw new Error(`the engine could not be let into the account: ${set.status}`);
    } else if (got.status !== 404 || attempt >= 4) {
      throw new Error(`the account's policy could not be read: ${got.status}`);
    }
    await sleep(1000 * 2 ** attempt);
  }
}

/** A new token as the organisation's account, never cached: for a run that may hand it to an agent. */
export async function mintCloudToken(deps: CloudAccountDeps, orgId: string): Promise<CloudToken | null> {
  const account = await deps.store.get(orgId);
  if (!account) return null;
  const res = await deps.call('POST', `${CREDENTIALS}/projects/-/serviceAccounts/${account.email}:generateAccessToken`, {
    scope: [CLOUD_PLATFORM],
    lifetime: '3600s',
  });
  if (res.status === 403 || res.status === 404) throw new CloudAccountNotReady(`no token as ${account.email}: ${res.status}`);
  const data = res.data as { accessToken?: string; expireTime?: string };
  if (res.status !== 200 || !data.accessToken || !data.expireTime) throw new Error(`no token as the organisation's account: ${res.status}`);
  return { account: account.email, token: data.accessToken, expiresAt: data.expireTime };
}

/**
 * Tokens for the engine's own calls (Claude on Vertex AI in the chat), kept
 * until five minutes before they end. Never handed to a run.
 */
export function cloudTokens(deps: CloudAccountDeps): (orgId: string) => Promise<string | null> {
  const cache = new Map<string, CloudToken>();
  const now = deps.now ?? Date.now;
  return async (orgId) => {
    const cached = cache.get(orgId);
    if (cached && Date.parse(cached.expiresAt) - now() > 5 * 60_000) return cached.token;
    const fresh = await mintCloudToken(deps, orgId);
    if (!fresh) return null;
    cache.set(orgId, fresh);
    return fresh.token;
  };
}

/** The store over Supabase with the service role: the table is closed to everyone else. */
export function supabaseCloudAccountStore(admin: SupabaseClient): CloudAccountStore {
  return {
    async get(orgId) {
      const { data, error } = await admin
        .from('cloud_accounts')
        .select('email, unique_id')
        .eq('org_id', orgId)
        .maybeSingle<{ email: string; unique_id: string }>();
      if (error) throw error;
      return data ? { email: data.email, uniqueId: data.unique_id } : null;
    },
    async put(orgId, account) {
      // Two first requests at once both create (the second finds it by name) and both store the same row.
      const { error } = await admin
        .from('cloud_accounts')
        .upsert({ org_id: orgId, email: account.email, unique_id: account.uniqueId }, { onConflict: 'org_id' });
      if (error) throw error;
    },
  };
}
