import type { Agent, ChatMessage, ChatThread } from '@ghostaff/shared';
import { agentLastLine, chatRows, dayLabel, generalChat, generalLastLine, noteLength, personColour, shortTime, showAuthors, teamRows, timeOf, vacancies } from '@/lib/chat';
import { addMessage } from '@/lib/hooks/useChat';

const agent = (id: string, ghost: Agent['ghost'], isMain = ghost === 'secretaria'): Agent => ({
  id,
  orgId: 'o',
  name: id,
  ghost,
  isMain,
  department: 'direccion',
  runner: 'chat',
  description: null,
  schedule: null,
  memberDefault: 'read',
  accounts: null,
  createdAt: '2026-11-17T00:00:00Z',
});

const msg = (id: string, who: string, at: string, kind: 'person' | 'agent' = 'person'): ChatMessage => ({
  id,
  threadId: 't',
  authorKind: kind,
  authorUserId: kind === 'person' ? who : null,
  authorAgentId: kind === 'agent' ? who : null,
  state: 'done',
  steps: [],
  authorName: who,
  parts: [{ type: 'text', text: id }],
  createdAt: at,
});

describe('the chat rules', () => {
  it('says when a thread moved in short', () => {
    const now = new Date(2026, 10, 18, 12, 0);
    expect(shortTime(new Date(2026, 10, 18, 9, 5).toISOString(), now)).toBe('09:05');
    expect(shortTime(new Date(2026, 10, 17, 23, 0).toISOString(), now)).toBe('ayer');
    expect(shortTime(new Date(2026, 10, 16, 8, 0).toISOString(), now)).toBe('lun');
    expect(shortTime(new Date(2026, 10, 2, 8, 0).toISOString(), now)).toBe('2 nov');
  });

  it('shows the author once per run of messages', () => {
    const ms = [
      msg('a', 'ana', '2026-11-18T10:00:00Z'),
      msg('b', 'ana', '2026-11-18T10:01:00Z'),
      msg('c', 'fin', '2026-11-18T10:02:00Z', 'agent'),
      msg('d', 'ana', '2026-11-18T10:03:00Z'),
      msg('e', 'ana', '2026-11-18T10:20:00Z'),
    ];
    expect(showAuthors(ms)).toEqual([true, false, true, true, true]);
  });

  it('keeps messages once each, in the order written', () => {
    const a = msg('a', 'ana', '2026-11-18T10:00:00Z');
    const b = msg('b', 'ana', '2026-11-18T10:01:00Z');
    expect(addMessage(addMessage([b], a), b).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('keeps the latest version of a reply as it is written', () => {
    const w = (text: string, state: ChatMessage['state'] = 'working'): ChatMessage => ({
      ...msg('r', 'fin', '2026-11-18T10:02:00Z', 'agent'),
      parts: [{ type: 'text', text }],
      state,
    });
    let list = addMessage([], w('Ho'));
    list = addMessage(list, w('Hola, '));
    list = addMessage(list, w('Ho')); // a late, older copy
    expect(list).toHaveLength(1);
    expect(list[0]?.parts).toEqual([{ type: 'text', text: 'Hola, ' }]);
    list = addMessage(list, w('Hola, Ana.', 'done'));
    list = addMessage(list, w('Hola, Ana. Y m')); // a working copy after it finished
    expect(list[0]?.state).toBe('done');
  });

  it('lists one row per agent, its chat: the main one first, then who spoke last', () => {
    const team = [agent('fin', 'finanzas'), agent('red', 'redes'), agent('sec', 'secretaria'), agent('inc', 'incorporacion')];
    const t = (id: string, agentId: string, at: string, more: Partial<ChatThread> = {}): ChatThread => ({
      id, kind: 'agent', agentId, title: id, createdAt: at, lastMessageAt: at, lastAuthor: 'Ana', lastText: 'hola', lastVoiceMs: null, unread: false, following: true, ...more,
    });
    const rows = teamRows(team, [
      t('fin-chat', 'fin', '2026-11-20T10:00:00Z'),
      t('red-chat', 'red', '2026-11-22T10:00:00Z', { unread: true }),
      // A chat the person doesn't follow is still the agent's row: everyone who sees the agent reads it.
      t('inc-chat', 'inc', '2026-11-23T10:00:00Z', { following: false, unread: true }),
    ]);
    expect(rows.map((r) => r.agent.id)).toEqual(['sec', 'inc', 'red', 'fin']);
    expect(rows[2]?.last?.id).toBe('red-chat');
    expect(rows.map((r) => r.unread)).toEqual([false, true, true, false]);
  });

  it('puts the main agent first by its role, even when it is not drawn as secretaria', () => {
    const team = [agent('fin', 'finanzas'), agent('main', 'base', true), agent('sec', 'secretaria', false)];
    expect(teamRows(team, []).map((r) => r.agent.id)).toEqual(['main', 'sec', 'fin']);
  });

  it('shows General once there are two people, with a voice note as its length, not its transcript', () => {
    const general: ChatThread = {
      id: 'g', kind: 'general', agentId: null, title: 'General', createdAt: '2026-11-26T10:00:00Z', lastMessageAt: '2026-11-26T10:42:00Z',
      lastAuthor: 'Álvaro', lastText: 'Lo de la feria lo vemos mañana', lastVoiceMs: 84_400, unread: true, following: true,
    };
    const threads = [general];
    expect(generalChat(threads, 1)).toBeNull();
    expect(generalChat(threads, 2)?.id).toBe('g');
    expect(generalChat([], 3)).toBeNull();
    expect(generalLastLine(general)).toBe('Álvaro: Nota de voz · 1:24');
    expect(generalLastLine({ ...general, lastVoiceMs: null })).toBe('Álvaro: Lo de la feria lo vemos mañana');
    expect(generalLastLine({ ...general, lastVoiceMs: null, lastText: null })).toBeNull();
    expect(noteLength(725_000)).toBe('12:05');
  });

  it('lists the jobs nobody does yet', () => {
    expect(vacancies([agent('sec', 'secretaria'), agent('x', 'base')])).toEqual(['incorporacion', 'finanzas', 'redes', 'productor']);
  });
});

describe('a chat drawn as WhatsApp does (chat-like-whatsapp.md)', () => {
  const now = new Date(2026, 10, 26, 18, 0);
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  const say = (id: string, user: string, iso: string): ChatMessage => ({
    id, threadId: 'g', authorKind: 'person', authorUserId: user, authorAgentId: null, authorName: user === 'jaime' ? 'Jaime' : 'Álvaro',
    parts: [{ type: 'text', text: id }], state: 'done', steps: [], createdAt: iso,
  });

  it('names the days: today, yesterday, the weekday within a week, then the date', () => {
    expect(dayLabel(at(26, 9), now)).toBe('Hoy');
    expect(dayLabel(at(25, 23, 59), now)).toBe('Ayer');
    expect(dayLabel(at(22, 10), now)).toBe('domingo');
    expect(dayLabel(at(12, 10), now)).toBe('12 de noviembre');
    expect(dayLabel(new Date(2025, 2, 3).toISOString(), now)).toBe('3 de marzo de 2025');
    expect(timeOf(at(26, 9, 5))).toBe('09:05');
  });

  it('puts a pill where each day starts and runs the same author’s messages together', () => {
    const rows = chatRows([say('a', 'alvaro', at(25, 10)), say('b', 'alvaro', at(25, 10, 2)), say('c', 'jaime', at(25, 10, 3)), say('d', 'jaime', at(26, 9))], { me: 'jaime', now });
    expect(rows.map((r) => (r.kind === 'message' ? `${r.message.id}${r.first ? '*' : ''}` : r.kind === 'day' ? r.label : 'unread'))).toEqual(['Ayer', 'a*', 'b', 'c*', 'Hoy', 'd*']);
  });

  it('marks where the unread begin, counting only what others wrote', () => {
    const rows = chatRows([say('a', 'alvaro', at(26, 8)), say('b', 'jaime', at(26, 9)), say('c', 'alvaro', at(26, 9, 1)), say('d', 'alvaro', at(26, 9, 2))], { me: 'jaime', readAt: at(26, 8, 30), now });
    expect(rows.map((r) => (r.kind === 'message' ? r.message.id : r.kind === 'unread' ? `unread ${r.count}` : r.label))).toEqual(['Hoy', 'a', 'b', 'unread 2', 'c', 'd']);
    expect(rows.filter((r) => r.kind === 'message' && r.unread).map((r) => (r as { message: ChatMessage }).message.id)).toEqual(['c', 'd']);
    expect(chatRows([say('a', 'alvaro', at(26, 8))], { me: 'jaime', readAt: null, now }).some((r) => r.kind === 'unread')).toBe(false);
  });

  it('gives each person one colour', () => {
    expect(personColour('alvaro')).toBe(personColour('alvaro'));
  });
});

describe('agentLastLine', () => {
  const t = { lastText: 'Hoy la cierro yo', lastAuthor: 'Bea' } as ChatThread;
  it('signs what someone else said, and leaves the agent’s own words unsigned', () => {
    expect(agentLastLine('Secretaría', t)).toBe('Bea: Hoy la cierro yo');
    expect(agentLastLine('Secretaría', { ...t, lastAuthor: 'Secretaría' })).toBe('Hoy la cierro yo');
  });
  it('has no line for a chat with nothing said', () => {
    expect(agentLastLine('Secretaría', null)).toBeNull();
    expect(agentLastLine('Secretaría', { ...t, lastText: null })).toBeNull();
  });
});
