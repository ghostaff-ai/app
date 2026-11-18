// Connecting and disconnecting an organisation's AI account. Only an owner may.
// A key is checked with the provider, written to the vault, and only then
// recorded in the database: provider, how, the last 4 characters, who and when.
// The key itself never reaches the database and is never sent back.

import type { AiProvider, ConnectAiInput } from '@ghostaff/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CONNECTION_COLUMNS } from '@ghostaff/shared/services';
import {
  type CheckResult,
  isEuRegion,
  keyHint,
  looksLikeKey,
  looksLikeProject,
} from './providers';
import { secretName, type Vault } from './vault';

export interface Membership {
  role: 'owner' | 'member';
  displayName: string;
}

export interface ConnectionRecord {
  org_id: string;
  kind: 'ai';
  provider: AiProvider;
  method: 'api_key' | 'cloud_project';
  hint: string;
  settings: Record<string, string>;
  status: 'ok';
  checked_at: string;
  connected_by: string;
  connected_by_name: string;
  updated_at: string;
}

/** The database as the engine sees it (service role). */
export interface Store {
  membership(orgId: string, userId: string): Promise<Membership | null>;
  /** Inserts or replaces the organisation's connection for that provider; returns the row. */
  upsert(row: ConnectionRecord): Promise<Record<string, unknown>>;
  remove(orgId: string, provider: AiProvider): Promise<void>;
}

export interface Checks {
  anthropic(key: string): Promise<CheckResult>;
  openai(key: string): Promise<CheckResult>;
  vertex(project: string): Promise<CheckResult>;
}

export interface Deps {
  store: Store;
  vault: Vault;
  checks: Checks;
  now?: () => Date;
}

/** A refusal the app turns into Spanish by its code. */
export class Refusal extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 422 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'vertex'];
export const isProvider = (p: unknown): p is AiProvider => PROVIDERS.includes(p as AiProvider);
const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s);

export async function requireOwner(store: Pick<Store, 'membership'>, orgId: unknown, userId: string): Promise<Membership> {
  if (!isUuid(orgId)) throw new Refusal(400, 'bad_request', 'orgId must be a uuid');
  const m = await store.membership(orgId, userId);
  // Not a member reads the same as not an owner: never reveal which organisations exist.
  if (!m || m.role !== 'owner') throw new Refusal(403, 'not_owner', 'only an owner manages connections');
  return m;
}

function refuseFailedCheck(check: CheckResult) {
  if (check.ok) return;
  if (check.reason === 'invalid') throw new Refusal(422, 'invalid_key', 'the provider rejected the key');
  if (check.reason === 'no_access') throw new Refusal(422, 'no_access', `the provider refused access: ${check.detail}`.slice(0, 300));
  throw new Refusal(502, 'provider_unavailable', 'could not reach the provider to check');
}

export async function connectAi(deps: Deps, userId: string, body: unknown): Promise<Record<string, unknown>> {
  const input = (body ?? {}) as Partial<ConnectAiInput> & { apiKey?: unknown; project?: unknown; region?: unknown };
  if (!isProvider(input.provider)) throw new Refusal(400, 'bad_request', 'unknown provider');
  const owner = await requireOwner(deps.store, input.orgId, userId);
  const orgId = input.orgId as string;
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const base = {
    org_id: orgId,
    kind: 'ai' as const,
    provider: input.provider,
    status: 'ok' as const,
    checked_at: now,
    connected_by: userId,
    connected_by_name: owner.displayName,
    updated_at: now,
  };

  if (input.provider === 'vertex') {
    const project = typeof input.project === 'string' ? input.project.trim() : '';
    const region = typeof input.region === 'string' ? input.region.trim() : '';
    if (!looksLikeProject(project)) throw new Refusal(400, 'bad_project', 'not a Google Cloud project ID');
    if (!isEuRegion(region)) throw new Refusal(400, 'bad_region', 'not an EU region we support');
    refuseFailedCheck(await deps.checks.vertex(project));
    return deps.store.upsert({ ...base, method: 'cloud_project', hint: project, settings: { project, region } });
  }

  const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (!looksLikeKey(input.provider, key)) throw new Refusal(400, 'bad_key_format', 'that does not look like a key for this provider');
  refuseFailedCheck(await deps.checks[input.provider](key));
  await deps.vault.put(secretName(orgId, input.provider), key, { org_id: orgId, provider: input.provider, kind: 'ai' });
  return deps.store.upsert({ ...base, method: 'api_key', hint: keyHint(key), settings: {} });
}

export async function disconnectAi(deps: Deps, userId: string, orgId: unknown, provider: unknown): Promise<void> {
  if (!isProvider(provider)) throw new Refusal(400, 'bad_request', 'unknown provider');
  await requireOwner(deps.store, orgId, userId);
  // The key goes first: if that fails, the row stays and the owner can retry.
  if (provider !== 'vertex') await deps.vault.remove(secretName(orgId as string, provider));
  await deps.store.remove(orgId as string, provider);
}

/** The Store over Supabase with the service role, which bypasses row-level security. */
export function supabaseStore(admin: SupabaseClient): Store {
  return {
    async membership(orgId, userId) {
      const { data, error } = await admin
        .from('memberships')
        .select('role, display_name')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle<{ role: Membership['role']; display_name: string }>();
      if (error) throw error;
      return data ? { role: data.role, displayName: data.display_name } : null;
    },
    async upsert(row) {
      const { data, error } = await admin
        .from('connections')
        .upsert(row, { onConflict: 'org_id,provider' })
        .select(CONNECTION_COLUMNS)
        .single();
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    async remove(orgId, provider) {
      const { error } = await admin.from('connections').delete().eq('org_id', orgId).eq('provider', provider);
      if (error) throw error;
    },
  };
}
