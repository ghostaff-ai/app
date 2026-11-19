import type { McpConnector } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import { AccountGone, codeChallenge } from '../src/accounts';
import { clientMetadataDocument, mcpClientSecretName, mcpOAuth, type McpSession, scopesFor, toolName } from '../src/mcp';
import { ToolError } from '../src/tools';
import { MemoryVault } from '../src/vault';

const MCP = 'https://mcp.example/mcp';
const AS = 'https://auth.example';
const connector: McpConnector = {
  id: 'acme',
  area: 'Automatizaciones',
  kind: 'mcp',
  name: 'Acme',
  url: MCP,
  title: 'Acme',
  reach: 'r',
  dropScopes: ['admin'],
};

type Call = { url: string; method: string; body: string; headers: Headers };

/** A fake MCP server and its authorization server, answering only the documented endpoints. */
function fakeServer(opts: { cimd?: boolean; authMethods?: string[]; grantError?: string } = {}) {
  const calls: Call[] = [];
  let tokens = 0;
  const routes: Record<string, (c: Call) => { status?: number; json: unknown }> = {
    [`https://mcp.example/.well-known/oauth-protected-resource/mcp`]: () => ({
      json: { resource: MCP, authorization_servers: [AS], scopes_supported: ['read', 'write', 'admin'] },
    }),
    [`${AS}/.well-known/oauth-authorization-server`]: () => ({
      json: {
        issuer: AS,
        authorization_endpoint: `${AS}/authorize`,
        token_endpoint: `${AS}/token`,
        registration_endpoint: `${AS}/register`,
        revocation_endpoint: `${AS}/revoke`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: opts.authMethods ?? ['none'],
        scopes_supported: ['read', 'write', 'admin', 'offline_access'],
        client_id_metadata_document_supported: opts.cimd ?? false,
      },
    }),
    [`${AS}/register`]: (c) => ({
      status: 201,
      json: { ...JSON.parse(c.body), client_id: 'registered-client', ...(opts.authMethods?.includes('none') === false ? { client_secret: 'client-secret' } : {}) },
    }),
    [`${AS}/token`]: (c) => {
      const form = new URLSearchParams(c.body);
      if (form.get('grant_type') === 'refresh_token' && opts.grantError) return { status: 400, json: { error: opts.grantError } };
      tokens += 1;
      return { json: { access_token: `access-${tokens}`, refresh_token: `refresh-${tokens}`, expires_in: 3600, token_type: 'Bearer', scope: 'read write' } };
    },
    [`${AS}/revoke`]: () => ({ json: {} }),
  };
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const call = { url, method: init.method ?? 'GET', body: String(init.body ?? ''), headers: new Headers(init.headers) };
    calls.push(call);
    const route = routes[url.split('?')[0] ?? ''];
    if (!route) return new Response('not found', { status: 404 });
    const r = route(call);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { f, calls, to: (path: string) => calls.filter((c) => c.url.startsWith(`${AS}${path}`)) };
}

describe('connecting a maker\'s MCP server', () => {
  it('registers once, then signs in with PKCE, the resource and the server\'s scopes', async () => {
    const server = fakeServer();
    const vault = new MemoryVault();
    const p = mcpOAuth(connector, { vault, publicUrl: 'http://localhost:8787', fetch: server.f });
    const begun = await p.begin({ state: 'the-state', redirectUri: 'ignored' });
    await p.begin({ state: 'another', redirectUri: 'ignored' });
    expect(server.to('/register')).toHaveLength(1);
    const registration = JSON.parse(server.to('/register')[0]?.body ?? '{}');
    expect(registration).toMatchObject({
      client_name: 'Ghostaff',
      redirect_uris: ['http://localhost:8787/connections/oauth/acme/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    });
    expect(await vault.get(mcpClientSecretName('acme'))).toContain('registered-client');
    const q = new URL(begun.url).searchParams;
    expect(begun.url.startsWith(`${AS}/authorize?`)).toBe(true);
    expect(q.get('client_id')).toBe('registered-client');
    expect(q.get('resource')).toBe(MCP);
    expect(q.get('state')).toBe('the-state');
    expect(q.get('scope')).toBe('read write offline_access');
    expect(q.get('code_challenge')).toBe(codeChallenge(begun.codeVerifier));
    expect(q.get('redirect_uri')).toBe('http://localhost:8787/connections/oauth/acme/callback');
  });

  it('a server that wants a secret gets a confidential client', async () => {
    const server = fakeServer({ authMethods: ['client_secret_basic', 'client_secret_post'] });
    const vault = new MemoryVault();
    await mcpOAuth(connector, { vault, publicUrl: 'http://localhost:8787', fetch: server.f }).begin({ state: 's', redirectUri: '' });
    expect(JSON.parse(server.to('/register')[0]?.body ?? '{}').token_endpoint_auth_method).toBe('client_secret_post');
    expect(await vault.get(mcpClientSecretName('acme'))).toContain('client-secret');
  });

  it('on https, a server that takes a client metadata document needs no registration', async () => {
    const server = fakeServer({ cimd: true });
    const p = mcpOAuth(connector, { vault: new MemoryVault(), publicUrl: 'https://engine.example', fetch: server.f });
    const begun = await p.begin({ state: 's', redirectUri: '' });
    expect(server.to('/register')).toHaveLength(0);
    expect(new URL(begun.url).searchParams.get('client_id')).toBe('https://engine.example/oauth/client-metadata.json');
    const doc = clientMetadataDocument('https://engine.example', [{ id: 'acme', kind: 'mcp' }, { id: 'google', kind: 'google' }]);
    expect(doc.client_id).toBe('https://engine.example/oauth/client-metadata.json');
    expect(doc.redirect_uris).toEqual(['https://engine.example/connections/oauth/acme/callback']);
  });

  it('swaps the code with the verifier and the resource, and refreshes with rotation', async () => {
    const server = fakeServer();
    const p = mcpOAuth(connector, { vault: new MemoryVault(), publicUrl: 'http://localhost:8787', fetch: server.f });
    const grant = await p.exchange({ code: 'the-code', codeVerifier: 'v'.repeat(43), redirectUri: '' });
    expect(grant).toEqual({
      refreshToken: 'refresh-1',
      accessToken: 'access-1',
      expiresIn: 3600,
      scopes: ['read', 'write'],
      client: { clientId: 'registered-client' },
    });
    const form = new URLSearchParams(server.to('/token')[0]?.body);
    expect(form.get('code')).toBe('the-code');
    expect(form.get('code_verifier')).toBe('v'.repeat(43));
    expect(form.get('resource')).toBe(MCP);
    expect(await p.refresh('refresh-1', grant.client)).toEqual({ accessToken: 'access-2', expiresIn: 3600, refreshToken: 'refresh-2' });
    // A grant refreshes with the client it was issued to, even after the engine registered another one.
    expect(new URLSearchParams(server.to('/token')[1]?.body).get('client_id')).toBe('registered-client');
  });

  it('a revoked grant is AccountGone', async () => {
    const server = fakeServer({ grantError: 'invalid_grant' });
    const p = mcpOAuth(connector, { vault: new MemoryVault(), publicUrl: 'http://localhost:8787', fetch: server.f });
    await expect(p.refresh('r')).rejects.toBeInstanceOf(AccountGone);
  });

  it('scopes: the catalogue\'s when it names them, otherwise the server\'s minus what we never want', () => {
    const as = { issuer: AS, authorization_endpoint: '', token_endpoint: '', response_types_supported: ['code'] } as never;
    expect(scopesFor(connector, { resource: MCP, scopes_supported: ['a', 'admin'] }, as)).toBe('a');
    expect(scopesFor({ ...connector, scopes: ['mcp'] }, { resource: MCP, scopes_supported: ['a'] }, as)).toBe('mcp');
    expect(scopesFor(connector, undefined, as)).toBeUndefined();
  });
});

describe('a maker\'s MCP tools', () => {
  function withSession(opts: { error?: boolean } = {}) {
    const sessions: string[] = [];
    const called: Array<{ name: string; args: unknown }> = [];
    const connect = async (_url: string, token: string): Promise<McpSession> => {
      sessions.push(token);
      return {
        listTools: async (cursor) =>
          cursor
            ? { tools: [{ name: 'create_invoice', description: 'Crea una factura', inputSchema: { type: 'object', properties: { total: { type: 'number' } } } }] }
            : {
                tools: [{ name: 'list.invoices', description: 'Lista facturas', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }],
                nextCursor: 'page2',
              },
        callTool: async (name, args) => {
          called.push({ name, args });
          return opts.error
            ? { isError: true, content: [{ type: 'text', text: 'falta el cliente' }] }
            : { content: [{ type: 'text', text: '3 facturas' }, { type: 'image', data: 'x' }] };
        },
        close: async () => {},
      };
    };
    const p = mcpOAuth(connector, { vault: new MemoryVault(), publicUrl: 'http://localhost:8787', fetch: fakeServer().f, connect });
    return { p, sessions, called };
  }

  it('lists every page of the server\'s tools, named per connector, once per token', async () => {
    const { p, sessions } = withSession();
    const tools = (await p.tools?.('tok')) ?? [];
    await p.tools?.('tok');
    expect(sessions).toEqual(['tok']);
    expect(tools.map((t) => t.name)).toEqual(['acme_list_invoices', 'acme_create_invoice']);
    expect(tools.map((t) => t.writes)).toEqual([false, true]);
    expect(tools[0]?.description).toBe('Acme: Lista facturas');
    expect(tools[0]?.input_schema).toEqual({ type: 'object', properties: {} });
  });

  it('runs a tool with the original name and returns its text; an error result is a ToolError', async () => {
    const ok = withSession();
    const [list] = (await ok.p.tools?.('tok')) ?? [];
    expect(await list?.run({ accessToken: 'tok-2', fetch }, { year: 2026 })).toBe('3 facturas\n(una imagen)');
    expect(ok.called).toEqual([{ name: 'list.invoices', args: { year: 2026 } }]);
    expect(ok.sessions.at(-1)).toBe('tok-2');

    const bad = withSession({ error: true });
    const [failing] = (await bad.p.tools?.('tok')) ?? [];
    await expect(failing?.run({ accessToken: 't', fetch }, {})).rejects.toBeInstanceOf(ToolError);
  });

  it('keeps tool names within the API\'s limits', () => {
    expect(toolName('acme', 'a.b/c d')).toBe('acme_a_b_c_d');
    expect(toolName('acme', 'x'.repeat(100))).toHaveLength(64);
  });
});
