import { renderHook, waitFor } from '@testing-library/react-native';
import { RETRY_AFTER_MS } from '@/lib/firstHello';
import { useFirstHello } from '@/lib/hooks/useFirstHello';

const mockHello = jest.fn();
jest.mock('@ghostaff/shared/services', () => ({
  agentHasThreads: () => Promise.resolve(false),
  agentHello: (_e: unknown, id: string) => mockHello(id),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/hooks/useChat', () => ({ letAgentAnswer: jest.fn() }));
// Stable, as the real useEngine is (memoised on the token).
const mockEngine = { url: 'http://engine', token: 't' };
jest.mock('@/lib/hooks/useConnections', () => ({ useEngine: () => mockEngine }));

const space = { id: 's1', slug: 'personal', name: 'Personal', kind: 'personal' as const, role: 'owner' as const, displayName: 'Ana' };
const agents = [{ id: 'a1', orgId: 's1', isMain: true }] as never[];

describe('useFirstHello', () => {
  it('tries again when you come back to Hoy after the engine failed', async () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockHello.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ threadId: 't1' });
    const { rerender } = await renderHook(({ focused }: { focused: boolean }) => useFirstHello(space, agents, true, focused), {
      initialProps: { focused: true },
    });
    await waitFor(() => expect(mockHello).toHaveBeenCalledTimes(1));
    now += RETRY_AFTER_MS;
    await rerender({ focused: false });
    await rerender({ focused: true });
    await waitFor(() => expect(mockHello).toHaveBeenCalledTimes(2));
  });
});
