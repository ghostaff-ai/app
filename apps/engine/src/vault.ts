// The vault: where an organisation's keys live, apart from everything else
// (invariant 3). In production it is Secret Manager in the engine's own Google
// Cloud project, every secret replicated only in the EU (invariant 2). Locally,
// without Google Cloud, an in-memory vault stands in and forgets on restart.

import type { GoogleAuth } from 'google-auth-library';

export interface Vault {
  /** Creates the secret if needed and makes `value` its only live version. */
  put(name: string, value: string, labels: Record<string, string>): Promise<void>;
  /** The live value, or null if there is none. */
  get(name: string): Promise<string | null>;
  /** Deletes the secret and every version of it. Missing is fine. */
  remove(name: string): Promise<void>;
}

/** Secret IDs allow letters, digits, `-` and `_`. One per AI connection (an organisation may have several). */
export function aiSecretName(orgId: string, connectionId: string): string {
  return `org-${orgId}-ai-${connectionId}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

/**
 * Before 2026-11-22 an organisation had one AI connection per provider, and
 * its secret was named after the provider. Connections from then still read it.
 */
export function legacyAiSecretName(orgId: string, provider: string): string {
  return `org-${orgId}-ai-${provider}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

/** An AI connection's key or token: under its own id, else under the name it had before several were allowed. */
export async function readAiSecret(vault: Pick<Vault, 'get'>, orgId: string, connection: { id: string; provider: string }): Promise<string | null> {
  return (await vault.get(aiSecretName(orgId, connection.id))) ?? (await vault.get(legacyAiSecretName(orgId, connection.provider)));
}

/** An outside account's token (Google…), one per organisation and provider. */
export function accountSecretName(orgId: string, provider: string): string {
  return `org-${orgId}-account-${provider}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

export class MemoryVault implements Vault {
  readonly secrets = new Map<string, { value: string; labels: Record<string, string> }>();
  async put(name: string, value: string, labels: Record<string, string>) {
    this.secrets.set(name, { value, labels });
  }
  async get(name: string) {
    return this.secrets.get(name)?.value ?? null;
  }
  async remove(name: string) {
    this.secrets.delete(name);
  }
}

const API = 'https://secretmanager.googleapis.com/v1';

const statusOf = (e: unknown) =>
  (e as { status?: number; response?: { status?: number } }).status ?? (e as { response?: { status?: number } }).response?.status;

export class SecretManagerVault implements Vault {
  constructor(
    private readonly auth: GoogleAuth,
    private readonly project: string,
    /** Where the secrets are stored: one EU region, never automatic replication. */
    private readonly location: string,
  ) {}

  private async request<T>(method: string, path: string, data?: unknown): Promise<T> {
    const client = await this.auth.getClient();
    const res = await client.request<T>({ url: `${API}/${path}`, method: method as 'GET', data });
    return res.data;
  }

  private secretPath(name: string) {
    return `projects/${this.project}/secrets/${name}`;
  }

  async put(name: string, value: string, labels: Record<string, string>) {
    try {
      await this.request('POST', `projects/${this.project}/secrets?secretId=${name}`, {
        replication: { userManaged: { replicas: [{ location: this.location }] } },
        labels,
      });
    } catch (e) {
      if (statusOf(e) !== 409) throw e; // 409: it exists already, a reconnect.
    }
    const added = await this.request<{ name: string }>('POST', `${this.secretPath(name)}:addVersion`, {
      payload: { data: Buffer.from(value, 'utf8').toString('base64') },
    });
    // Only the new key stays live: destroy the versions before it.
    const { versions = [] } = await this.request<{ versions?: { name: string }[] }>(
      'GET',
      `${this.secretPath(name)}/versions?filter=${encodeURIComponent('state:ENABLED')}`,
    );
    for (const v of versions) {
      if (v.name !== added.name) await this.request('POST', `${v.name}:destroy`, {});
    }
  }

  async get(name: string) {
    try {
      const res = await this.request<{ payload: { data: string } }>('GET', `${this.secretPath(name)}/versions/latest:access`);
      return Buffer.from(res.payload.data, 'base64').toString('utf8');
    } catch (e) {
      if (statusOf(e) === 404) return null;
      throw e;
    }
  }

  async remove(name: string) {
    try {
      await this.request('DELETE', this.secretPath(name));
    } catch (e) {
      if (statusOf(e) !== 404) throw e;
    }
  }
}
