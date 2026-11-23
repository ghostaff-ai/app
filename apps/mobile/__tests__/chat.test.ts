import type { Agent, ChatMessage } from '@ghostaff/shared';
import { shortTime, showAuthors, talkTarget, vacancies } from '@/lib/chat';
import { addMessage } from '@/lib/hooks/useChat';

const agent = (id: string, ghost: Agent['ghost']): Agent => ({
  id,
  orgId: 'o',
  name: id,
  ghost,
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

  it('sends the mic to Secretaría when the person may talk to her', () => {
    const team = [agent('fin', 'finanzas'), agent('sec', 'secretaria')];
    expect(talkTarget(team, { fin: 'talk', sec: 'talk' })?.id).toBe('sec');
    expect(talkTarget(team, { fin: 'talk', sec: 'read' })?.id).toBe('fin');
    expect(talkTarget(team, { fin: 'read' })).toBeNull();
  });

  it('lists the jobs nobody does yet', () => {
    expect(vacancies([agent('sec', 'secretaria'), agent('x', 'base')])).toEqual(['incorporacion', 'finanzas', 'redes', 'productor']);
  });
});
