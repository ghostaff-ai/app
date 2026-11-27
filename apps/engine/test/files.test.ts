import type { ChatMessage, MessagePart } from '@ghostaff/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { ChatAgent, ChatStore, ChatThreadHead, Level, ModelTurn, Writer } from '../src/chat';
import { type FileStore, keyName, safeName } from '../src/files';
import { NO_TOOLS } from '../src/tools';
import { MemoryVault } from '../src/vault';

// Files in the chat (chat-like-whatsapp.md, phase 3).

const ORG = '10000000-0000-0000-0000-000000000001';
const AGENT = '20000000-0000-0000-0000-000000000001';
const CHAT = '30000000-0000-0000-0000-000000000009';
const GENERAL = '30000000-0000-0000-0000-000000000001';
const secretaria: ChatAgent = { id: AGENT, orgId: ORG, name: 'Secretaría', ghost: 'secretaria', department: 'direccion' };

function setup(levels: Record<string, Level> = { ana: 'talk', bea: 'read' }) {
  const messages: ChatMessage[] = [];
  const stored = new Map<string, Uint8Array>();
  const asked: ModelTurn[][] = [];
  const threads: ChatThreadHead[] = [
    { id: GENERAL, orgId: ORG, agentId: null, title: 'General' },
    { id: CHAT, orgId: ORG, agentId: AGENT, title: 'Secretaría' },
  ];
  const files: FileStore = {
    put: async (path, bytes) => void stored.set(path, bytes),
    get: async (path) => stored.get(path) ?? Promise.reject(new Error('missing')),
    remove: async (path) => void stored.delete(path),
    addMessage: async (m) => {
      const msg: ChatMessage = { id: m.id, threadId: m.threadId, authorKind: 'person', authorUserId: m.userId, authorAgentId: null, authorName: 'Ana', parts: m.parts, state: 'done', steps: [], createdAt: new Date(2026, 10, 26, 10, messages.length).toISOString() };
      messages.push(msg);
      return msg;
    },
    quotePart: async () => null,
  };
  let working: string | null = null;
  const chat = {
    levelFor: async (_a: string, u: string) => levels[u] ?? 'none',
    threadLevelFor: async (_t: string, u: string) => levels[u] ?? 'none',
    thread: async (id: string) => threads.find((t) => t.id === id) ?? null,
    agent: async (id: string) => (id === AGENT ? secretaria : null),
    orgAgents: async () => [secretaria],
    orgName: async () => 'Panadería',
    memberNames: async () => ['Ana', 'Bea'],
    recentMessages: async (t: string) => messages.filter((m) => m.threadId === t),
    conversation: async (t: string) => ({ summary: null, messages: messages.filter((m) => m.threadId === t) }),
    saveSummary: async () => true,
    searchMessages: async () => [],
    startReply: async () => {
      if (working) return null;
      working = `reply-${messages.length}`;
      return working;
    },
    updateReply: async (id: string, patch: { state?: string; text?: string }) => {
      if (patch.state && patch.state !== 'working') {
        working = null;
        messages.push({ id, threadId: CHAT, authorKind: 'agent', authorUserId: null, authorAgentId: AGENT, authorName: 'Secretaría', parts: [{ type: 'text', text: patch.text ?? '' }], state: 'done', steps: [], createdAt: new Date(2026, 10, 26, 11, messages.length).toISOString() });
      }
    },
    deleteMessage: async () => {},
    touchThread: async () => {},
    agentChat: async () => CHAT,
    aiAccounts: async () => [{ id: 'key-1', provider: 'anthropic' as const }],
    recordAiUse: async () => {},
    proposeAction: async () => 'action-1',
  } as unknown as ChatStore;
  const write: Writer = async (req) => {
    asked.push(req.messages);
    req.onText('Visto.');
  };
  const app = createApp({
    store: {} as never,
    vault: new MemoryVault(),
    checks: {} as never,
    userFromToken: async (t) => (t.startsWith('token-') ? t.slice(6) : null),
    chat: { chat, flushMs: 0, writerFor: async () => write, toolsFor: async () => NO_TOOLS, photoOf: (p) => files.get(p) },
    accounts: {} as never,
    actions: {} as never,
    files,
  });
  const send = (thread: string, o: { user?: string; type?: string; name?: string; caption?: string; body?: Uint8Array<ArrayBuffer> } = {}) =>
    app.request(`/threads/${thread}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer token-${o.user ?? 'ana'}`,
        'Content-Type': o.type ?? 'application/pdf',
        'X-File-Name': encodeURIComponent(o.name ?? 'presupuesto feria.pdf'),
        ...(o.caption ? { 'X-Caption': encodeURIComponent(o.caption) } : {}),
      },
      body: o.body ?? new Uint8Array([1, 2, 3]),
    });
  return { app, send, messages, stored, asked };
}

const doc = (m: ChatMessage) => m.parts.find((p) => p.type === 'document') as MessagePart & { path: string; name: string; size: number; mediaType: string };

describe('POST /threads/:id/files', () => {
  it('stores a document in General with its caption, and nobody answers it', async () => {
    const { send, stored, asked } = setup();
    const res = await send(GENERAL, { caption: 'El presupuesto de la feria' });
    expect(res.status).toBe(201);
    const { message, replied } = (await res.json()) as { message: ChatMessage; replied: boolean };
    expect(doc(message)).toMatchObject({ name: 'presupuesto feria.pdf', mediaType: 'application/pdf', size: 3 });
    expect(doc(message).path).toBe(`${ORG}/${GENERAL}/${message.id}/presupuesto-feria.pdf`);
    expect(message.parts[1]).toEqual({ type: 'text', text: 'El presupuesto de la feria' });
    expect(stored.size).toBe(1);
    expect(replied).toBe(false);
    expect(asked).toEqual([]);
  });

  it('lets the agent see a photo sent to it', async () => {
    const { send, asked } = setup();
    const res = await send(CHAT, { type: 'image/jpeg', name: 'factura.jpg' });
    expect(((await res.json()) as { replied: boolean }).replied).toBe(true);
    const last = asked[0]![asked[0]!.length - 1]!;
    expect(last.images).toEqual([{ mediaType: 'image/jpeg', data: Buffer.from([1, 2, 3]).toString('base64') }]);
    expect(last.content).toContain('[Archivo: factura.jpg (image/jpeg, 1 kB)]');
  });

  it('refuses what isn’t a file people send, someone who only reads, and a stranger', async () => {
    const { send, stored } = setup();
    expect((await send(GENERAL, { type: 'application/x-msdownload' })).status).toBe(415);
    expect((await send(GENERAL, { user: 'bea' })).status).toBe(403);
    expect((await send(GENERAL, { user: 'zoe' })).status).toBe(404);
    expect(stored.size).toBe(0);
  });

  it('keeps storage keys plain, the name as it was', () => {
    expect(keyName('Presupuesto cartelería.pdf')).toBe('Presupuesto-carteleria.pdf');
    expect(keyName('¿?')).toBe('archivo');
  });

  it('keeps names safe as a path', () => {
    expect(safeName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeName('')).toBe('archivo');
    expect(safeName(`${'a'.repeat(200)}.pdf`)).toHaveLength(120);
    expect(safeName(`${'a'.repeat(200)}.pdf`).endsWith('.pdf')).toBe(true);
  });
});
