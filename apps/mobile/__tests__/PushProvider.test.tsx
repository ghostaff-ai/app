// Receiving pushes: the device is registered once the person is signed in and
// has allowed notifications; a tap opens what the push points at, in its
// organisation; a reply for the chat on screen is not shown; signing out
// forgets the phone. `pushClient` (the only file that talks to
// expo-notifications) is mocked, except in the last block, which checks how it
// reads a push's data on each platform.
import { act, render, waitFor } from '@testing-library/react-native';
import type { PushData } from '@ghostaff/shared';
import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { PushProvider, usePush } from '@/lib/push/PushProvider';

type Device = { token: string; platform: 'ios' | 'android'; apnsEnvironment: 'production' | 'sandbox' | null; bundleId: string };

const mockClient = {
  permission: jest.fn(async () => 'granted'),
  requestPermission: jest.fn(async () => 'granted'),
  deviceToken: jest.fn(async (): Promise<Device | null> => ({ token: 'tok-1', platform: 'ios', apnsEnvironment: 'sandbox', bundleId: 'ai.ghostaff.app.dev' })),
  tap: null as ((d: PushData) => void) | null,
  hide: null as ((d: PushData) => boolean) | null,
};

jest.mock('@/lib/push/pushClient', () => ({
  permission: () => mockClient.permission(),
  requestPermission: () => mockClient.requestPermission(),
  deviceToken: () => mockClient.deviceToken(),
  onTap: (cb: (d: PushData) => void) => {
    mockClient.tap = cb;
    return () => {
      mockClient.tap = null;
    };
  },
  setForegroundFilter: (hide: (d: PushData) => boolean) => {
    mockClient.hide = hide;
  },
}));

const mockServices = {
  registerDevice: jest.fn(async (..._args: unknown[]) => {}),
  forgetDevice: jest.fn(async (..._args: unknown[]) => {}),
};
jest.mock('@ghostaff/shared/services', () => ({
  registerDevice: (...args: unknown[]) => mockServices.registerDevice(...args),
  forgetDevice: (...args: unknown[]) => mockServices.forgetDevice(...args),
}));

const mockSupabase = {
  auth: {
    getSession: jest.fn(async () => ({ data: { session: { user: { id: 'user-1' } } } })),
    onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    signOut: jest.fn(async () => ({ error: null })),
  },
};
// Getters: the imports above load these modules before this file's constants exist.
jest.mock('@/lib/supabase', () => ({
  get supabase() {
    return mockSupabase;
  },
}));

let mockSession: { user: { id: string } } | null = null;
jest.mock('@/lib/auth/AuthContext', () => ({
  ...jest.requireActual('@/lib/auth/AuthContext'),
  useAuth: () => ({ session: mockSession, loading: false }),
}));

const mockOrg = {
  organizations: [
    { id: 'org-1', name: 'Órdago' },
    { id: 'org-2', name: 'Ghostaff' },
  ],
  active: { id: 'org-1', name: 'Órdago' } as { id: string; name: string } | null,
  loading: false,
  choose: jest.fn(),
};
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => mockOrg }));

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
  useRootNavigationState: () => ({ key: 'root' }),
}));

// Loaded for real only by the block that reads a push's data, which uses none of it.
jest.mock('expo-notifications', () => ({}));

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: () => {}, signOut: async () => {} },
}));

let push: ReturnType<typeof usePush> | null = null;
function Probe() {
  push = usePush();
  return <Text>{push.permission}</Text>;
}
const tree = (children: ReactNode = <Probe />) => <PushProvider>{children}</PushProvider>;

beforeEach(() => {
  jest.clearAllMocks();
  mockSession = null;
  mockOrg.active = { id: 'org-1', name: 'Órdago' };
  mockClient.permission.mockImplementation(async () => 'granted');
  mockClient.tap = null;
  mockClient.hide = null;
  push = null;
});

describe('registering the device', () => {
  it('registers after sign-in when notifications are allowed', async () => {
    const view = await render(tree());
    await waitFor(() => expect(push?.permission).toBe('granted'));
    expect(mockServices.registerDevice).not.toHaveBeenCalled();

    mockSession = { user: { id: 'user-1' } };
    await view.rerender(tree());
    await waitFor(() => expect(mockServices.registerDevice).toHaveBeenCalledTimes(1));
    expect(mockServices.registerDevice).toHaveBeenCalledWith(mockSupabase, {
      token: 'tok-1',
      platform: 'ios',
      apnsEnvironment: 'sandbox',
      bundleId: 'ai.ghostaff.app.dev',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  });

  it('does not register while the person has not been asked, and does once they allow it', async () => {
    mockClient.permission.mockImplementation(async () => 'undetermined');
    mockSession = { user: { id: 'user-1' } };
    await render(tree());
    await waitFor(() => expect(push?.permission).toBe('undetermined'));
    expect(mockServices.registerDevice).not.toHaveBeenCalled();
    expect(mockClient.deviceToken).not.toHaveBeenCalled();

    await act(async () => {
      await push?.ask();
    });
    await waitFor(() => expect(mockServices.registerDevice).toHaveBeenCalledTimes(1));
  });

  it('registers again after signing out and back in', async () => {
    mockSession = { user: { id: 'user-1' } };
    const view = await render(tree());
    await waitFor(() => expect(mockServices.registerDevice).toHaveBeenCalledTimes(1));
    mockSession = null;
    await view.rerender(tree());
    mockSession = { user: { id: 'user-1' } };
    await view.rerender(tree());
    await waitFor(() => expect(mockServices.registerDevice).toHaveBeenCalledTimes(2));
  });
});

describe('a tap', () => {
  it("on another organisation's push switches to it, then opens the route", async () => {
    mockSession = { user: { id: 'user-1' } };
    await render(tree());
    await waitFor(() => expect(mockClient.tap).not.toBeNull());
    await act(async () => mockClient.tap?.({ kind: 'reply', orgId: 'org-2', route: '/chat/agent-9' }));

    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/chat/agent-9'));
    expect(mockOrg.choose).toHaveBeenCalledWith('org-2');
    expect(mockOrg.choose.mock.invocationCallOrder[0]).toBeLessThan(mockRouter.push.mock.invocationCallOrder[0] ?? 0);
  });

  it('in the organisation already open, or with none, only opens the route', async () => {
    mockSession = { user: { id: 'user-1' } };
    await render(tree());
    await waitFor(() => expect(mockClient.tap).not.toBeNull());
    await act(async () => mockClient.tap?.({ kind: 'reply', orgId: 'org-1', route: '/conversacion/thread-1' }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/conversacion/thread-1'));
    await act(async () => mockClient.tap?.({ kind: 'daily', route: '/decisiones' }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/decisiones'));
    expect(mockOrg.choose).not.toHaveBeenCalled();
  });

  it('that started the app waits until the person is in an organisation', async () => {
    mockSession = { user: { id: 'user-1' } };
    mockOrg.active = null;
    const view = await render(tree());
    await waitFor(() => expect(mockClient.tap).not.toBeNull());
    await act(async () => mockClient.tap?.({ kind: 'daily', route: '/decisiones' }));
    expect(mockRouter.push).not.toHaveBeenCalled();

    mockOrg.active = { id: 'org-1', name: 'Órdago' };
    await view.rerender(tree());
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/decisiones'));
  });
});

describe('the foreground filter', () => {
  it('hides a reply for the chat on screen and shows one for another chat', async () => {
    mockSession = { user: { id: 'user-1' } };
    await render(tree());
    await waitFor(() => expect(mockClient.hide).not.toBeNull());
    await act(async () => push?.setOnScreen('/chat/agent-1'));

    expect(mockClient.hide?.({ kind: 'reply', orgId: 'org-1', route: '/chat/agent-1' })).toBe(true);
    expect(mockClient.hide?.({ kind: 'reply', orgId: 'org-1', route: '/chat/agent-2' })).toBe(false);
    expect(mockClient.hide?.({ kind: 'daily', route: '/decisiones' })).toBe(false);

    await act(async () => push?.setOnScreen(null));
    expect(mockClient.hide?.({ kind: 'reply', orgId: 'org-1', route: '/chat/agent-1' })).toBe(false);
  });
});

describe('signing out', () => {
  const { AuthProvider, useAuth } = jest.requireActual<typeof import('@/lib/auth/AuthContext')>('@/lib/auth/AuthContext');
  let auth: ReturnType<typeof useAuth> | null = null;
  function AuthProbe() {
    auth = useAuth();
    return null;
  }

  it("forgets this phone before ending the session, and a failure doesn't keep anyone signed in", async () => {
    await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(auth?.session).toBeTruthy());

    await act(async () => auth?.signOut());
    expect(mockServices.forgetDevice).toHaveBeenCalledWith(mockSupabase, 'tok-1');
    expect(mockServices.forgetDevice.mock.invocationCallOrder[0]).toBeLessThan(mockSupabase.auth.signOut.mock.invocationCallOrder[0] ?? 0);

    mockServices.forgetDevice.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    await act(async () => auth?.signOut());
    expect(mockSupabase.auth.signOut).toHaveBeenCalledTimes(2);
  });
});

describe("reading a push's data", () => {
  // The engine sends straight to APNs and FCM, not through Expo's service. On
  // an iPhone expo-notifications fills `content.data` only from a `body` key
  // Expo's service writes; our keys sit beside `aps`, which it hands over as
  // the trigger's payload. On Android they are FCM's data, in `content.data`.
  const { pushDataOf } = jest.requireActual<typeof import('@/lib/push/pushClient')>('@/lib/push/pushClient');
  const request = (content: object, trigger: object) => ({ identifier: 'n-1', content, trigger }) as never;

  it('on an iPhone, from the keys beside aps', () => {
    const r = request(
      { title: 'Legal', body: 'Te ha contestado', data: null },
      { type: 'push', payload: { aps: { alert: { title: 'Legal' } }, kind: 'reply', orgId: 'org-1', route: '/chat/agent-1' } },
    );
    expect(pushDataOf(r)).toEqual({ kind: 'reply', orgId: 'org-1', route: '/chat/agent-1' });
  });

  it('on Android, from the data', () => {
    const r = request({ data: { kind: 'daily', route: '/decisiones' } }, { type: 'push', remoteMessage: {} });
    expect(pushDataOf(r)).toEqual({ kind: 'daily', route: '/decisiones' });
  });

  it('nothing from a push that is not ours', () => {
    expect(pushDataOf(request({ data: { kind: 'other', route: '/x' } }, { type: 'push' }))).toBeNull();
    expect(pushDataOf(request({ data: { kind: 'reply', route: 'https://example.com' } }, { type: 'push' }))).toBeNull();
    expect(pushDataOf(request({ data: null }, { type: 'push', payload: { aps: {} } }))).toBeNull();
  });
});
