// useThread marks the thread read only while the person can see it: the app in
// the foreground and the screen focused. On Android the Realtime socket stays
// open in the background, so a reply arriving then must not be marked read (the
// engine would close its push as `read`); it is marked once the app is back.
import type { ChatMessage } from '@ghostaff/shared';
import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useThread } from '@/lib/hooks/useChat';

const mockMark = jest.fn(async (..._a: unknown[]) => {});
let mockOnMessage: (m: ChatMessage) => void = () => {};

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/hooks/useConnections', () => ({ useEngine: () => null }));
jest.mock('@ghostaff/shared/services', () => ({
  getThread: async () => ({ id: 't1', agentId: 'a1' }),
  listMessages: async () => [],
  markThreadRead: (...a: unknown[]) => mockMark(...a),
  myReadMark: async () => null,
  readByAllUntil: async () => null,
  listReactions: async () => [],
  subscribeToReactions: () => () => {},
  subscribeToThread: (_c: unknown, _t: string, onMessage: (m: ChatMessage) => void) => {
    mockOnMessage = onMessage;
    return () => {};
  },
}));

// The screen's focus: `mockBlur()` leaves it (another screen on top), `mockFocus()` comes back.
let mockFocusEffect: () => void | (() => void) = () => {};
let mockCleanup: void | (() => void);
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const { useEffect } = require('react');
    useEffect(() => {
      mockFocusEffect = effect;
      mockCleanup = effect();
      return () => mockCleanup?.();
    }, [effect]);
  },
}));
const mockBlur = () => act(async () => mockCleanup?.());
const mockFocus = () =>
  act(async () => {
    mockCleanup = mockFocusEffect();
  });

let appState = 'active';
let onAppState: (s: string) => void = () => {};
const goTo = (s: string) =>
  act(async () => {
    appState = s;
    onAppState(s);
  });

const reply: ChatMessage = {
  id: 'm1',
  threadId: 't1',
  authorKind: 'agent',
  authorUserId: null,
  authorAgentId: 'a1',
  state: 'done',
  steps: [],
  authorName: 'Secretaría',
  parts: [{ type: 'text', text: 'Hecho' }],
  createdAt: '2026-11-25T10:00:00Z',
};
const arrives = () => act(async () => mockOnMessage(reply));

const settle = () => act(async () => {});

describe('useThread marks read only while seen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    appState = 'active';
    Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => appState });
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
      onAppState = h;
      return { remove: jest.fn() };
    }) as never);
  });

  it('marks read on open and when a message arrives on screen', async () => {
    await renderHook(() => useThread('t1'));
    await settle();
    expect(mockMark).toHaveBeenCalledWith({}, 't1');
    mockMark.mockClear();
    await arrives();
    expect(mockMark).toHaveBeenCalledTimes(1);
  });

  it("doesn't mark read a reply that arrives in the background, and marks it once back", async () => {
    await renderHook(() => useThread('t1'));
    await settle();
    await goTo('background');
    mockMark.mockClear();
    await arrives();
    expect(mockMark).not.toHaveBeenCalled();
    await goTo('active');
    expect(mockMark).toHaveBeenCalledWith({}, 't1');
  });

  it("doesn't mark read while another screen covers it, and marks it on focus", async () => {
    await renderHook(() => useThread('t1'));
    await settle();
    await mockBlur();
    mockMark.mockClear();
    await arrives();
    expect(mockMark).not.toHaveBeenCalled();
    // Back to the foreground with the screen still covered: nothing yet.
    await goTo('background');
    await goTo('active');
    expect(mockMark).not.toHaveBeenCalled();
    await mockFocus();
    expect(mockMark).toHaveBeenCalledWith({}, 't1');
  });

  it("doesn't mark read on open when the app opened in the background", async () => {
    appState = 'background';
    await renderHook(() => useThread('t1'));
    await settle();
    expect(mockMark).not.toHaveBeenCalled();
    await goTo('active');
    expect(mockMark).toHaveBeenCalledWith({}, 't1');
  });
});
