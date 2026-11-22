import { describe, expect, it } from 'vitest';
import { AiFailure, type Writer } from '../src/chat';
import { type PrintRunner, Slots } from '../src/claudeCode';
import { costOf, orderAccounts } from '../src/chatStore';
import { subscriptionWriter, transcript } from '../src/claudeWriter';
import { NO_TOOLS } from '../src/tools';

const TOKEN = `sk-ant-oat01-${'t'.repeat(90)}`;
const delta = (text: string) => JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
const result = (isError = false) => JSON.stringify({ type: 'result', subtype: 'success', is_error: isError, ...(isError ? { api_error_status: 401, result: 'Failed to authenticate.' } : {}) });

function fakeRunner(lines: string[], exit = 0) {
  const calls: { args: string[]; token: string; stdin: string; home: string }[] = [];
  let killed = 0;
  const run: PrintRunner = (args, opts) => {
    calls.push({ args, ...opts });
    return {
      lines: (async function* () {
        yield* lines;
      })(),
      done: Promise.resolve(exit),
      kill: async () => void killed++,
    };
  };
  return { run, calls, killed: () => killed };
}

const ask = async (write: Writer, tools = NO_TOOLS) => {
  let text = '';
  await write({
    system: 'Eres Legal.',
    messages: [{ role: 'user', content: 'Ana: hola' }],
    tools,
    onText: (t) => (text += t),
    onTool: () => {},
  });
  return text;
};

describe('an agent answering on the Claude subscription', () => {
  it('runs the unmodified Claude Code with no tools, the token in its environment, and streams its text', async () => {
    const r = fakeRunner([JSON.stringify({ type: 'system', subtype: 'init' }), delta('Hola, '), delta('Ana.'), 'not json', result()]);
    expect(await ask(subscriptionWriter(TOKEN, r.run, 'claude-opus-5-5'))).toBe('Hola, Ana.');
    const [call] = r.calls;
    expect(call?.token).toBe(TOKEN);
    expect(call?.stdin).toBe('Ana: hola');
    expect(call?.args.slice(0, 7)).toEqual(['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--model', 'claude-opus-5-5']);
    expect(call?.args[call.args.indexOf('--system-prompt') + 1]).toBe('Eres Legal.');
    expect(call?.args[call.args.indexOf('--tools') + 1]).toBe('');
    expect(call?.args).toContain('--strict-mcp-config');
    expect(call?.args.join(' ')).not.toContain(TOKEN);
    expect(r.killed()).toBe(1);
  });

  it('tells the agent it has no tools on this path when the organisation has some', async () => {
    const r = fakeRunner([delta('x'), result()]);
    await ask(subscriptionWriter(TOKEN, r.run, 'm'), { ...NO_TOOLS, specs: [{ name: 'calendar_list' }] as never });
    const system = r.calls[0]?.args[r.calls[0].args.indexOf('--system-prompt') + 1];
    expect(system).toContain('no tienes las herramientas');
  });

  it('fails when Claude Code reports an error, without its text in the error', async () => {
    const r = fakeRunner([result(true)], 1);
    await expect(ask(subscriptionWriter(TOKEN, r.run, 'm'))).rejects.toThrow('claude code failed (401)');
  });

  it('fails when Claude Code ends without an answer', async () => {
    const r = fakeRunner([], 1);
    await expect(ask(subscriptionWriter(TOKEN, r.run, 'm'))).rejects.toThrow(/without an answer/);
  });

  it('gives the conversation as one signed transcript', () => {
    const t = transcript([
      { role: 'user', content: 'Ana: ¿qué tal?' },
      { role: 'assistant', content: 'Bien.' },
      { role: 'user', content: 'Bea: ¿y el contrato?' },
    ]);
    expect(t).toContain('Ana: ¿qué tal?\n\nTú: Bien.\n\nBea: ¿y el contrato?');
    expect(t).toMatch(/Contesta ahora al último mensaje/);
  });
});

describe('what the subscription used and how close it is to its limits', () => {
  const limitLine = (fiveHour: number, sevenDay: number, status = 'allowed') =>
    JSON.stringify({
      type: 'rate_limit_event',
      rate_limit_info: {
        status,
        rateLimitType: 'seven_day',
        unifiedWindows: {
          five_hour: { utilization: fiveHour, resetsAt: 1795363200, status: 'allowed' },
          seven_day: { utilization: sevenDay, resetsAt: 1795582800, status },
        },
      },
    });

  it('reports the tokens of the result and the last limits Claude Code gave', async () => {
    const r = fakeRunner([
      limitLine(0.1, 0.5),
      delta('Hola.'),
      limitLine(0.2, 0.6),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 3, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 } }),
    ]);
    const seen: unknown[] = [];
    await subscriptionWriter(TOKEN, r.run, 'claude-opus-5-5')({
      system: 's',
      messages: [{ role: 'user', content: 'hola' }],
      tools: NO_TOOLS,
      onText: () => {},
      onTool: () => {},
      onUsage: (u) => seen.push(u),
    });
    expect(seen).toEqual([
      {
        model: 'claude-opus-5-5',
        tokens: { input: 3, output: 40, cacheRead: 900, cacheWrite: 100 },
        limits: expect.objectContaining({
          fiveHour: { utilization: 0.2, resetsAt: '2026-11-22T16:00:00.000Z', status: 'allowed' },
          sevenDay: { utilization: 0.6, resetsAt: '2026-11-25T05:00:00.000Z', status: 'allowed' },
        }),
      },
    ]);
  });

  it('a refusal at the limit is `limited`, with the limits on the failure', async () => {
    const r = fakeRunner([limitLine(0.3, 1, 'rejected'), JSON.stringify({ type: 'result', is_error: true, api_error_status: 429 })], 1);
    const failure = await ask(subscriptionWriter(TOKEN, r.run, 'm')).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(AiFailure);
    expect(failure).toMatchObject({ kind: 'limited', limits: { sevenDay: { status: 'rejected' } } });
  });

  it('a sign-in Anthropic no longer accepts is `refused`', async () => {
    const r = fakeRunner([result(true)], 1);
    await expect(ask(subscriptionWriter(TOKEN, r.run, 'm'))).rejects.toMatchObject({ kind: 'refused' });
  });

  it('every slot busy: fails at once when told to (another account answers), else waits its turn', async () => {
    const slots = new Slots(1);
    const busy = slots.tryTake();
    const r = fakeRunner([delta('Suscripción'), result()]);
    await expect(ask(subscriptionWriter(TOKEN, r.run, 'm', { slots, busyFails: true }))).rejects.toMatchObject({ kind: 'busy' });
    const answer = ask(subscriptionWriter(TOKEN, r.run, 'm', { slots }));
    await new Promise((res) => setTimeout(res, 20));
    expect(r.calls).toHaveLength(0);
    busy?.();
    expect(await answer).toBe('Suscripción');
    expect(slots.tryTake()).not.toBeNull();
  });
});

describe("the order the organisation's AI accounts are tried in", () => {
  const now = new Date('2026-11-22T12:00:00Z');
  const row = (id: string, provider: string, limits: unknown = {}, settings: Record<string, string> = {}) => ({ id, provider, settings, limits });

  it('the owner’s, leaving out what the engine cannot run', () => {
    const rows = [row('k', 'anthropic'), row('o', 'openai'), row('s', 'claude'), row('v', 'vertex', {}, { project: 'p', region: 'europe-west1' })];
    expect(orderAccounts(rows, now)).toEqual([
      { id: 'k', provider: 'anthropic' },
      { id: 's', provider: 'claude' },
      { id: 'v', provider: 'vertex', project: 'p', region: 'europe-west1' },
    ]);
  });

  it('a subscription at a limit that has not reset goes last; once reset, back in its place', () => {
    const limited = { seven_day: { utilization: 1, resets_at: '2026-11-23T00:00:00Z', status: 'rejected' } };
    const rows = [row('s1', 'claude', limited), row('s2', 'claude'), row('k', 'anthropic')];
    expect(orderAccounts(rows, now).map((a) => a.id)).toEqual(['s2', 'k', 's1']);
    expect(orderAccounts(rows, new Date('2026-11-23T01:00:00Z')).map((a) => a.id)).toEqual(['s1', 's2', 'k']);
  });

  it('a subscription costs nothing per token; a key or Google Cloud at list price', () => {
    const t = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(costOf({ id: 's', provider: 'claude' }, 'claude-opus-5-5', t)).toBeNull();
    expect(costOf({ id: 'k', provider: 'anthropic' }, 'claude-opus-5-5', t)).toBe(4);
  });
});
