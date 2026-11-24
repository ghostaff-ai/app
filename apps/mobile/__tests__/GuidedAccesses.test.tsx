import type { Agent, Connection, PendingGuide } from '@ghostaff/shared';
import { EngineError } from '@ghostaff/shared/services';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import Connections from '@/app/(app)/(tabs)/empresa/conexiones';

// «Accesos de tus agentes» in Conexiones: every member sees them, only an owner
// removes, and removing first shows how to remove the user in the app itself.

let mockRole: 'owner' | 'member';
let mockItems: Connection[];
let mockAgentsLoading = false;
let mockAgents: Agent[] = [];
const mockReload = jest.fn();
const mockGet = jest.fn();
const mockRemove = jest.fn();
const mockPending = jest.fn();
const mockApprove = jest.fn();
const mockReject = jest.fn();
const mockPush = jest.fn();
const mockEngine = { url: 'http://engine', token: 't' };

jest.mock('@/lib/tabs', () => ({ useTabScreenTop: () => 0 }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => ({ active: { id: 'o1', role: mockRole } }) }));
jest.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ items: mockItems, reload: mockReload }),
  useAiUsage: () => ({ rows: [], reload: jest.fn() }),
  useEngine: () => mockEngine,
}));
jest.mock('@/lib/hooks/useAgents', () => ({ useAgents: () => ({ items: mockAgents, loading: mockAgentsLoading }) }));
jest.mock('@ghostaff/shared/services', () => ({
  ...jest.requireActual('@ghostaff/shared/services'),
  getGuidedAccessUndo: (...a: unknown[]) => mockGet(...a),
  removeGuidedAccess: (...a: unknown[]) => mockRemove(...a),
  pendingGuides: (...a: unknown[]) => mockPending(...a),
  approveGuide: (...a: unknown[]) => mockApprove(...a),
  rejectGuide: (...a: unknown[]) => mockReject(...a),
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

/** A press, with the engine calls it starts settled inside the same act. */
const press = (name: string) =>
  act(async () => {
    await fireEvent.press(screen.getByRole('button', { name }));
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'owner';
  mockItems = [guided];
  mockAgentsLoading = false;
  mockAgents = [{ id: 'a1', name: 'Redes' } as Agent];
  mockGet.mockResolvedValue({ app: 'WordPress', undo: UNDO });
  mockRemove.mockResolvedValue(undefined);
  mockPending.mockResolvedValue([]);
  mockApprove.mockResolvedValue({ status: 'done', resumed: true });
  mockReject.mockResolvedValue({ status: 'rejected' });
});

describe('Accesos de tus agentes', () => {
  it('lists the access with its app, its agent and its hint', async () => {
    await render(<Connections />);
    expect(screen.getByText('Accesos de tus agentes')).toBeOnTheScreen();
    expect(screen.getByText('WordPress')).toBeOnTheScreen();
    expect(screen.getByText('Redes · redes@panaderia.ghostaff.ai')).toBeOnTheScreen();
  });

  it('names no agent while the agents load, instead of calling a live one gone', async () => {
    mockAgentsLoading = true;
    mockAgents = [];
    await render(<Connections />);
    expect(screen.getByText('redes@panaderia.ghostaff.ai')).toBeOnTheScreen();
    expect(screen.queryByText(/Un agente que ya no está/)).toBeNull();
  });

  it('says the agent is gone only once the agents are loaded and it is not among them', async () => {
    mockAgents = [];
    await render(<Connections />);
    expect(screen.getByText('Un agente que ya no está · redes@panaderia.ghostaff.ai')).toBeOnTheScreen();
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
    await press('Quitar');
    expect(await screen.findByText(UNDO)).toBeOnTheScreen();
    expect(mockGet).toHaveBeenCalledWith(mockEngine, 'c1');
    expect(mockRemove).not.toHaveBeenCalled();
    await press('Quitar acceso');
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith(mockEngine, 'c1'));
    await waitFor(() => expect(mockReload).toHaveBeenCalled());
  });

  it('cancelling removes nothing', async () => {
    await render(<Connections />);
    await press('Quitar');
    await screen.findByText(UNDO);
    await press('Cancelar');
    await waitFor(() => expect(screen.queryByText(UNDO)).toBeNull());
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('says so next to the row when the undo text cannot be loaded, and offers nothing to remove', async () => {
    mockGet.mockRejectedValue(new EngineError('failed', 500, 'x'));
    await render(<Connections />);
    await press('Quitar');
    expect(await screen.findByText('No hemos podido cargar cómo quitarlo. Prueba otra vez.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Quitar acceso' })).toBeNull();
  });

  it('keeps the confirmation and says what happened when the removal fails', async () => {
    mockRemove.mockRejectedValue(new EngineError('failed', 500, 'x'));
    await render(<Connections />);
    await press('Quitar');
    await screen.findByText(UNDO);
    await press('Quitar acceso');
    expect(await screen.findByText(/No hemos podido quitar el acceso/)).toBeOnTheScreen();
    expect(screen.getByText(UNDO)).toBeOnTheScreen();
    expect(mockReload).not.toHaveBeenCalled();
  });

  it('still asks to remove the user in the app when the guide never wrote how', async () => {
    mockGet.mockResolvedValue({ app: 'WordPress', undo: null });
    await render(<Connections />);
    await press('Quitar');
    expect(await screen.findByText(/quítalo también allí/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Quitar acceso' })).toBeOnTheScreen();
  });
});


// Final review (R19 a): an owner approves a member's guide here, whatever conversation it was done in.

describe('Pendientes de aprobar', () => {
  const luis: PendingGuide = { id: 'g1', app: 'WordPress', agentId: 'a1', agentName: 'Redes', completedByName: 'Luis', checkedAt: new Date().toISOString() };

  /** Renders the screen with the pending guides read. */
  const open = async () => {
    await render(<Connections />);
    await act(async () => {});
  };

  it('lists an owner the guides waiting for them: the app, the agent, who did it and when', async () => {
    mockPending.mockResolvedValue([luis]);
    await open();
    expect(screen.getByText('Pendientes de aprobar')).toBeOnTheScreen();
    expect(mockPending).toHaveBeenCalledWith(mockEngine, 'o1');
    expect(screen.getByText('Redes · hecho por Luis hoy')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeOnTheScreen();
  });

  it('a row opens the guide, to read it before deciding', async () => {
    mockPending.mockResolvedValue([luis]);
    await open();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('pending-g1-open'));
    });
    expect(mockPush).toHaveBeenCalledWith('/guia/g1');
  });

  it('approving waits for the engine, then reads the list and the connections again', async () => {
    mockPending.mockResolvedValueOnce([luis]).mockResolvedValue([]);
    await open();
    await press('Aprobar');
    expect(mockApprove).toHaveBeenCalledWith(mockEngine, 'g1');
    await waitFor(() => expect(screen.queryByText('Pendientes de aprobar')).toBeNull());
    expect(mockReload).toHaveBeenCalled();
  });

  it('rejecting does the same with a rejection', async () => {
    mockPending.mockResolvedValueOnce([luis]).mockResolvedValue([]);
    await open();
    await press('Rechazar');
    expect(mockReject).toHaveBeenCalledWith(mockEngine, 'g1');
    await waitFor(() => expect(screen.queryByText('Pendientes de aprobar')).toBeNull());
  });

  it('a decision that fails says why next to its row and keeps it', async () => {
    mockPending.mockResolvedValue([luis]);
    mockApprove.mockRejectedValue(new EngineError('already_decided', 409, 'x'));
    await open();
    await press('Aprobar');
    expect(await screen.findByText('Ya lo ha decidido otra persona.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Aprobar' })).toBeOnTheScreen();
  });

  it('a member sees no such section, and it is never asked for', async () => {
    mockRole = 'member';
    mockPending.mockResolvedValue([luis]);
    await open();
    expect(screen.queryByText('Pendientes de aprobar')).toBeNull();
    expect(mockPending).not.toHaveBeenCalled();
  });

  it('is hidden when nothing waits', async () => {
    await open();
    expect(screen.queryByText('Pendientes de aprobar')).toBeNull();
  });

  it('when the list cannot be read, says so and reads it again on «Reintentar»', async () => {
    mockPending.mockRejectedValueOnce(new EngineError('failed', 500, 'x')).mockResolvedValue([luis]);
    await open();
    expect(screen.getByText('No hemos podido cargar lo pendiente de aprobar.')).toBeOnTheScreen();
    await press('Reintentar');
    expect(await screen.findByText('Redes · hecho por Luis hoy')).toBeOnTheScreen();
  });
});
