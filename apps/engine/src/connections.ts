// Connecting and disconnecting an organisation's AI accounts. Only an owner may.
// A key is checked with the provider, written to the vault under the new
// connection's id, and only then recorded in the database: provider, how, the
// last 4 characters, who and when. The key itself never reaches the database
// and is never sent back. An organisation may have any number of AI accounts
// (two Claude subscriptions, a key…); each new one goes last in the order the
// engine tries them, which an owner changes from the app (set_ai_order).

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
import { randomUUID } from 'node:crypto';
import { aiSecretName, legacyAiSecretName, type Vault } from './vault';

export interface Membership {
  role: 'owner' | 'member';
  displayName: string;
}

export interface ConnectionRecord {
  id: string;
  org_id: string;
  kind: 'ai';
  provider: AiProvider;
  method: 'api_key' | 'cloud_project' | 'subscription';
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
  /** Adds an AI connection, last in its organisation's order; returns the row. */
  insert(row: ConnectionRecord): Promise<Record<string, unknown>>;
  /** The organisation's AI connections, first to last. */
  aiConnections(orgId: string): Promise<{ id: string; provider: AiProvider }[]>;
  remove(orgId: string, connectionId: string): Promise<void>;
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
    readonly status: 400 | 403 | 404 | 409 | 422 | 502 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'vertex', 'claude'];
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
  // A Claude subscription is connected by signing in through Claude Code (claudeSession.ts), never pasted.
  if ((input.provider as AiProvider) === 'claude') throw new Refusal(400, 'bad_request', 'connect a Claude subscription by signing in');
  const owner = await requireOwner(deps.store, input.orgId, userId);
  const orgId = input.orgId as string;
  const now = (deps.now ?? (() => new Date()))().toISOString();
  const id = randomUUID();
  const base = {
    id,
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
    return deps.store.insert({ ...base, method: 'cloud_project', hint: project, settings: { project, region } });
  }

  const key = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (!looksLikeKey(input.provider, key)) throw new Refusal(400, 'bad_key_format', 'that does not look like a key for this provider');
  refuseFailedCheck(await deps.checks[input.provider](key));
  await deps.vault.put(aiSecretName(orgId, id), key, { org_id: orgId, provider: input.provider, kind: 'ai' });
  return deps.store.insert({ ...base, method: 'api_key', hint: keyHint(key), settings: {} });
}

/**
 * Removes one AI account, named by its id. An app from before several were
 * allowed names a provider instead: that works while the organisation has
 * only one account of that provider.
 */
export async function disconnectAi(deps: Deps, userId: string, orgId: unknown, which: unknown): Promise<void> {
  if (!isUuid(which) && !isProvider(which)) throw new Refusal(400, 'bad_request', 'name the connection');
  await requireOwner(deps.store, orgId, userId);
  const org = orgId as string;
  const all = await deps.store.aiConnections(org);
  const matching = isUuid(which) ? all.filter((c) => c.id === which) : all.filter((c) => c.provider === which);
  if (matching.length > 1) throw new Refusal(409, 'ambiguous', 'several accounts of that provider: name one by its id');
  const [target] = matching;
  if (!target) throw new Refusal(404, 'not_found', 'no such AI account');
  // The key (or a subscription's token) goes first: if that fails, the row stays and the owner can retry.
  if (target.provider !== 'vertex') {
    await deps.vault.remove(aiSecretName(org, target.id));
    // The secret named after the provider belonged to the last account of it from before 2026-11-22.
    if (!all.some((c) => c.id !== target.id && c.provider === target.provider)) await deps.vault.remove(legacyAiSecretName(org, target.provider));
  }
  await deps.store.remove(org, target.id);
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
    async insert(row) {
      const { data, error } = await admin.from('connections').insert(row).select(CONNECTION_COLUMNS).single();
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    async aiConnections(orgId) {
      const { data, error } = await admin
        .from('connections')
        .select('id, provider')
        .eq('org_id', orgId)
        .eq('kind', 'ai')
        .order('position')
        .order('created_at')
        .returns<{ id: string; provider: AiProvider }[]>();
      if (error) throw error;
      return data ?? [];
    },
    async remove(orgId, connectionId) {
      const { error } = await admin.from('connections').delete().eq('org_id', orgId).eq('id', connectionId).eq('kind', 'ai');
      if (error) throw error;
    },
  };
}
