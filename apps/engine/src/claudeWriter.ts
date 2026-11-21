// An agent answering in the chat on the organisation's Claude subscription: the
// unmodified Claude Code, `claude -p`, signed in with the token the owner got
// from Claude Code's own sign-in (claudeSession.ts), from the vault.
//
// No tools on this path yet: Claude Code runs with its built-in tools off and no
// MCP servers, so the connected accounts' tools (accounts.ts) are not available
// to an agent answering on a subscription. Giving them to it means serving them
// to Claude Code as an MCP server; until then the agent is told it lacks them.

import type { ModelTurn, Writer } from './chat';
import { makeHome, type PrintRunner } from './claudeCode';

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

const NO_TOOLS_LINE =
  'En esta respuesta no tienes las herramientas de las cuentas conectadas. Si te piden algo que las necesita, dilo claramente.';

export function claudeArgs(model: string, system: string): string[] {
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
    // No built-in tools, no MCP servers, nothing kept on disk.
    '--tools',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--effort',
    'low',
  ];
}

/** A Writer that runs Claude Code on the organisation's subscription. */
export function subscriptionWriter(token: string, run: PrintRunner, model: string, opts: { timeoutMs?: number } = {}): Writer {
  return async ({ system, messages, tools, onText }) => {
    const prompt = tools.specs.length ? `${system}\n${NO_TOOLS_LINE}` : system;
    const home = await makeHome();
    const child = run(claudeArgs(model, prompt), { home: home.path, token, stdin: transcript(messages) });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      void child.kill();
    }, opts.timeoutMs ?? RUN_TIMEOUT_MS);
    let result: { is_error?: boolean; subtype?: string; api_error_status?: number } | null = null;
    try {
      for await (const line of child.lines) {
        let event: {
          type?: string;
          event?: { type?: string; delta?: { type?: string; text?: string } };
          is_error?: boolean;
          subtype?: string;
          api_error_status?: number;
        };
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === 'stream_event' && event.event?.type === 'content_block_delta' && event.event.delta?.type === 'text_delta') {
          const text = event.event.delta.text ?? '';
          if (text) onText(text);
        } else if (event.type === 'result') {
          result = event;
        }
      }
      const code = await child.done;
      if (timedOut) throw new Error('claude code took too long');
      // Never the result's text in the error: only its status.
      if (!result) throw new Error(`claude code ended without an answer (exit ${code})`);
      if (result.is_error) throw new Error(`claude code failed (${result.api_error_status ?? result.subtype ?? 'error'})`);
    } finally {
      clearTimeout(timer);
      await child.kill();
      await home.remove().catch(() => {});
    }
  };
}

/**
 * Runs `primary`; if it fails before writing anything (a subscription refused,
 * cut off, out of its limits) and there is a fallback, the fallback answers.
 */
export function withFallback(primary: Writer, fallback: (() => Promise<Writer>) | null): Writer {
  if (!fallback) return primary;
  return async (req) => {
    let wrote = false;
    try {
      await primary({
        ...req,
        onText: (t) => {
          wrote = true;
          req.onText(t);
        },
      });
    } catch (e) {
      if (wrote) throw e;
      console.warn('claude subscription failed; answering with the Anthropic key', e instanceof Error ? e.message : typeof e);
      await (await fallback())(req);
    }
  };
}
