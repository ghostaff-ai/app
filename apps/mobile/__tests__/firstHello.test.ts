import { firstHello, type FirstHelloDeps, RETRY_AFTER_MS } from '@/lib/firstHello';

const secretaria = { id: 'a1', orgId: 's1', isMain: true };
const redes = { id: 'a2', orgId: 's1', isMain: false };
const owner = { id: 's1', role: 'owner' as const };

const deps = (over: Partial<FirstHelloDeps> = {}): FirstHelloDeps => ({
  hasThreads: jest.fn(() => Promise.resolve(false)),
  hello: jest.fn(() => Promise.resolve({ threadId: 't1' })),
  answer: jest.fn(),
  tried: new Map<string, number>(),
  now: () => 0,
  ...over,
});

describe('Secretaría says hello on a new space', () => {
  it('greets once the owner is there with an AI, in her first thread', async () => {
    const d = deps();
    await firstHello({ space: owner, agents: [redes, secretaria], aiReady: true }, d);
    expect(d.hello).toHaveBeenCalledWith('a1');
    expect(d.answer).toHaveBeenCalledWith('t1');
  });

  it('waits for a member to be an owner: only owners hire', async () => {
    const d = deps();
    await firstHello({ space: { id: 's1', role: 'member' }, agents: [secretaria], aiReady: true }, d);
    expect(d.hello).not.toHaveBeenCalled();
  });

  it('never greets with another space\'s Secretaría, still listed while you switch', async () => {
    const d = deps();
    const elsewhere = { id: 'b1', orgId: 's2', isMain: true };
    await firstHello({ space: owner, agents: [elsewhere], aiReady: true }, d);
    expect(d.hello).not.toHaveBeenCalled();
  });

  it('never greets a custom agent drawn as the secretaria ghost: only the main agent', async () => {
    const d = deps();
    const drawnAsHer = { id: 'a3', orgId: 's1', ghost: 'secretaria' as const, isMain: false };
    await firstHello({ space: owner, agents: [drawnAsHer], aiReady: true }, d);
    expect(d.hello).not.toHaveBeenCalled();
  });

  it('waits for the AI', async () => {
    const d = deps();
    await firstHello({ space: owner, agents: [secretaria], aiReady: false }, d);
    expect(d.hello).not.toHaveBeenCalled();
  });

  it('stays quiet once she has spoken', async () => {
    const d = deps({ hasThreads: jest.fn(() => Promise.resolve(true)) });
    await firstHello({ space: owner, agents: [secretaria], aiReady: true }, d);
    expect(d.hello).not.toHaveBeenCalled();
  });

  it('greets only once, however often Hoy renders', async () => {
    const d = deps();
    await Promise.all([
      firstHello({ space: owner, agents: [secretaria], aiReady: true }, d),
      firstHello({ space: owner, agents: [secretaria], aiReady: true }, d),
    ]);
    expect(d.hello).toHaveBeenCalledTimes(1);
  });

  it('tries again later when the engine failed, without hammering it', async () => {
    let t = 0;
    const d = deps({
      hello: jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ threadId: 't2' }),
      now: () => t,
    });
    await firstHello({ space: owner, agents: [secretaria], aiReady: true }, d);
    expect(d.answer).not.toHaveBeenCalled();
    t = RETRY_AFTER_MS - 1;
    await firstHello({ space: owner, agents: [secretaria], aiReady: true }, d);
    expect(d.hello).toHaveBeenCalledTimes(1);
    t = RETRY_AFTER_MS;
    await firstHello({ space: owner, agents: [secretaria], aiReady: true }, d);
    expect(d.hello).toHaveBeenCalledTimes(2);
    expect(d.answer).toHaveBeenCalledWith('t2');
  });
});
