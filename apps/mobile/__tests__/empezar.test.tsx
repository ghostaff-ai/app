import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Start from '@/app/(app)/empezar';

const mockPush = jest.fn();
const mockEnter = jest.fn(() => Promise.resolve());
const mockCreatePersonalSpace = jest.fn();
let mockInvitations: { id: string; orgName: string }[] = [];

jest.mock('expo-router', () => ({ router: { push: (p: string) => mockPush(p), replace: jest.fn() } }));
jest.mock('@/components/ghost/GhostViewer', () => ({ GhostViewer: () => null }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@ghostaff/shared/services', () => ({ createPersonalSpace: () => mockCreatePersonalSpace() }));
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => ({ enter: mockEnter, organizations: [] }) }));
jest.mock('@/lib/auth/AuthContext', () => ({ useAuth: () => ({ signOut: jest.fn(), session: null }) }));
jest.mock('@/lib/hooks/useInvitations', () => ({ useMyInvitations: () => ({ items: mockInvitations }) }));

beforeEach(() => {
  jest.clearAllMocks();
  mockInvitations = [];
});

describe('Empezar: what Ghostaff is for', () => {
  it('waits for a choice before going on', async () => {
    await render(<Start />);
    expect(screen.getByRole('button', { name: 'Seguir' })).toBeDisabled();
  });

  it('creates your personal space and opens it', async () => {
    mockCreatePersonalSpace.mockResolvedValue({ id: 'p1', slug: 'personal', name: 'Personal', kind: 'personal' });
    await render(<Start />);
    await fireEvent.press(screen.getByRole('button', { name: /Para mí/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Seguir' }));
    await waitFor(() => expect(mockEnter).toHaveBeenCalledWith('p1'));
    expect(mockCreatePersonalSpace).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('goes on to name the company', async () => {
    await render(<Start />);
    await fireEvent.press(screen.getByRole('button', { name: /Para mi empresa/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Seguir' }));
    expect(mockPush).toHaveBeenCalledWith('/crear-empresa');
    expect(mockCreatePersonalSpace).not.toHaveBeenCalled();
  });

  it('puts an invitation waiting for you first, and opens it', async () => {
    mockInvitations = [{ id: 'i1', orgName: 'Órdago' }];
    await render(<Start />);
    await fireEvent.press(screen.getByRole('button', { name: /Te han invitado a Órdago/ }));
    expect(mockPush).toHaveBeenCalledWith('/unirme');
  });

  it('says so in Spanish when you have too many spaces', async () => {
    mockCreatePersonalSpace.mockRejectedValue(Object.assign(new Error('too many organisations'), { code: '54000' }));
    await render(<Start />);
    await fireEvent.press(screen.getByRole('button', { name: /Para mí/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Seguir' }));
    expect(await screen.findByText('Ya tienes demasiados espacios.')).toBeOnTheScreen();
  });
});
