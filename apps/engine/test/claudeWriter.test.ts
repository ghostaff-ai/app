import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Writer } from '../src/chat';
import { type PrintRunner, Slots } from '../src/claudeCode';
import { supabaseChatStore } from '../src/chatStore';
import { claudeAccountWriter, subscriptionWriter, transcript, withFallback } from '../src/claudeWriter';
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

describe('falling back to the Anthropic key', () => {
  it('answers with the key when the subscription fails before writing', async () => {
    const primary: Writer = async () => {
      throw new Error('claude code failed (401)');
    };
    const fallback = vi.fn(async (): Promise<Writer> => async ({ onText }) => onText('Con la clave.'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await ask(withFallback(primary, fallback))).toBe('Con la clave.');
    expect(fallback).toHaveBeenCalledOnce();
  });

  it('not when the subscription already wrote part of the answer', async () => {
    const primary: Writer = async ({ onText }) => {
      onText('Medio');
      throw new Error('cut');
    };
    const fallback = vi.fn(async (): Promise<Writer> => async () => {});
    await expect(ask(withFallback(primary, fallback))).rejects.toThrow('cut');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('without a key, the failure stands', async () => {
    const primary: Writer = async () => {
      throw new Error('refused');
    };
    await expect(ask(withFallback(primary, null))).rejects.toThrow('refused');
  });
});

describe('an organisation with a Claude subscription', () => {
  const TOOLS = { ...NO_TOOLS, specs: [{ name: 'calendar_list' }] as never };
  const keyWriter = () => vi.fn(async (): Promise<Writer> => async ({ onText }) => onText('Con la clave.'));

  it('an agent with connected apps answers with the key, which has the tools', async () => {
    const r = fakeRunner([delta('Suscripción'), result()]);
    const fallback = keyWriter();
    expect(await ask(claudeAccountWriter(TOKEN, r.run, 'm', fallback, { slots: new Slots(2) }), TOOLS)).toBe('Con la clave.');
    expect(r.calls).toHaveLength(0);
  });

  it('without a key, it answers on the subscription even then', async () => {
    const r = fakeRunner([delta('Suscripción'), result()]);
    expect(await ask(claudeAccountWriter(TOKEN, r.run, 'm', null, { slots: new Slots(2) }), TOOLS)).toBe('Suscripción');
  });

  it('an agent without tools answers on the subscription, and gives its slot back', async () => {
    const slots = new Slots(1);
    const r = fakeRunner([delta('Suscripción'), result()]);
    expect(await ask(claudeAccountWriter(TOKEN, r.run, 'm', keyWriter(), { slots }))).toBe('Suscripción');
    expect(slots.tryTake()).not.toBeNull();
  });

  it('every Claude Code slot busy: the key answers at once', async () => {
    const slots = new Slots(1);
    slots.tryTake();
    const r = fakeRunner([delta('Suscripción'), result()]);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await ask(claudeAccountWriter(TOKEN, r.run, 'm', keyWriter(), { slots }))).toBe('Con la clave.');
    expect(r.calls).toHaveLength(0);
  });

  it('every slot busy and no key: it waits its turn', async () => {
    const slots = new Slots(1);
    const busy = slots.tryTake();
    const r = fakeRunner([delta('Suscripción'), result()]);
    const answer = ask(claudeAccountWriter(TOKEN, r.run, 'm', null, { slots }));
    await new Promise((res) => setTimeout(res, 20));
    expect(r.calls).toHaveLength(0);
    busy?.();
    expect(await answer).toBe('Suscripción');
  });
});

describe("which of the organisation's AI accounts answers", () => {
  const storeWith = (rows: { provider: string; settings: Record<string, string> }[]) => {
    const query = { select: () => query, eq: () => query, then: (ok: (r: unknown) => unknown) => ok({ data: rows, error: null }) };
    return supabaseChatStore({ from: () => query } as unknown as SupabaseClient);
  };

  it('Vertex first, then the subscription with the key behind it, then the key', async () => {
    const vertex = { provider: 'vertex', settings: { project: 'p', region: 'europe-west1' } };
    const claude = { provider: 'claude', settings: {} };
    const key = { provider: 'anthropic', settings: {} };
    expect(await storeWith([key, claude, vertex]).aiAccount('o')).toEqual({ provider: 'vertex', project: 'p', region: 'europe-west1' });
    expect(await storeWith([key, claude]).aiAccount('o')).toEqual({ provider: 'claude', keyFallback: true });
    expect(await storeWith([claude]).aiAccount('o')).toEqual({ provider: 'claude', keyFallback: false });
    expect(await storeWith([key]).aiAccount('o')).toEqual({ provider: 'anthropic' });
    expect(await storeWith([]).aiAccount('o')).toBeNull();
  });
});
