import type { ChatMessage } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import type { AiAccount, AiUse, ChatAgent, ChatThreadHead, Writer } from '../src/chat';
import {
  type ContextStore,
  type ConversationSummary,
  CONVERSATION_TOOL,
  conversationTools,
  estimateTokens,
  KEEP_VERBATIM,
  madridDayStart,
  RECENT_BUDGET,
  summarizeIfLong,
  summaryTurn,
  toFold,
  TURN_CEILING,
  windowOf,
} from '../src/context';

const ORG = '10000000-0000-0000-0000-000000000001';
const AGENT = '20000000-0000-0000-0000-000000000001';
const THREAD = '30000000-0000-0000-0000-000000000001';
const finanzas: ChatAgent = { id: AGENT, orgId: ORG, name: 'Finanzas', ghost: 'finanzas', department: 'finanzas' };
const thread: ChatThreadHead = { id: THREAD, orgId: ORG, agentId: AGENT, title: 'Finanzas' };

let n = 0;
/** A message of about `tokens` tokens (three characters each). */
function msg(p: Partial<ChatMessage> & { tokens?: number; text?: string } = {}): ChatMessage {
  n += 1;
  const { tokens, text, ...rest } = p;
  return {
    id: `m${n}`,
    threadId: THREAD,
    authorKind: 'person',
    authorUserId: 'ana',
    authorAgentId: null,
    authorName: 'Ana',
    parts: [{ type: 'text', text: text ?? 'x'.repeat((tokens ?? 10) * 3) }],
    state: 'done',
    steps: [],
    createdAt: new Date(Date.UTC(2026, 10, 1, 9, 0) + n * 60_000).toISOString(),
    ...rest,
  };
}

const total = (ms: ChatMessage[]) => ms.reduce((t, m) => t + estimateTokens(m.parts.map((p) => ('text' in p ? p.text : '')).join('')), 0);

describe('what a turn carries', () => {
  it('every message after the summary while they fit', () => {
    const ms = [msg(), msg(), msg()];
    expect(windowOf(ms)).toEqual(ms);
  });

  it('only the newest that fit under the ceiling, while the summary is behind', () => {
    const ms = Array.from({ length: 10 }, () => msg({ tokens: TURN_CEILING / 4 + 100 }));
    const w = windowOf(ms);
    expect(w).toEqual(ms.slice(-3));
  });

  it('always the last message, however long', () => {
    const huge = msg({ tokens: TURN_CEILING * 2 });
    expect(windowOf([msg(), huge])).toEqual([huge]);
  });

  it('opens with the summary, saying up to when and how to find the rest', () => {
    const s: ConversationSummary = { text: 'Ana quiere cerrar el trimestre.', throughAt: '2026-11-18T09:30:00Z', throughMessage: 'm1' };
    const t = summaryTurn(s);
    expect(t).toContain('Ana quiere cerrar el trimestre.');
    expect(t).toContain('18 nov 2026');
    expect(t).toContain(CONVERSATION_TOOL);
  });
});

describe('when to summarise', () => {
  it('not while the latest messages fit the budget', () => {
    expect(toFold([msg({ tokens: RECENT_BUDGET / 2 }), msg({ tokens: RECENT_BUDGET / 2 - 100 })])).toBeNull();
  });

  it('past the budget: folds the oldest and leaves the newest word for word', () => {
    const ms = Array.from({ length: 8 }, () => msg({ tokens: 5_000 }));
    const fold = toFold(ms);
    expect(fold).toEqual(ms.slice(0, 6));
    expect(total(ms.slice(6))).toBeGreaterThanOrEqual(KEEP_VERBATIM);
  });

  it('never past a reply still being written', () => {
    const ms = Array.from({ length: 8 }, () => msg({ tokens: 5_000 }));
    ms[2] = { ...ms[2]!, state: 'working' };
    expect(toFold(ms)).toEqual(ms.slice(0, 2));
  });
});

function fakeStore(opts: { messages: ChatMessage[]; summary?: ConversationSummary | null; accounts?: AiAccount[] }) {
  const saved: Array<{ text: string; throughAt: string; throughMessage: string }> = [];
  const used: AiUse[] = [];
  const store: ContextStore = {
    conversation: async () => ({ summary: opts.summary ?? null, messages: opts.messages }),
    saveSummary: async (s) => {
      saved.push({ text: s.text, throughAt: s.throughAt, throughMessage: s.throughMessage });
      return true;
    },
    searchMessages: async () => [],
    aiAccounts: async () => opts.accounts ?? [{ id: 'key-1', provider: 'anthropic' }],
    recordAiUse: async (u) => {
      used.push(u);
    },
  };
  return { store, saved, used };
}

describe('summarising a long conversation', () => {
  const long = () => [
    msg({ text: 'La gestoría es Pérez y Asociados.' }),
    ...Array.from({ length: 7 }, () => msg({ tokens: 5_000 })),
  ];

  it("writes the new summary with the organisation's account, from the old one and the folded messages", async () => {
    const ms = long();
    const { store, saved, used } = fakeStore({ messages: ms, summary: { text: 'Resumen viejo.', throughAt: '2026-10-01T00:00:00Z', throughMessage: 'm0' } });
    const asked: Array<{ system: string; prompt: string; tools: number; account: string }> = [];
    const write: Writer = async ({ onText, onUsage }) => {
      onText('Resumen ');
      onText('nuevo.');
      onUsage?.({ model: 'claude-opus-5-5', tokens: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 }, limits: null });
    };
    await summarizeIfLong(
      {
        chat: store,
        writerFor: async (_o, account) => async (req) => {
          asked.push({ system: req.system, prompt: req.messages.map((m) => m.content).join('\n'), tools: req.tools.specs.length, account: account.id });
          await write(req);
        },
      },
      thread,
      finanzas,
    );
    expect(asked).toHaveLength(1);
    expect(asked[0]?.tools).toBe(0);
    expect(asked[0]?.prompt).toContain('Resumen viejo.');
    expect(asked[0]?.prompt).toContain('Pérez y Asociados');
    const folded = toFold(ms)!;
    expect(saved).toEqual([{ text: 'Resumen nuevo.', throughAt: folded.at(-1)!.createdAt, throughMessage: folded.at(-1)!.id }]);
    expect(used).toEqual([expect.objectContaining({ connectionId: 'key-1', outcome: 'ok', agentId: AGENT })]);
  });

  it('nothing to do while the conversation is short', async () => {
    const { store, saved } = fakeStore({ messages: [msg(), msg()] });
    let called = false;
    await summarizeIfLong({ chat: store, writerFor: async () => async () => void (called = true) }, thread, finanzas);
    expect(called).toBe(false);
    expect(saved).toEqual([]);
  });

  it('tries the next account when one fails, and never throws', async () => {
    const { store, saved, used } = fakeStore({ messages: long(), accounts: [{ id: 'sub', provider: 'claude' }, { id: 'key-1', provider: 'anthropic' }] });
    await summarizeIfLong(
      {
        chat: store,
        writerFor: async (_o, account) => async ({ onText }) => {
          if (account.id === 'sub') throw Object.assign(new Error('limit'), { status: 429 });
          onText('Bien.');
        },
      },
      thread,
      finanzas,
    );
    expect(saved.map((s) => s.text)).toEqual(['Bien.']);
    expect(used.map((u) => [u.connectionId, u.outcome])).toEqual([
      ['sub', 'limited'],
      ['key-1', 'ok'],
    ]);

    const failing = fakeStore({ messages: long() });
    await expect(summarizeIfLong({ chat: failing.store, writerFor: async () => async () => Promise.reject(new Error('down')) }, thread, finanzas)).resolves.toBeUndefined();
    expect(failing.saved).toEqual([]);
  });

  it('keeps no empty summary', async () => {
    const { store, saved } = fakeStore({ messages: long() });
    await summarizeIfLong({ chat: store, writerFor: async () => async ({ onText }) => onText('  ') }, thread, finanzas);
    expect(saved).toEqual([]);
  });
});

describe('searching the conversation', () => {
  const found = [
    { id: 'b', authorKind: 'agent' as const, authorName: 'Finanzas', authorAgentId: AGENT, createdAt: '2026-11-03T09:00:00Z', text: 'La pasé a la gestoría.' },
    { id: 'a', authorKind: 'person' as const, authorName: 'Ana', authorAgentId: null, createdAt: '2026-11-02T09:00:00Z', text: 'Manda la factura de Pérez.' },
  ];
  const tools = (got: unknown[]) =>
    conversationTools(
      {
        searchMessages: async (threadId, q) => {
          got.push({ threadId, ...q });
          return found;
        },
      },
      THREAD,
      AGENT,
    );

  it('is offered as a reading tool', () => {
    const t = tools([]);
    expect(t.specs.map((s) => s.name)).toEqual([CONVERSATION_TOOL]);
    expect(t.writes(CONVERSATION_TOOL)).toBe(false);
    expect(t.stepFor(CONVERSATION_TOOL)).toBe('Buscando en la conversación');
  });

  it('searches this conversation by words and Madrid days, and reads oldest first', async () => {
    const got: unknown[] = [];
    const out = await tools(got).run(CONVERSATION_TOOL, { query: ' factura  Pérez ', from: '2026-11-01', to: '2026-11-03' });
    expect(got).toEqual([{ threadId: THREAD, words: ['factura', 'Pérez'], since: '2026-10-31T23:00:00.000Z', until: '2026-11-03T23:00:00.000Z', max: 20 }]);
    expect(out.isError).toBe(false);
    expect(out.content.indexOf('Manda la factura')).toBeLessThan(out.content.indexOf('La pasé'));
    expect(out.content).toContain('Ana');
    expect(out.content).toContain('Tú');
  });

  it('asks for words or dates, and says when nothing matches', async () => {
    expect((await tools([]).run(CONVERSATION_TOOL, {})).isError).toBe(true);
    expect((await tools([]).run(CONVERSATION_TOOL, { from: 'ayer' })).isError).toBe(true);
    const none = conversationTools({ searchMessages: async () => [] }, THREAD, AGENT);
    expect(await none.run(CONVERSATION_TOOL, { query: 'nada' })).toEqual({ content: expect.stringContaining('Nada'), isError: false });
  });

  it('knows where Madrid days start, summer or winter', () => {
    expect(madridDayStart('2026-07-01')).toBe('2026-06-30T22:00:00.000Z');
    expect(madridDayStart('2026-12-01')).toBe('2026-11-30T23:00:00.000Z');
  });
});
