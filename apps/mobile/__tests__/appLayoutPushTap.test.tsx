// A tapped push opens from the (app) layout only once the person is past every
// step of the way in (profile, organisation, an AI account for an owner) and its
// Stack is on screen: any earlier, a guard would redirect the route away.
import { render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import AppLayout from '@/app/(app)/_layout';

const mockOpenPushTap = jest.fn();
jest.mock('@/lib/push/PushProvider', () => ({ useOpenPushTap: (ready: boolean) => mockOpenPushTap(ready) }));

const mockState = {
  org: { loading: false, error: null as string | null, active: { id: 'org-1', name: 'Órdago', role: 'owner' } as object | null, organizations: [{}] },
  me: { loading: false, error: null as string | null, profile: { fullName: 'Jaime' } as object | null },
  connections: { loaded: true, error: null as string | null, items: [{ kind: 'ai' }] },
  canRunAgents: true,
};
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => ({ ...mockState.org, reload: () => {} }) }));
jest.mock('@/lib/profile/ProfileContext', () => ({ useProfile: () => ({ ...mockState.me, reload: () => {} }) }));
jest.mock('@/lib/hooks/useConnections', () => ({ useConnections: () => mockState.connections }));
jest.mock('@/lib/connections', () => ({ canRunAgents: () => mockState.canRunAgents }));
jest.mock('@/lib/layout', () => ({ useIsDesktop: () => false }));
jest.mock('@/lib/header', () => ({ headerFor: () => ({}) }));
jest.mock('@/lib/theme', () => ({ usePalette: () => ({}) }));
jest.mock('@/components/Sidebar', () => ({ Sidebar: () => null }));
jest.mock('@/components/DesktopListColumn', () => ({ DesktopListColumn: () => null }));
jest.mock('@/components/CloseButton', () => ({ CloseButton: () => null }));
jest.mock('@/components/ui', () => ({ Loading: () => null, Notice: () => null, Button: () => null }));
jest.mock('expo-router', () => {
  const Stack = ({ children }: { children: ReactNode }) => children;
  Stack.Protected = ({ children }: { children: ReactNode }) => children;
  Stack.Screen = () => null;
  return { Stack };
});

const lastReady = () => mockOpenPushTap.mock.calls.at(-1)?.[0];

beforeEach(() => {
  mockOpenPushTap.mockClear();
  mockState.org = { loading: false, error: null, active: { id: 'org-1', name: 'Órdago', role: 'owner' }, organizations: [{}] };
  mockState.me = { loading: false, error: null, profile: { fullName: 'Jaime' } };
  mockState.connections = { loaded: true, error: null, items: [{ kind: 'ai' }] };
  mockState.canRunAgents = true;
});

describe('the (app) layout releasing a tapped push', () => {
  it('releases it once every step has passed', async () => {
    await render(<AppLayout />);
    expect(lastReady()).toBe(true);
  });

  it('holds it while the organisation, the profile or the connections are loading', async () => {
    mockState.org.loading = true;
    await render(<AppLayout />);
    expect(lastReady()).toBe(false);

    mockState.org.loading = false;
    mockState.me.loading = true;
    await render(<AppLayout />);
    expect(lastReady()).toBe(false);

    mockState.me.loading = false;
    mockState.connections = { loaded: false, error: null, items: [] };
    await render(<AppLayout />);
    expect(lastReady()).toBe(false);
  });

  it('holds it while a step of the way in is still to do', async () => {
    mockState.me.profile = null;
    await render(<AppLayout />);
    expect(lastReady()).toBe(false);

    mockState.me.profile = { fullName: 'Jaime' };
    mockState.org.active = null;
    await render(<AppLayout />);
    expect(lastReady()).toBe(false);

    mockState.org.active = { id: 'org-1', name: 'Órdago', role: 'owner' };
    mockState.canRunAgents = false;
    await render(<AppLayout />);
    expect(lastReady()).toBe(false);
  });

  it('holds it while the account could not be loaded', async () => {
    mockState.org.error = 'sin red';
    await render(<AppLayout />);
    expect(lastReady()).toBe(false);
  });
});
