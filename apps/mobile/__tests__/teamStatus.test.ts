import type { Decision } from '@ghostaff/shared';
import { decisionHref } from '@/lib/deck';
import { agentTag, departmentLight, tagLabel, waitingByAgent } from '@/lib/team/status';

const decision = (over: Partial<Decision>): Decision => ({ id: 'd', answer: null, agent: null, action: null, ...over }) as Decision;

describe('agentTag', () => {
  it('puts what waits for you before anything else', () => {
    expect(agentTag({ waiting: 2, working: true, unread: true })).toEqual({ kind: 'waiting', count: 2 });
  });

  it('then work under way, then something unread', () => {
    expect(agentTag({ waiting: 0, working: true, unread: true })).toEqual({ kind: 'working' });
    expect(agentTag({ waiting: 0, working: false, unread: true })).toEqual({ kind: 'unread' });
  });

  it('shows nothing for an agent that is up to date', () => {
    expect(agentTag({ waiting: 0, working: false, unread: false })).toBeNull();
  });
});

describe('tagLabel', () => {
  it('says what the ghost is doing in a word or two', () => {
    expect(tagLabel({ kind: 'waiting', count: 1 })).toBe('Te espera');
    expect(tagLabel({ kind: 'waiting', count: 3 })).toBe('3 para ti');
    expect(tagLabel({ kind: 'working' })).toBe('Trabajando');
    expect(tagLabel({ kind: 'unread' })).toBe('Nuevo');
  });
});

describe('waitingByAgent', () => {
  it('counts the open decisions each agent asked', () => {
    const a = { id: 'a', name: 'Cuentas', ghost: 'finanzas' };
    const b = { id: 'b', name: 'Redes', ghost: 'redes' };
    const ds = [
      decision({ id: '1', agent: a }),
      decision({ id: '2', agent: a }),
      decision({ id: '3', agent: b }),
      decision({ id: '4', agent: b, answer: { answer: 'ok' } as Decision['answer'] }),
      decision({ id: '5', agent: null }),
    ];
    expect(waitingByAgent(ds)).toEqual({ a: 2, b: 1 });
  });
});

describe('departmentLight', () => {
  it('lights each department its own colour, and any other in teal', () => {
    expect(departmentLight('finanzas')).not.toEqual(departmentLight('marketing'));
    expect(departmentLight('legal')).toEqual([70, 200, 180]);
  });
});

describe('decisionHref', () => {
  it("opens an agent's proposed action in its conversation, a decision on its own screen", () => {
    expect(decisionHref({ id: 'x', action: { id: 'x', threadId: 't' } } as Decision)).toBe('/conversacion/t');
    expect(decisionHref({ id: 'x', action: null } as unknown as Decision)).toBe('/decision/x');
  });
});
