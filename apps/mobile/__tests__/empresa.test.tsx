import { render, screen } from '@testing-library/react-native';
import Empresa from '@/app/(app)/(tabs)/empresa';

type Space = { id: string; slug: string; name: string; kind: 'personal' | 'company'; role: 'owner' | 'member'; displayName: string };
let mockActive: Space;

jest.mock('@/lib/tabs', () => ({ useTabScreenTop: () => 0 }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => ({ active: mockActive, organizations: [mockActive] }) }));
jest.mock('@/lib/auth/AuthContext', () => ({ useAuth: () => ({ session: null, signOut: jest.fn() }) }));
jest.mock('@/lib/hooks/useChat', () => ({ useMembers: () => ({ members: [], reload: jest.fn() }) }));
jest.mock('@/lib/hooks/useConnections', () => ({ useConnections: () => ({ items: [], reload: jest.fn() }), useEngine: () => null }));
jest.mock('@/lib/profile/ProfileContext', () => ({ useProfile: () => ({ profile: { fullName: 'Ana', occupation: null, heardFrom: null, avatarPath: null }, reload: jest.fn() }) }));
jest.mock('@/lib/myPhoto', () => ({ changeMyPhoto: jest.fn(), removeMyPhoto: jest.fn() }));
jest.mock('@/components/chat/Message', () => ({ Avatar: () => null }));

describe('Empresa', () => {
  it('offers to invite into a company you own', async () => {
    mockActive = { id: 'c1', slug: 'ordago', name: 'Órdago', kind: 'company', role: 'owner', displayName: 'Jaime' };
    await render(<Empresa />);
    expect(screen.getByRole('button', { name: /Invitar a alguien/ })).toBeOnTheScreen();
  });

  it('does not offer it in your personal space, where nobody can be invited', async () => {
    mockActive = { id: 'p1', slug: 'personal', name: 'Personal', kind: 'personal', role: 'owner', displayName: 'Jaime' };
    await render(<Empresa />);
    expect(screen.queryByRole('button', { name: /Invitar a alguien/ })).toBeNull();
  });
});

describe('your profile photo', () => {
  it('offers to put one, or take one with the camera', async () => {
    mockActive = { id: 'o1', slug: 'o', name: 'Panadería', kind: 'company', role: 'owner', displayName: 'Ana' };
    await render(<Empresa />);
    expect(screen.getByText('Poner una foto de perfil')).toBeTruthy();
    expect(screen.getByText('Hacer una foto')).toBeTruthy();
    expect(screen.queryByText('Quitar la foto')).toBeNull();
  });
});
