import { render, screen } from '@testing-library/react-native';
import AjustesDelAgente from '@/app/(app)/agente/[id]/ajustes';

// An agent's settings, behind the gear on top of its page.

let mockRole: 'owner' | 'member' = 'owner';
let mockLevel: 'talk' | 'read' = 'talk';
const agent = { id: 'a1', orgId: 'o1', name: 'Cuentas', ghost: 'finanzas', department: 'finanzas', runner: 'chat', isMain: false };

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), dismissTo: jest.fn() },
  Stack: { Screen: () => null },
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ id: 'a1' }),
}));
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => ({ active: { id: 'o1', role: mockRole } }) }));
jest.mock('@/lib/hooks/useChat', () => ({ useMyLevels: () => ({ levels: { a1: mockLevel }, reload: jest.fn() }) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@ghostaff/shared/services', () => ({ getAgent: jest.fn(async () => agent), deleteAgent: jest.fn() }));

describe('an agent’s settings', () => {
  it('gives an owner everything: routines, memory, who may, tools and removing it', async () => {
    mockRole = 'owner';
    mockLevel = 'talk';
    await render(<AjustesDelAgente />);
    expect(await screen.findByText('Tareas programadas')).toBeOnTheScreen();
    expect(screen.getByText('Memoria')).toBeOnTheScreen();
    expect(screen.getByText('Quién puede')).toBeOnTheScreen();
    expect(screen.getByText('Herramientas')).toBeOnTheScreen();
    expect(screen.getByText('Quitar del equipo')).toBeOnTheScreen();
  });

  it('gives someone who may only read it its memory, and says what they may do', async () => {
    mockRole = 'member';
    mockLevel = 'read';
    await render(<AjustesDelAgente />);
    expect(await screen.findByText('Memoria')).toBeOnTheScreen();
    expect(screen.queryByText('Tareas programadas')).toBeNull();
    expect(screen.queryByText('Quién puede')).toBeNull();
    expect(screen.getByText('Puedes ver a Cuentas.')).toBeOnTheScreen();
  });
});
