// Our own app with a maker that takes no other kind of client (kind B-app in
// docs/plans/ongoing/connectors.md): registered once by hand in the maker's
// developer portal, its client ID and secret put in the vault with
// scripts/connector-app.sh. Never in an env var, a file or a chat, and one
// mechanism for every maker, so adding one needs no deploy.

import { NotConfigured } from './accounts';
import type { Vault } from './vault';

/** The vault's name for our app with one maker: `{"client_id","client_secret"}`. */
export const appSecretName = (provider: string) => `engine-app-${provider}`;

export interface AppClient {
  clientId: string;
  clientSecret?: string;
}

/** How long the engine trusts what it read, so a rotated secret needs no restart. */
const TTL_MS = 10 * 60_000;

/**
 * Reads our app with `provider` from the vault, kept for ten minutes. Missing
 * or malformed: NotConfigured, which the person sees as «not available yet».
 */
export function appClient(vault: Vault, provider: string, now: () => number = Date.now): () => Promise<AppClient> {
  let kept: { client: AppClient; until: number } | null = null;
  return async () => {
    if (kept && kept.until > now()) return kept.client;
    const raw = await vault.get(appSecretName(provider));
    let parsed: { client_id?: unknown; client_secret?: unknown } = {};
    try {
      parsed = raw ? (JSON.parse(raw) as typeof parsed) : {};
    } catch {
      console.error(`${provider}: ${appSecretName(provider)} is not JSON`);
    }
    if (typeof parsed.client_id !== 'string' || !parsed.client_id) throw new NotConfigured(provider);
    const client: AppClient = {
      clientId: parsed.client_id,
      ...(typeof parsed.client_secret === 'string' && parsed.client_secret ? { clientSecret: parsed.client_secret } : {}),
    };
    kept = { client, until: now() + TTL_MS };
    return client;
  };
}
