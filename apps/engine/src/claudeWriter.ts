// An agent answering in the chat on the organisation's Claude subscription: the
// unmodified Claude Code, `claude -p`, signed in with the token the owner got
// from Claude Code's own sign-in (claudeSession.ts), from the vault.
//
// Claude Code's own tools stay off. The connected accounts' tools (accounts.ts)
// reach it as an MCP server of the engine's, one per reply (toolServer.ts):
// on loopback, behind a token written only into the run's throwaway HOME,
// serving the reply's gated tools, so a write still waits for an owner.
//
// What Claude Code reports on the way, its `rate_limit_event` lines and the
// `result` event's usage, goes to the reply's onUsage: the subscription's card
// shows its 5-hour and weekly limits from them.

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Limits, limitsFromEvent, mergeLimits, NO_TOKENS, tokensFromUsage } from '@ghostaff/shared';
import { AiFailure, type ModelTurn, type Writer } from './chat';
import { CLAUDE_SLOTS, makeHome, type PrintRunner, type Slots } from './claudeCode';
import { MCP_SERVER_NAME, startToolServer, type ToolServer } from './toolServer';

/** How long one answer may take before Claude Code is stopped. */
const RUN_TIMEOUT_MS = 5 * 60_000;

/** The conversation as one prompt: Claude Code in print mode takes a single message on stdin. */
export function transcript(messages: ModelTurn[]): string {
  const [only] = messages;
  if (messages.length === 1 && only?.role === 'user') return only.content;
  const lines = messages.map((m) => (m.role === 'assistant' ? `Tú: ${m.content}` : m.content));
  return [
    'La conversación hasta ahora, en orden; cada mensaje empieza con quién lo escribe («Tú» eres tú):',
    '',
    '<conversacion>',
    lines.join('\n\n'),
    '</conversacion>',
    '',
    'Contesta ahora al último mensaje. Escribe solo tu respuesta, sin poner tu nombre delante.',
  ].join('\n');
}

/** Claude Code's arguments; with `mcpConfigPath`, the reply's tools server and leave to use it. */
export function claudeArgs(model: string, system: string, mcpConfigPath?: string): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model',
    model,
    '--system-prompt',
    system,
    // No built-in tools, no MCP server but ours, nothing kept on disk.
    '--tools',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--effort',
    'low',
    ...(mcpConfigPath ? ['--mcp-config', mcpConfigPath, '--allowedTools', `mcp__${MCP_SERVER_NAME}`] : []),
  ];
}

/** How long a reply waits for a free Claude Code slot when it has nothing to fall back on. */
const SLOT_WAIT_MS = 60_000;

export interface SubscriptionOptions {
  timeoutMs?: number;
  slots?: Slots;
  /** All slots busy: fail at once (so the key answers) instead of waiting. */
  busyFails?: boolean;
}

/** A Writer that runs Claude Code on the organisation's subscription. */
export function subscriptionWriter(token: string, run: PrintRunner, model: string, opts: SubscriptionOptions = {}): Writer {
  const slots = opts.slots ?? CLAUDE_SLOTS;
  return async ({ system, messages, tools, onText, onTool, onUsage }) => {
    const release = opts.busyFails ? slots.tryTake() : await slots.take(SLOT_WAIT_MS);
    if (!release) throw new AiFailure('busy', 'every claude code slot is busy');
    try {
      await runOnce(token, run, model, opts.timeoutMs, { system, messages, tools, onText, onTool, onUsage });
    } finally {
      release();
    }
  };
}

async function runOnce(
  token: string,
  run: PrintRunner,
  model: string,
  timeoutMs: number | undefined,
  { system, messages, tools, onText, onTool, onUsage }: Pick<Parameters<Writer>[0], 'system' | 'messages' | 'tools' | 'onText' | 'onTool' | 'onUsage'>,
): Promise<void> {
  const home = await makeHome();
  let server: ToolServer | null = null;
  let configPath: string | undefined;
  try {
    if (tools.specs.length) {
      server = await startToolServer(tools, onTool);
      configPath = await writeMcpConfig(home.path, server);
    }
  } catch (e) {
    await server?.close();
    await home.remove().catch(() => {});
    throw e;
  }
  const child = run(claudeArgs(model, system, configPath), { home: home.path, token, stdin: transcript(messages) });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void child.kill();
  }, timeoutMs ?? RUN_TIMEOUT_MS);
  let result: { is_error?: boolean; subtype?: string; api_error_status?: number; usage?: unknown } | null = null;
  let limits: Limits | null = null;
  try {
    for await (const line of child.lines) {
      let event: {
        type?: string;
        event?: { type?: string; delta?: { type?: string; text?: string } };
        is_error?: boolean;
        subtype?: string;
        api_error_status?: number;
        usage?: unknown;
      };
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
        const text = event.event.delta.text ?? '';
        if (text) onText(text);
      } else if (event.type === 'rate_limit_event') {
        limits = mergeLimits(limits, limitsFromEvent(event));
      } else if (event.type === 'result') {
        result = event;
      }
    }
    const code = await child.done;
    if (timedOut) throw new AiFailure('failed', 'claude code took too long', limits);
    // Never the result's text in the error: only its status.
    if (!result) throw new AiFailure('failed', `claude code ended without an answer (exit ${code})`, limits);
    if (result.is_error) {
      const status = result.api_error_status;
      const atLimit = status === 429 || [limits?.fiveHour, limits?.sevenDay].some((w) => w?.status === 'rejected');
      const kind = atLimit ? 'limited' : status === 401 || status === 403 ? 'refused' : 'failed';
      throw new AiFailure(kind, `claude code failed (${status ?? result.subtype ?? 'error'})`, limits);
    }
    onUsage?.({ model, tokens: result.usage ? tokensFromUsage(result.usage) : NO_TOKENS, limits });
  } finally {
    clearTimeout(timer);
    await child.kill();
    await server?.close();
    await home.remove().catch(() => {});
  }
}

/** Where Claude Code finds the reply's tools server: a file only the run's HOME holds, never an argument. */
async function writeMcpConfig(home: string, server: ToolServer): Promise<string> {
  const path = join(home, 'mcp.json');
  const config = { mcpServers: { [MCP_SERVER_NAME]: { type: 'http', url: server.url, headers: { Authorization: `Bearer ${server.token}` } } } };
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
  return path;
}
