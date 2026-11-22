import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { exposedName, startToolServer, type ToolServer } from '../src/toolServer';
import { type AgentTools, NO_TOOLS, type ToolSpec } from '../src/tools';

const schema = { type: 'object' as const, properties: { days: { type: 'number' } } };

/** An organisation's tools: records every call and what the reply was told first. */
function fakeTools(specs: ToolSpec[] = [{ name: 'calendar_list', description: 'Lista eventos.', input_schema: schema }]) {
  const log: string[] = [];
  const tools: AgentTools = {
    ...NO_TOOLS,
    specs,
    async run(name, input) {
      log.push(`run ${name} ${JSON.stringify(input)}`);
      if (name === 'broken') return { content: 'Google no contesta.', isError: true };
      return { content: `eventos de ${name}`, isError: false };
    },
  };
  return { tools, log, onTool: (name: string) => void log.push(`step ${name}`) };
}

const servers: ToolServer[] = [];
async function start(f = fakeTools()) {
  const s = await startToolServer(f.tools, f.onTool);
  servers.push(s);
  return s;
}

async function connect(s: { url: string; token: string }) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: { Authorization: `Bearer ${s.token}` } } }));
  return client;
}

const post = (url: string, auth?: string) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '0' } } }),
  });

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

describe('the MCP server one subscription reply gets', () => {
  it("lists the organisation's tools with their schemas", async () => {
    const s = await start();
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const { tools } = await (await connect(s)).listTools();
    expect(tools).toEqual([{ name: 'calendar_list', description: 'Lista eventos.', inputSchema: schema }]);
  });

  it('runs a tool through the AgentTools it was given and tells the reply first', async () => {
    const f = fakeTools();
    const s = await start(f);
    const out = await (await connect(s)).callTool({ name: 'calendar_list', arguments: { days: 7 } });
    expect(out.content).toEqual([{ type: 'text', text: 'eventos de calendar_list' }]);
    expect(out.isError).toBe(false);
    expect(f.log).toEqual(['step calendar_list', 'run calendar_list {"days":7}']);
  });

  it('returns a failing tool as an error result', async () => {
    const s = await start(fakeTools([{ name: 'broken', description: 'x', input_schema: schema }]));
    const out = await (await connect(s)).callTool({ name: 'broken', arguments: {} });
    expect(out.isError).toBe(true);
    expect(out.content).toEqual([{ type: 'text', text: 'Google no contesta.' }]);
  });

  it("refuses a request without the token, or with another server's token", async () => {
    const f = fakeTools();
    const s = await start(f);
    const other = await start();
    expect((await post(s.url)).status).toBe(401);
    expect((await post(s.url, `Bearer ${other.token}`)).status).toBe(401);
    expect((await post(s.url, other.token)).status).toBe(401);
    expect(f.log).toEqual([]);
  });

  it('gives two servers different ports and tokens', async () => {
    const [a, b] = [await start(), await start()];
    expect(a.url).not.toBe(b.url);
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stops listening once closed', async () => {
    const s = await startToolServer(fakeTools().tools, () => {});
    await s.close();
    await expect(post(s.url, `Bearer ${s.token}`)).rejects.toThrow();
  });

  it('keeps names Claude Code can prefix', async () => {
    const short = 'a'.repeat(30);
    expect(exposedName(short)).toBe(short);
    const long = 'x'.repeat(64);
    const cut = exposedName(long);
    expect(cut).toHaveLength(49);
    expect(cut).toMatch(/^x{40}_[0-9a-f]{8}$/);
    expect(exposedName(long)).toBe(cut);
    expect(exposedName(`${'x'.repeat(63)}y`)).not.toBe(cut);

    const f = fakeTools([{ name: long, description: 'd', input_schema: schema }]);
    const client = await connect(await start(f));
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([cut]);
    await client.callTool({ name: cut, arguments: {} });
    expect(f.log).toEqual([`step ${long}`, `run ${long} {}`]);
  });
});
