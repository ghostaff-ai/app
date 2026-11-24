import type { Agent, Connection } from '@ghostaff/shared';
import { EngineError } from '@ghostaff/shared/services';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Connections from '@/app/(app)/(tabs)/empresa/conexiones';

// «Accesos de tus agentes» in Conexiones: every member sees them, only an owner
// removes, and removing first shows how to remove the user in the app itself.

let mockRole: 'owner' | 'member';
let mockItems: Connection[];
const mockReload = jest.fn();
const mockGet = jest.fn();
const mockRemove = jest.fn();
const mockEngine = { url: 'http://engine', token: 't' };

jest.mock('@/lib/tabs', () => ({ useTabScreenTop: () => 0 }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => ({ active: { id: 'o1', role: mockRole } }) }));
jest.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ items: mockItems, reload: mockReload }),
  useAiUsage: () => ({ rows: [], reload: jest.fn() }),
  useEngine: () => mockEngine,
}));
jest.mock('@/lib/hooks/useAgents', () => ({ useAgents: () => ({ items: [{ id: 'a1', name: 'Redes' } as Agent] }) }));
jest.mock('@ghostaff/shared/services', () => ({
  ...jest.requireActual('@ghostaff/shared/services'),
  getGuidedAccessUndo: (...a: unknown[]) => mockGet(...a),
  removeGuidedAccess: (...a: unknown[]) => mockRemove(...a),
  setAiOrder: jest.fn(),
}));

const guided: Connection = {
  id: 'c1',
  orgId: 'o1',
  kind: 'guided',
  provider: 'xwordpress',
  method: 'api_key',
  hint: 'redes@panaderia.ghostaff.ai',
  settings: { app: 'WordPress' },
  status: 'ok',
  statusReason: null,
  checkedAt: '2026-11-24T10:00:00Z',
  connectedByName: 'Ana',
  updatedAt: '2026-11-24T10:00:00Z',
  position: 0,
  label: null,
  limits: {},
  lastUsedAt: null,
  agentId: 'a1',
};
const UNDO = 'Entra en Usuarios, busca redes y pulsa Borrar.';

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'owner';
  mockItems = [guided];
  mockGet.mockResolvedValue({ app: 'WordPress', undo: UNDO });
  mockRemove.mockResolvedValue(undefined);
});

describe('Accesos de tus agentes', () => {
  it('lists the access with its app, its agent and its hint', async () => {
    await render(<Connections />);
    expect(screen.getByText('Accesos de tus agentes')).toBeOnTheScreen();
    expect(screen.getByText('WordPress')).toBeOnTheScreen();
    expect(screen.getByText('Redes · redes@panaderia.ghostaff.ai')).toBeOnTheScreen();
  });

  it('is hidden when there are none', async () => {
    mockItems = [];
    await render(<Connections />);
    expect(screen.queryByText('Accesos de tus agentes')).toBeNull();
  });

  it('shows «Quitar» to an owner', async () => {
    await render(<Connections />);
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeOnTheScreen();
  });

  it('shows a member the access but no «Quitar»', async () => {
    mockRole = 'member';
    await render(<Connections />);
    expect(screen.getByText('WordPress')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Quitar' })).toBeNull();
  });

  it('shows the undo text first and removes only once confirmed', async () => {
    await render(<Connections />);
    fireEvent.press(screen.getByRole('button', { name: 'Quitar' }));
    expect(await screen.findByText(UNDO)).toBeOnTheScreen();
    expect(mockGet).toHaveBeenCalledWith(mockEngine, 'c1');
    expect(mockRemove).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole('button', { name: 'Quitar acceso' }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith(mockEngine, 'c1'));
    await waitFor(() => expect(mockReload).toHaveBeenCalled());
  });

  it('cancelling removes nothing', async () => {
    await render(<Connections />);
    fireEvent.press(screen.getByRole('button', { name: 'Quitar' }));
    await screen.findByText(UNDO);
    fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText(UNDO)).toBeNull());
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('says so next to the row when the undo text cannot be loaded, and offers nothing to remove', async () => {
    mockGet.mockRejectedValue(new EngineError('failed', 500, 'x'));
    await render(<Connections />);
    fireEvent.press(screen.getByRole('button', { name: 'Quitar' }));
    expect(await screen.findByText('No hemos podido cargar cómo quitarlo. Prueba otra vez.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Quitar acceso' })).toBeNull();
  });

  it('keeps the confirmation and says what happened when the removal fails', async () => {
    mockRemove.mockRejectedValue(new EngineError('failed', 500, 'x'));
    await render(<Connections />);
    fireEvent.press(screen.getByRole('button', { name: 'Quitar' }));
    await screen.findByText(UNDO);
    fireEvent.press(screen.getByRole('button', { name: 'Quitar acceso' }));
    expect(await screen.findByText(/No hemos podido quitar el acceso/)).toBeOnTheScreen();
    expect(screen.getByText(UNDO)).toBeOnTheScreen();
    expect(mockReload).not.toHaveBeenCalled();
  });

  it('still asks to remove the user in the app when the guide never wrote how', async () => {
    mockGet.mockResolvedValue({ app: 'WordPress', undo: null });
    await render(<Connections />);
    fireEvent.press(screen.getByRole('button', { name: 'Quitar' }));
    expect(await screen.findByText(/quítalo también allí/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Quitar acceso' })).toBeOnTheScreen();
  });
});
