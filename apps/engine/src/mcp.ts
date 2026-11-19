// The makers' connectors (docs/plans/ongoing/connectors.md, kind B-open): an
// official remote MCP server, its own sign-in and its own tools. One piece of
// code serves every server in the catalogue that lets any client register
// itself; adding one is a line in packages/shared/src/connectors.ts.
//
// How the engine signs in, as the MCP authorisation spec asks:
// - It discovers the server's authorization server from its protected-resource
//   metadata (RFC 9728).
// - It identifies itself with a client metadata document at a Ghostaff URL when
//   the server takes those and the engine is on https; otherwise it registers a
//   client once per server (dynamic registration) and keeps it in the vault.
//   A maker that takes neither gets our own app, registered by hand in its
//   portal (`app: true`, see apps.ts).
// - PKCE, and the `resource` parameter on every authorisation and token request,
//   so a token is good for that server only.
//
// Tokens follow the same path as Google's (accounts.ts): vault only, refreshed
// by the engine, never seen by the model.

import type { McpConnector } from '@ghostaff/shared';
import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization,
} from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { InvalidClientError, InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationServerMetadata,
  OAuthClientInformationMixed,
  OAuthProtectedResourceMetadata,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { AccountGone, callbackUrl, type GrantClient, type OAuthProvider, TOOL_CALL_TIMEOUT_MS, timedFetch } from './accounts';
import { appClient } from './apps';
import { clip, type Tool, type ToolInputSchema, ToolError } from './tools';
import type { Vault } from './vault';

/** A conversation with an MCP server, as one access token. */
export interface McpSession {
  listTools(cursor?: string): Promise<{ tools: McpToolInfo[]; nextCursor?: string }>;
  callTool(name: string, args: Record<string, unknown>): Promise<{ content?: unknown[]; isError?: boolean }>;
  close(): Promise<void>;
}

export interface McpToolInfo {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; title?: string };
}

export interface McpDeps {
  vault: Vault;
  /** The engine's own public URL: the redirect and, on https, the client metadata document. */
  publicUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** Opens a session with the server; tests replace it. */
  connect?: (url: string, accessToken: string) => Promise<McpSession>;
}

/** Where the engine publishes its client metadata document (CIMD). */
export const clientMetadataUrl = (publicUrl: string) => `${publicUrl.replace(/\/$/, '')}/oauth/client-metadata.json`;

/** The client metadata document: who we are, to servers that take a URL as the client id. */
export function clientMetadataDocument(publicUrl: string, connectors: readonly { id: string; kind: string }[]) {
  return {
    client_id: clientMetadataUrl(publicUrl),
    client_name: 'Ghostaff',
    client_uri: 'https://ghostaff.ai',
    redirect_uris: connectors.filter((c) => c.kind === 'mcp').map((c) => callbackUrl(publicUrl, c.id as never)),
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

/** The vault's name for the client the engine registered with one server. */
export const mcpClientSecretName = (provider: string) => `engine-mcp-client-${provider}`;


async function connectOverHttp(url: string, accessToken: string, f?: typeof fetch): Promise<McpSession> {
  const client = new Client({ name: 'ghostaff', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    fetch: timedFetch(f ?? fetch, TOOL_CALL_TIMEOUT_MS),
  });
  await client.connect(transport);
  return {
    listTools: async (cursor) => (await client.listTools(cursor ? { cursor } : undefined)) as { tools: McpToolInfo[]; nextCursor?: string },
    callTool: async (name, args) => (await client.callTool({ name, arguments: args })) as { content?: unknown[]; isError?: boolean },
    close: () => client.close(),
  };
}

/** The scopes to ask for: the catalogue's, or the server's own list minus what we never want, plus offline access when offered. */
export function scopesFor(
  c: McpConnector,
  resource: OAuthProtectedResourceMetadata | undefined,
  server: AuthorizationServerMetadata,
): string | undefined {
  const drop = new Set(c.dropScopes ?? []);
  const asked = [...(c.scopes ?? (resource?.scopes_supported ?? []).filter((s) => !drop.has(s)))];
  // A refresh token is often given only for offline access: without one, the connection dies within the hour.
  if (server.scopes_supported?.includes('offline_access') && !asked.includes('offline_access')) asked.push('offline_access');
  return asked.length ? asked.join(' ') : undefined;
}

/** What a tool's result says, as text the model reads. */
function resultText(content: unknown[] | undefined): string {
  const parts = (content ?? []).map((p) => {
    const part = p as { type?: string; text?: string; resource?: { uri?: string; text?: string }; uri?: string; name?: string };
    if (part.type === 'text' && typeof part.text === 'string') return part.text;
    if (part.type === 'resource' && part.resource) return part.resource.text ?? `(recurso ${part.resource.uri ?? ''})`;
    if (part.type === 'resource_link') return `(enlace: ${part.uri ?? part.name ?? ''})`;
    if (part.type === 'image') return '(una imagen)';
    return '';
  });
  return parts.filter(Boolean).join('\n') || '(sin contenido)';
}

/** The model's name for a server's tool: unique per connector, within the API's limits. */
export const toolName = (provider: string, name: string) => `${provider}_${name}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

export function mcpOAuth(c: McpConnector, deps: McpDeps): OAuthProvider {
  const f = deps.fetch;
  const now = deps.now ?? Date.now;
  const connect = deps.connect ?? ((url: string, token: string) => connectOverHttp(url, token, f));
  const redirectUri = callbackUrl(deps.publicUrl, c.id as never);

  let discovered: Promise<{ as: string; metadata: AuthorizationServerMetadata; resource: string; scope?: string }> | null = null;
  const info = () => {
    discovered ??= (async () => {
      const found = await discoverOAuthServerInfo(c.url, f ? { fetchFn: f } : undefined);
      const metadata = found.authorizationServerMetadata;
      if (!metadata) throw new Error(`${c.id}: no authorization server metadata`);
      return {
        as: found.authorizationServerUrl,
        metadata,
        resource: found.resourceMetadata?.resource ?? c.url,
        scope: scopesFor(c, found.resourceMetadata, metadata),
      };
    })().catch((e) => {
      discovered = null; // try again next time
      throw e;
    });
    return discovered;
  };

  /** Our own app with this maker, from the vault. Missing: the connector is not set up here yet. */
  const ourApp = appClient(deps.vault, c.id, now);
  const appInformation = async (): Promise<OAuthClientInformationMixed> => {
    const a = await ourApp();
    return { client_id: a.clientId, ...(a.clientSecret ? { client_secret: a.clientSecret } : {}) };
  };

  /** Our client with this server: our own app, a metadata-document URL, or one registered once and kept in the vault. */
  let registering: Promise<OAuthClientInformationMixed> | null = null;
  const clientFor = async (): Promise<OAuthClientInformationMixed> => {
    if (c.app) return appInformation();
    const { metadata } = await info();
    if (deps.publicUrl.startsWith('https://') && metadata.client_id_metadata_document_supported) {
      return { client_id: clientMetadataUrl(deps.publicUrl) };
    }
    if (!metadata.registration_endpoint) throw new Error(`${c.id}: the server takes no client registration and the engine is not on https`);
    const name = mcpClientSecretName(c.id);
    const kept = await deps.vault.get(name);
    if (kept) {
      const k = JSON.parse(kept) as OAuthClientInformationMixed & { redirect_uri?: string };
      if (k.redirect_uri === redirectUri) return k;
    }
    // One registration at a time in this instance. A second one elsewhere orphans no grant: each grant keeps the client it was issued to.
    registering ??= register(name).finally(() => {
      registering = null;
    });
    return registering;
  };
  const register = async (name: string): Promise<OAuthClientInformationMixed> => {
    const { as, metadata, scope } = await info();
    if (!metadata.registration_endpoint) throw new Error(`${c.id}: the server takes no client registration`);
    const methods = metadata.token_endpoint_auth_methods_supported ?? ['client_secret_basic'];
    const method = methods.includes('none') ? 'none' : methods.includes('client_secret_post') ? 'client_secret_post' : 'client_secret_basic';
    const registered = await registerClient(as, {
      metadata,
      clientMetadata: {
        client_name: 'Ghostaff',
        client_uri: 'https://ghostaff.ai',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: method,
        ...(scope ? { scope } : {}),
      },
      ...(f ? { fetchFn: f } : {}),
    });
    await deps.vault.put(name, JSON.stringify({ ...registered, redirect_uri: redirectUri }), { kind: 'mcp-client', provider: c.id });
    return registered;
  };

  // A server's tool list barely changes: listed once per access token (about an hour).
  const listed = new Map<string, { tools: Tool[]; until: number }>();
  const asClient = (ci: OAuthClientInformationMixed): GrantClient => ({
    clientId: ci.client_id,
    ...('client_secret' in ci && ci.client_secret ? { clientSecret: ci.client_secret } : {}),
  });

  const toTool = (t: McpToolInfo): Tool => ({
    name: toolName(c.id, t.name),
    description: `${c.name}: ${t.description ?? t.title ?? t.annotations?.title ?? t.name}`.slice(0, 1024),
    input_schema: { ...t.inputSchema, type: 'object', properties: t.inputSchema.properties ?? {} } as ToolInputSchema,
    provider: c.id as never,
    scope: '',
    writes: t.annotations?.readOnlyHint !== true,
    step: `Usando ${c.name}`,
    action: `${c.name}: ${t.annotations?.title ?? t.title ?? t.name}`.slice(0, 200),
    async run(ctx, input) {
      let session: McpSession;
      try {
        session = await connect(c.url, ctx.accessToken);
      } catch {
        throw new ToolError(`${c.name} no responde ahora, o ya no acepta nuestro permiso. Si sigue, hay que volver a conectarlo en Conexiones.`);
      }
      try {
        const result = await session.callTool(t.name, input);
        const text = clip(resultText(result.content));
        if (result.isError) throw new ToolError(`${c.name} devuelve un error: ${text}`);
        return text;
      } finally {
        await session.close().catch(() => {});
      }
    },
  });

  return {
    id: c.id as never,
    method: 'mcp',
    usefulScopes: null,
    async begin({ state }) {
      // Our app first: a connector not set up here should say so before any call to the maker.
      const clientInformation = await clientFor();
      const { as, metadata, resource, scope } = await info();
      const { authorizationUrl, codeVerifier } = await startAuthorization(as, {
        metadata,
        clientInformation,
        redirectUrl: redirectUri,
        state,
        resource,
        ...(scope ? { scope } : {}),
      });
      return { url: authorizationUrl.toString(), codeVerifier };
    },
    async exchange({ code, codeVerifier }) {
      const { as, metadata, resource } = await info();
      const clientInformation = await clientFor();
      const tokens = await exchangeAuthorization(as, {
        metadata,
        clientInformation,
        authorizationCode: code,
        codeVerifier,
        redirectUri,
        resource,
        ...(f ? { fetchFn: f } : {}),
      });
      return {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        expiresIn: tokens.expires_in ?? 3600,
        scopes: tokens.scope ? tokens.scope.split(' ').filter(Boolean) : null,
        // A registered client is kept with the grant; our own app is not, so its secret lives in one place and rotates there.
        ...(c.app ? {} : { client: asClient(clientInformation) }),
      };
    },
    async refresh(refreshToken, client) {
      const { as, metadata, resource } = await info();
      try {
        const tokens = await refreshAuthorization(as, {
          metadata,
          clientInformation: client ? { client_id: client.clientId, ...(client.clientSecret ? { client_secret: client.clientSecret } : {}) } : await clientFor(),
          refreshToken,
          resource,
          ...(f ? { fetchFn: f } : {}),
        });
        return { accessToken: tokens.access_token, expiresIn: tokens.expires_in ?? 3600, refreshToken: tokens.refresh_token };
      } catch (e) {
        // Revoked, expired, or our client was removed: only reconnecting fixes it.
        if (e instanceof InvalidGrantError || e instanceof InvalidClientError) throw new AccountGone(c.id as never);
        throw e;
      }
    },
    async identity() {
      return null;
    },
    async revoke(token) {
      const { metadata } = await info();
      // RFC 7009; on OAuth metadata, not on the OpenID variant the SDK's type also covers.
      const endpoint = (metadata as { revocation_endpoint?: string }).revocation_endpoint;
      if (!endpoint) return;
      const client = await clientFor();
      const form = new URLSearchParams({ token, client_id: client.client_id });
      if ('client_secret' in client && client.client_secret) form.set('client_secret', client.client_secret);
      await (f ?? fetch)(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString(),
      });
    },
    async tools(accessToken) {
      const hit = listed.get(accessToken);
      if (hit && hit.until > now()) return hit.tools;
      const session = await connect(c.url, accessToken);
      const all: McpToolInfo[] = [];
      try {
        let cursor: string | undefined;
        for (let page = 0; page < 20; page++) {
          const r = await session.listTools(cursor);
          all.push(...r.tools);
          cursor = r.nextCursor;
          if (!cursor) break;
        }
      } finally {
        await session.close().catch(() => {});
      }
      const tools = all.map(toTool);
      for (const [k, v] of listed) if (v.until <= now()) listed.delete(k);
      listed.set(accessToken, { tools, until: now() + 30 * 60_000 });
      return tools;
    },
  };
}
