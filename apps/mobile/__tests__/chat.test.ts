import type { Agent, ChatMessage, ChatThread } from '@ghostaff/shared';
import { shortTime, showAuthors, teamRows, vacancies } from '@/lib/chat';
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
      id, agentId, title: id, createdAt: at, lastMessageAt: at, lastAuthor: 'Ana', lastText: 'hola', unread: false, following: true, ...more,
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

  it('lists the jobs nobody does yet', () => {
    expect(vacancies([agent('sec', 'secretaria'), agent('x', 'base')])).toEqual(['incorporacion', 'finanzas', 'redes', 'productor']);
  });
});
