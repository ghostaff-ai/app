import type { ChatMessage } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { type AiAccount, type ChatAgent, type ChatStore, type ChatThreadHead, type Level, systemPrompt, toTurns, whoAnswers, type Writer } from '../src/chat';
import { type AgentTools, NO_TOOLS } from '../src/tools';
import { MemoryVault } from '../src/vault';

const ORG = '10000000-0000-0000-0000-000000000001';
const AGENT = '20000000-0000-0000-0000-000000000001';
const THREAD = '30000000-0000-0000-0000-000000000001';
const finanzas: ChatAgent = { id: AGENT, orgId: ORG, name: 'Finanzas', ghost: 'finanzas', department: 'finanzas' };
const REDES = '20000000-0000-0000-0000-000000000002';
const redes: ChatAgent = { id: REDES, orgId: ORG, name: 'Redes', ghost: 'redes', department: 'marketing' };

let n = 0;
function msg(p: Partial<ChatMessage> & { text: string }): ChatMessage {
  n += 1;
  return {
    id: `m${n}`,
    threadId: THREAD,
    authorKind: 'person',
    authorUserId: 'ana',
    authorAgentId: null,
    authorName: 'Ana',
    parts: [{ type: 'text', text: p.text }],
    state: 'done',
    steps: [],
    createdAt: new Date(2026, 10, 17, 10, n).toISOString(),
    ...p,
  };
}

function setup(
  opts: {
    levels?: Record<string, Level>;
    account?: AiAccount | null;
    write?: Writer;
    messages?: ChatMessage[];
    expose?: { messages?: ChatMessage[] };
    tools?: AgentTools;
  } = {},
) {
  const levels = opts.levels ?? { ana: 'talk', bea: 'read' };
  const messages: ChatMessage[] = opts.messages ?? [msg({ text: '¿Cómo vamos este mes?' })];
  if (opts.expose) opts.expose.messages = messages;
  const threads: ChatThreadHead[] = [{ id: THREAD, orgId: ORG, agentId: AGENT, title: 'Cierre' }];
  const updates: Array<{ id: string; text?: string; steps?: string[]; state?: string }> = [];
  let working: string | null = null;
  let startedAt = 0; // where the reply sits: it was created when it started
  const replier = new Map<string, ChatAgent>();
  const chat: ChatStore = {
    levelFor: async (a, u) => levels[a === REDES ? `${u}/redes` : u] ?? 'none',
    thread: async (id) => threads.find((t) => t.id === id) ?? null,
    agent: async (id) => (id === AGENT ? finanzas : null),
    orgAgents: async () => [finanzas, redes],
    orgName: async () => 'Panadería',
    memberNames: async () => ['Ana', 'Bea'],
    recentMessages: async () => messages,
    // The reply joins the thread once finished, as the database would show it.
    startReply: async (thread, agent) => {
      if (working) return null;
      working = `reply-${agent.name}-${messages.length}`;
      replier.set(working, agent);
      startedAt = messages.length;
      return working;
    },
    updateReply: async (id, patch) => {
      updates.push({ id, ...patch });
      if (patch.state && patch.state !== 'working') {
        working = null;
        const a = replier.get(id) ?? finanzas;
        messages.splice(startedAt, 0, msg({ id, authorKind: 'agent', authorAgentId: a.id, authorUserId: null, authorName: a.name, text: patch.text ?? '' }));
      }
    },
    touchThread: async () => {},
    createThread: async (_o, agentId, title) => {
      const id = '30000000-0000-0000-0000-000000000009';
      threads.push({ id, orgId: ORG, agentId, title });
      return id;
    },
    aiAccount: async () => (opts.account === undefined ? { provider: 'anthropic' } : opts.account),
  };
  const write: Writer =
    opts.write ??
    (async ({ onText }) => {
      onText('Vamos ');
      onText('bien.');
    });
  const asked: Array<{ system: string; messages: unknown }> = [];
  const app = createApp({
    store: {} as never,
    vault: new MemoryVault(),
    checks: {} as never,
    userFromToken: async (t) => (t.startsWith('token-') ? t.slice(6) : null),
    serviceAccount: 'x',
    chat: {
      chat,
      flushMs: 0,
      writerFor: async () => async (req) => {
        asked.push(req);
        await write(req);
      },
      toolsFor: async () => opts.tools ?? NO_TOOLS,
    },
    accounts: {} as never,
  });
  const call = (user: string, path: string) => app.request(path, { method: 'POST', headers: { Authorization: `Bearer token-${user}` } });
  return { call, updates, asked, threads };
}

describe('an agent answering in a thread', () => {
  it('writes the reply as it comes, then finishes it', async () => {
    const { call, updates, asked } = setup();
    const res = await call('ana', `/threads/${THREAD}/reply`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ replied: true });
    const last = updates[updates.length - 1];
    expect(last).toMatchObject({ text: 'Vamos bien.', state: 'done' });
    expect(updates.some((u) => u.text === 'Vamos ')).toBe(true);
    expect(asked[0]?.messages).toEqual([{ role: 'user', content: 'Ana: ¿Cómo vamos este mes?' }]);
  });

  it('refuses someone who may only see the agent', async () => {
    const { call, updates } = setup();
    expect((await call('bea', `/threads/${THREAD}/reply`)).status).toBe(403);
    expect((await call('carla', `/threads/${THREAD}/reply`)).status).toBe(403);
    expect(updates).toEqual([]);
  });

  it('says how to connect an AI account when there is none', async () => {
    const { call, updates } = setup({ account: null });
    await call('ana', `/threads/${THREAD}/reply`);
    expect(updates[updates.length - 1]?.text).toContain('Conexiones');
    expect(updates[updates.length - 1]?.state).toBe('done');
  });

  it('marks the reply failed when the model fails, keeping what it wrote', async () => {
    const { call, updates } = setup({
      write: async ({ onText }) => {
        onText('Empiezo');
        throw new Error('boom');
      },
    });
    expect((await call('ana', `/threads/${THREAD}/reply`)).status).toBe(200);
    const last = updates[updates.length - 1];
    expect(last?.state).toBe('failed');
    expect(last?.text).toMatch(/^Empiezo/);
  });

  it('stays quiet when the message is for someone else', async () => {
    const { call, updates } = setup({ messages: [msg({ text: '@Bea mira esto' })] });
    expect(await (await call('ana', `/threads/${THREAD}/reply`)).json()).toEqual({ replied: false });
    expect(updates).toEqual([]);
  });

  it('a new agent gets its own thread, and introduces itself there', async () => {
    const { call, updates, threads, asked } = setup({ messages: [] });
    const res = await call('ana', `/agents/${AGENT}/hello`);
    expect(res.status).toBe(201);
    const { threadId } = await res.json();
    expect(threads.find((t) => t.id === threadId)?.title).toBe('Primeros pasos');
    expect(updates).toEqual([]);
    expect(await (await call('ana', `/threads/${threadId}/reply`)).json()).toEqual({ replied: true });
    expect(JSON.stringify(asked[0]?.messages)).toContain('Preséntate');
    expect(updates[updates.length - 1]?.state).toBe('done');
    expect((await call('bea', `/agents/${AGENT}/hello`)).status).toBe(403);
  });

  it('brings in an agent the person mentions, if they may talk to it', async () => {
    const { call, updates, asked } = setup({ levels: { ana: 'talk', 'ana/redes': 'talk', bea: 'talk' }, messages: [msg({ text: '@Redes ¿esto lo publicamos?' })] });
    expect(await (await call('ana', `/threads/${THREAD}/reply`)).json()).toEqual({ replied: true });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.system).toContain('Eres Redes');
    expect(asked[0]?.system).toContain('conversación con Finanzas');
    expect(updates[updates.length - 1]?.state).toBe('done');
    // Bea may talk to Finanzas but not to Redes: Redes stays out.
    const quiet = setup({ levels: { bea: 'talk' }, messages: [msg({ authorUserId: 'bea', authorName: 'Bea', text: '@Redes hola' })] });
    expect(await (await quiet.call('bea', `/threads/${THREAD}/reply`)).json()).toEqual({ replied: false });
  });

  it('answers a message written while it was answering', async () => {
    const holder: { messages?: ChatMessage[] } = {};
    let first = true;
    const { call, asked } = setup({
      write: async ({ onText }) => {
        onText('Vale.');
        if (first) {
          first = false;
          holder.messages?.push(msg({ authorUserId: 'bea', authorName: 'Bea', text: 'Y otra cosa' }));
        }
      },
      expose: holder,
    });
    expect(await (await call('ana', `/threads/${THREAD}/reply`)).json()).toEqual({ replied: true });
    expect(asked).toHaveLength(2);
    expect(JSON.stringify(asked[1]?.messages)).toContain('Bea: Y otra cosa');
  });
});

describe('the chat as the model reads it', () => {
  it('signs people, merges turns and drops unfinished replies', () => {
    const ms = [
      msg({ authorKind: 'agent', authorAgentId: AGENT, authorName: 'Finanzas', authorUserId: null, text: 'Hola' }),
      msg({ text: 'Hola' }),
      msg({ authorUserId: 'bea', authorName: 'Bea', text: 'Y yo' }),
      msg({ authorKind: 'agent', authorAgentId: AGENT, authorName: 'Finanzas', authorUserId: null, text: 'A medias', state: 'working' }),
    ];
    expect(toTurns(ms, AGENT)).toEqual([{ role: 'user', content: 'Ana: Hola\n\nBea: Y yo' }]);
  });

  it('picks who answers: the thread\'s agent, the agents mentioned, or nobody', () => {
    const who = (text: string, kind: 'person' | 'agent' = 'person') =>
      whoAnswers([msg({ text, authorKind: kind })], finanzas, [finanzas, redes], ['Bea']).map((a) => a.name);
    expect(who('hola')).toEqual(['Finanzas']);
    expect(who('@Finanzas y @Bea')).toEqual(['Finanzas']);
    expect(who('@Bea hola')).toEqual([]);
    expect(who('@Redes ¿lo publicas?')).toEqual(['Redes']);
    expect(who('@Redes y @Finanzas, mirad')).toEqual(['Redes', 'Finanzas']);
    expect(who('yo', 'agent')).toEqual([]);
  });

  it('tells the agent who it is, in Spanish', () => {
    const s = systemPrompt(finanzas, 'Panadería');
    expect(s).toContain('Eres Finanzas');
    expect(s).toContain('Panadería');
    expect(s).toContain('con un documento detrás de cada euro');
    expect(s).toContain('Todavía no tienes acceso');
  });

  it('tells the agent which accounts it may use, what day it is, and to act only when asked', () => {
    const s = systemPrompt(finanzas, 'Panadería', {
      accounts: ['Google, con la cuenta ana@panaderia.es'],
      now: new Date('2026-11-18T09:30:00Z'),
    });
    expect(s).toContain('Google, con la cuenta ana@panaderia.es');
    expect(s).toContain('miércoles, 18 de noviembre de 2026');
    expect(s).toContain('10:30');
    expect(s).toContain('solo si te lo han pedido');
    expect(s).not.toContain('Todavía no tienes acceso');
  });
});

describe("an agent using its organisation's tools", () => {
  const tools: AgentTools = {
    specs: [{ name: 'google_calendar_list_events', description: 'Lista eventos', input_schema: { type: 'object', properties: {} } }],
    accounts: ['Google, con la cuenta ana@panaderia.es'],
    stepFor: (name) => (name === 'google_calendar_list_events' ? 'Mirando el calendario' : 'Trabajando'),
    run: async () => ({ content: '{"events":[]}', isError: false }),
  };

  it('gets the tools and the accounts, and shows the tool\'s step while it runs', async () => {
    const ran: unknown[] = [];
    const { call, updates, asked } = setup({
      tools,
      write: async ({ tools: t, onTool, onText }) => {
        onTool('google_calendar_list_events');
        ran.push(await t.run('google_calendar_list_events', {}));
        onText('No tienes nada esta semana.');
      },
    });
    await call('ana', `/threads/${THREAD}/reply`);
    expect(ran).toEqual([{ content: '{"events":[]}', isError: false }]);
    expect(asked[0]?.system).toContain('Google, con la cuenta ana@panaderia.es');
    expect(updates.some((u) => JSON.stringify(u.steps) === JSON.stringify(['Leyendo la conversación', 'Mirando el calendario', 'Escribiendo']))).toBe(true);
    const last = updates[updates.length - 1];
    expect(last).toMatchObject({ text: 'No tienes nada esta semana.', state: 'done' });
    expect(last?.steps?.slice(0, 3)).toEqual(['Leyendo la conversación', 'Mirando el calendario', 'Escribiendo']);
  });
});
