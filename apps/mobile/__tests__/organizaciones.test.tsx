import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Spaces from '@/app/(app)/organizaciones';

const mockPush = jest.fn();
const mockEnter = jest.fn(() => Promise.resolve());
const mockChoose = jest.fn();
const mockCreatePersonalSpace = jest.fn();
type Space = { id: string; slug: string; name: string; kind: 'personal' | 'company'; role: 'owner' | 'member'; displayName: string };
let mockSpaces: Space[] = [];
let mockActive: Space | null = null;

jest.mock('expo-router', () => ({
  router: { push: (p: string) => mockPush(p), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@ghostaff/shared/services', () => ({ createPersonalSpace: () => mockCreatePersonalSpace() }));
jest.mock('@/lib/org/ActiveOrgContext', () => ({
  useActiveOrg: () => ({ organizations: mockSpaces, active: mockActive, choose: mockChoose, enter: mockEnter }),
}));
jest.mock('@/lib/hooks/useDecisions', () => ({ useWaitingCounts: () => ({ c1: 2 }) }));

const personal: Space = { id: 'p1', slug: 'personal', name: 'Personal', kind: 'personal', role: 'owner', displayName: 'Jaime' };
const ordago: Space = { id: 'c1', slug: 'ordago', name: 'Órdago', kind: 'company', role: 'owner', displayName: 'Jaime' };
const factotum: Space = { id: 'c2', slug: 'factotum', name: 'Factotum', kind: 'company', role: 'member', displayName: 'Jaime' };

beforeEach(() => {
  jest.clearAllMocks();
  mockSpaces = [personal, factotum, ordago];
  mockActive = ordago;
});

describe('Tus espacios', () => {
  it('lists your spaces in order, with a close and the open one checked', async () => {
    await render(<Spaces />);
    expect(screen.getByRole('header', { name: 'Tus espacios' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeOnTheScreen();
    const rows = screen.getAllByTestId(/^space-/).map((r) => r.props.testID);
    expect(rows).toEqual(['space-p1', 'space-c2', 'space-c1']);
    expect(screen.getByLabelText(/Órdago, 2 te esperan, el que tienes abierto/)).toBeOnTheScreen();
  });

  it('switches with one tap', async () => {
    await render(<Spaces />);
    await fireEvent.press(screen.getByTestId('space-p1'));
    expect(mockChoose).toHaveBeenCalledWith('p1');
  });

  it('offers your personal space when you have none, and opens it once made', async () => {
    await render(<Spaces />);
    expect(screen.queryByRole('button', { name: 'Crear tu espacio personal' })).toBeNull();
    mockSpaces = [factotum, ordago];
    mockCreatePersonalSpace.mockResolvedValue({ id: 'p9', slug: 'personal', name: 'Personal', kind: 'personal' });
    await render(<Spaces />);
    await fireEvent.press(screen.getByRole('button', { name: 'Crear tu espacio personal' }));
    await waitFor(() => expect(mockEnter).toHaveBeenCalledWith('p9'));
  });

  it('keeps creating and joining a company', async () => {
    await render(<Spaces />);
    expect(screen.getByRole('button', { name: 'Crear una empresa' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Unirme a una empresa' })).toBeOnTheScreen();
  });
});
