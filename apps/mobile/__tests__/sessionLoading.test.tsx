// When the stored session arrives, the profile and the organisation must read
// as loading until they are loaded for that person. A render in between that
// says «loaded, no profile» or «loaded, no organisation» flips the layout's
// guards and sends the person to Bienvenida or Empezar, losing the link they
// opened (a decision from a notification, an invitation, Conexiones).
import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ActiveOrgProvider, useActiveOrg } from '@/lib/org/ActiveOrgContext';
import { ProfileProvider, useProfile } from '@/lib/profile/ProfileContext';

let mockSession: { user: { id: string } } | null = null;

jest.mock('@/lib/auth/AuthContext', () => ({ useAuth: () => ({ session: mockSession, loading: false }) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => {}),
}));
jest.mock('@ghostaff/shared/services', () => ({
  getMyProfile: jest.fn(async () => ({ fullName: 'Jaime' })),
  listMyOrganizations: jest.fn(async () => [{ id: 'org-1', slug: 'ordago', name: 'Órdago', role: 'owner' }]),
  saveProfile: jest.fn(),
}));

type Seen = { signedIn: boolean; profileLoading: boolean; hasProfile: boolean; orgLoading: boolean; hasOrg: boolean };

function Probe({ seen }: { seen: Seen[] }) {
  const me = useProfile();
  const org = useActiveOrg();
  seen.push({ signedIn: !!mockSession, profileLoading: me.loading, hasProfile: !!me.profile, orgLoading: org.loading, hasOrg: !!org.active });
  return <Text>{org.active?.name ?? '-'}</Text>;
}

const tree = (seen: Seen[]) => (
  <ProfileProvider>
    <ActiveOrgProvider>
      <Probe seen={seen} />
    </ActiveOrgProvider>
  </ProfileProvider>
);

describe('the session arriving after the providers mount', () => {
  beforeEach(() => {
    mockSession = null;
  });

  it('never reads as loaded without the profile or the organisation of a person who has both', async () => {
    const seen: Seen[] = [];
    const view = await render(tree(seen));
    mockSession = { user: { id: 'user-1' } };
    await view.rerender(tree(seen));
    await waitFor(() => expect(seen.at(-1)?.hasOrg).toBe(true));
    const signedIn = seen.filter((s) => s.signedIn);
    expect(signedIn.filter((s) => !s.profileLoading && !s.hasProfile)).toEqual([]);
    expect(signedIn.filter((s) => !s.orgLoading && !s.hasOrg)).toEqual([]);
  });

  it('signed out, it is not loading', async () => {
    const seen: Seen[] = [];
    await render(tree(seen));
    await waitFor(() => expect(seen.at(-1)).toMatchObject({ profileLoading: false, orgLoading: false }));
  });
});
