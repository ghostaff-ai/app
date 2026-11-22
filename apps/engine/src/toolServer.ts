// The tools of one reply on a Claude subscription, served to Claude Code as an
// MCP server (docs/plans/ongoing/subscription-tools.md). Claude Code is the only
// way a subscription may be used, and MCP the only way it takes outside tools,
// so each reply gets its own short-lived server: on loopback, behind a token
// only that reply's Claude Code knows, serving exactly the AgentTools the reply
// was given. The writer passes the reply's gated tools, so a tool that writes
// still becomes a card for an owner to approve.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { AgentTools } from './tools';

/** The server's name for Claude Code: its tools are `mcp__ghostaff__<name>`. */
export const MCP_SERVER_NAME = 'ghostaff';

/** The Messages API caps tool names at 64; Claude Code adds `mcp__ghostaff__` (15). */
const MAX_NAME = 64 - `mcp__${MCP_SERVER_NAME}__`.length;

/** A tool's name as Claude Code sees it: a long one cut, with a hash of the whole so two never meet. */
export function exposedName(name: string): string {
  if (name.length <= MAX_NAME) return name;
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 8);
  return `${name.slice(0, MAX_NAME - 9)}_${hash}`;
}

export interface ToolServer {
  /** `http://127.0.0.1:<port>/mcp` */
  url: string;
  /** The bearer token Claude Code must send. */
  token: string;
  close(): Promise<void>;
}

/** Serves `tools` until closed; `onTool` hears each call's name before it runs. */
export async function startToolServer(tools: AgentTools, onTool: (name: string) => void): Promise<ToolServer> {
  const byExposed = new Map(tools.specs.map((s) => [exposedName(s.name), s] as const));

  const mcp = new Server({ name: MCP_SERVER_NAME, version: '1.0.0' }, { capabilities: { tools: {} } });
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...byExposed].map(([name, s]) => ({ name, description: s.description, inputSchema: s.input_schema })),
  }));
  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    const spec = byExposed.get(req.params.name);
    if (!spec) return { content: [{ type: 'text', text: `No existe la herramienta ${req.params.name}.` }], isError: true };
    onTool(spec.name);
    const out = await tools.run(spec.name, req.params.arguments ?? {});
    return { content: [{ type: 'text', text: out.content }], isError: out.isError };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await mcp.connect(transport);

  const token = randomBytes(32).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  const http = createServer((req, res) => {
    const given = Buffer.from(req.headers.authorization ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected) || !req.url?.startsWith('/mcp')) {
      res.writeHead(401).end();
      return;
    }
    transport.handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const { port } = http.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    token,
    async close() {
      await mcp.close().catch(() => {});
      http.closeAllConnections();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
