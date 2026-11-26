import { describe, expect, it, vi } from 'vitest';
import { streamWith } from '../src/chatStore';
import { NO_TOOLS } from '../src/tools';

/** A client that answers each request with `text` and the usage given, and keeps what it was asked. */
function fakeClient(usage: Record<string, number>) {
  const requests: Array<Record<string, unknown>> = [];
  const client = {
    messages: {
      stream(req: Record<string, unknown>) {
        requests.push(req);
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hecho.' } };
          },
          finalMessage: async () => ({ content: [{ type: 'text', text: 'Hecho.' }], stop_reason: 'end_turn', usage }),
        };
      },
    },
  };
  return { client, requests };
}

describe('a reply through the Messages API', () => {
  it('asks for automatic prompt caching, and logs how much came from the cache', async () => {
    const { client, requests } = fakeClient({ input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 12_000, cache_creation_input_tokens: 300 });
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    let tokens: unknown;
    await streamWith(client as never)({
      system: 'sys',
      messages: [{ role: 'user', content: 'Ana (mié 26 nov 2026, 10:30): hola' }],
      tools: NO_TOOLS,
      onText: () => {},
      onTool: () => {},
      onUsage: (u) => {
        tokens = u.tokens;
      },
    });
    expect(requests[0]?.cache_control).toEqual({ type: 'ephemeral' });
    expect(requests[0]?.system).toBe('sys');
    expect(tokens).toEqual({ input: 40, output: 10, cacheRead: 12_000, cacheWrite: 300 });
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ message: 'chat usage', cacheRead: 12_000, cacheWrite: 300, input: 40 });
    log.mockRestore();
  });
});
