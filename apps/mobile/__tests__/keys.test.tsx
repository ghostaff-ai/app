import type { Agent, OrgSecret } from '@ghostaff/shared';
import { EngineError } from '@ghostaff/shared/services';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Connections from '@/app/(app)/(tabs)/empresa/conexiones';
import KeyScreen from '@/app/(app)/(tabs)/empresa/conexiones/clave';

// Conexiones › Claves (docs/plans/ongoing/secrets-from-the-app.md): the organisation's keys with the agents
// that use each, the ones an agent needs and nobody stored, and a key's page to add, replace, approve or
// remove it. The value goes to the engine once and is never shown again.

let mockRole: 'owner' | 'member';
let mockSecrets: OrgSecret[];
let mockAgents: Agent[];
let mockParams: { name?: string };
const mockReload = jest.fn();
const mockStore = jest.fn();
const mockReplace = jest.fn();
const mockDecide = jest.fn();
const mockRemove = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockSetParams = jest.fn();
const mockEngine = { url: 'http://engine', token: 't' };

jest.mock('@/lib/tabs', () => ({ useTabScreenTop: () => 0 }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/haptics', () => ({ success: jest.fn() }));
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    replace: (...a: unknown[]) => mockPush(...a),
    back: () => mockBack(),
    canGoBack: () => true,
    setParams: (p: unknown) => mockSetParams(p),
  },
  Link: ({ children }: { children: unknown }) => children,
  Stack: { Screen: () => null },
  usePathname: () => '/empresa/conexiones',
  useGlobalSearchParams: () => ({}),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => {
    const { useEffect } = require('react');
    useEffect(() => effect(), [effect]);
  },
}));
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => ({ active: { id: 'o1', role: mockRole } }) }));
jest.mock('@/lib/hooks/useConnections', () => ({
  useConnections: () => ({ items: [], reload: jest.fn() }),
  useAiUsage: () => ({ rows: [], reload: jest.fn() }),
  useEngine: () => mockEngine,
}));
jest.mock('@/lib/hooks/useOrgSecrets', () => ({ useOrgSecrets: () => ({ items: mockSecrets, loaded: true, reload: mockReload }) }));
jest.mock('@/lib/hooks/useAgents', () => ({ useAgents: () => ({ items: mockAgents, loading: false }) }));
jest.mock('@/lib/hooks/usePendingGuides', () => ({ usePendingGuides: () => ({ items: [], failed: false, reload: jest.fn(), decide: jest.fn() }) }));
jest.mock('@ghostaff/shared/services', () => ({
  ...jest.requireActual('@ghostaff/shared/services'),
  storeOrgSecret: (...a: unknown[]) => mockStore(...a),
  replaceOrgSecret: (...a: unknown[]) => mockReplace(...a),
  decideOrgSecret: (...a: unknown[]) => mockDecide(...a),
  removeOrgSecret: (...a: unknown[]) => mockRemove(...a),
  setAiOrder: jest.fn(),
}));

const VALUE = 'sk_eleven_aaaaaaaaaaaa1234';

const secret = (name: string, label: string, extra: Partial<OrgSecret> = {}): OrgSecret => ({
  id: `id-${name}`,
  orgId: 'o1',
  name,
  label,
  maker: null,
  storedByName: 'Jaime',
  storedAt: '2026-11-25T10:00:00Z',
  lastUsedAt: null,
  status: 'ok',
  pendingByName: null,
  pendingAt: null,
  ...extra,
});
const agent = (id: string, name: string, secrets: Record<string, string>) => ({ id, name, secrets }) as Agent;

const press = (name: string | RegExp) =>
  act(async () => {
    await fireEvent.press(screen.getByRole('button', { name }));
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockRole = 'owner';
  mockParams = {};
  mockSecrets = [
    secret('correo-gmail', 'Contraseña de Gmail'),
    secret('elevenlabs', 'Clave de ElevenLabs', { maker: 'elevenlabs', status: 'missing' }),
    secret('meta-token', 'Token de Meta', { pendingByName: 'Bea', pendingAt: '2026-11-27T09:00:00Z' }),
  ];
  mockAgents = [
    agent('a1', 'Correo', { CORREO_GMAIL_PASSWORD: 'correo-gmail', CORREO_INFO_PASSWORD: 'correo-info' }),
    agent('a2', 'Finanzas', { GMAIL_PASSWORD: 'correo-gmail' }),
    agent('a3', 'Productor', { ELEVENLABS_API_KEY: 'elevenlabs' }),
  ];
  mockStore.mockResolvedValue(secret('nueva', 'Nueva'));
  mockReplace.mockResolvedValue(secret('elevenlabs', 'Clave de ElevenLabs'));
  mockDecide.mockResolvedValue(undefined);
  mockRemove.mockResolvedValue(undefined);
});

describe('Claves in Conexiones', () => {
  it('lists each key with the agents that use it', async () => {
    await render(<Connections />);
    expect(screen.getByText('Claves')).toBeOnTheScreen();
    expect(screen.getByText('Contraseña de Gmail')).toBeOnTheScreen();
    expect(screen.getByText('Correo y Finanzas')).toBeOnTheScreen();
    expect(screen.getByText('Productor')).toBeOnTheScreen();
    expect(screen.getByText('Ningún agente la usa')).toBeOnTheScreen();
  });

  it('marks one waiting for an owner, one a run did not find, and one an agent needs that nobody stored', async () => {
    await render(<Connections />);
    expect(screen.getByText('Por aprobar')).toBeOnTheScreen();
    expect(screen.getByText('Revisar')).toBeOnTheScreen();
    expect(screen.getByText('Correo info')).toBeOnTheScreen();
    expect(screen.getByText('Falta')).toBeOnTheScreen();
  });

  it('opens a key, and «Añadir clave» opens an empty one', async () => {
    await render(<Connections />);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('key-correo-info'));
    });
    expect(mockPush).toHaveBeenLastCalledWith('/empresa/conexiones/clave?name=correo-info');
    await press('Añadir clave');
    expect(mockPush).toHaveBeenLastCalledWith('/empresa/conexiones/clave');
  });
});

describe('adding a key', () => {
  it('an owner names it and pastes the value, which goes to the engine and leaves the screen', async () => {
    await render(<KeyScreen />);
    await fireEvent.changeText(screen.getByLabelText('Nombre'), 'Clave de ElevenLabs');
    await fireEvent.changeText(screen.getByLabelText('Clave o contraseña'), VALUE);
    await press('Guardar');
    expect(mockStore).toHaveBeenCalledWith(mockEngine, { orgId: 'o1', label: 'Clave de ElevenLabs', value: VALUE });
    expect(screen.queryByDisplayValue(VALUE)).toBeNull();
    expect(mockSetParams).toHaveBeenCalledWith({ name: 'nueva' });
  });

  it('a key an agent needs keeps the name the agent asks for, and says who needs it', async () => {
    mockParams = { name: 'correo-info' };
    await render(<KeyScreen />);
    expect(screen.getByText('La necesita Correo para trabajar.')).toBeOnTheScreen();
    expect(screen.getByDisplayValue('Correo info')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Clave o contraseña'), VALUE);
    await press('Guardar');
    expect(mockStore).toHaveBeenCalledWith(mockEngine, { orgId: 'o1', label: 'Correo info', value: VALUE, name: 'correo-info' });
  });

  it('a member is told it waits for an owner', async () => {
    mockRole = 'member';
    await render(<KeyScreen />);
    expect(screen.getByText(/Un propietario tiene que aprobarla/)).toBeOnTheScreen();
  });

  it('says why the engine refused, next to the form', async () => {
    mockStore.mockRejectedValue(new EngineError('value_too_short', 400, 'short'));
    await render(<KeyScreen />);
    await fireEvent.changeText(screen.getByLabelText('Nombre'), 'Algo');
    await fireEvent.changeText(screen.getByLabelText('Clave o contraseña'), 'abcdefgh');
    await press('Guardar');
    expect(screen.getByText('Es demasiado corta: tiene que tener al menos 8 caracteres.')).toBeOnTheScreen();
  });
});

describe("a key's page", () => {
  it('says who uses it and who stored it, and never shows the value', async () => {
    mockParams = { name: 'correo-gmail' };
    await render(<KeyScreen />);
    expect(screen.getByText('Contraseña de Gmail')).toBeOnTheScreen();
    expect(screen.getByText('Correo y Finanzas')).toBeOnTheScreen();
    expect(screen.getByText(/Jaime/)).toBeOnTheScreen();
  });

  it('an owner replaces the value', async () => {
    mockParams = { name: 'elevenlabs' };
    await render(<KeyScreen />);
    expect(screen.getByText(/no la encontró/)).toBeOnTheScreen();
    await press('Cambiar la clave');
    await fireEvent.changeText(screen.getByLabelText('Clave o contraseña'), VALUE);
    await press('Guardar');
    expect(mockReplace).toHaveBeenCalledWith(mockEngine, 'o1', 'elevenlabs', VALUE);
    expect(mockReload).toHaveBeenCalled();
  });

  it('removing asks first, naming the agents that will lose it', async () => {
    mockParams = { name: 'correo-gmail' };
    await render(<KeyScreen />);
    await press('Quitar clave');
    expect(mockRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Correo y Finanzas dejarán de tenerla en su próximo trabajo.')).toBeOnTheScreen();
    await press('Quitar');
    expect(mockRemove).toHaveBeenCalledWith(mockEngine, 'o1', 'correo-gmail');
    expect(mockBack).toHaveBeenCalled();
  });

  it("an owner approves a member's value", async () => {
    mockParams = { name: 'meta-token' };
    await render(<KeyScreen />);
    expect(screen.getByText(/Bea guardó un valor nuevo/)).toBeOnTheScreen();
    await press('Aprobar');
    expect(mockDecide).toHaveBeenCalledWith(mockEngine, 'o1', 'meta-token', 'approve');
  });

  it('a member may propose a new value but not approve nor remove', async () => {
    mockRole = 'member';
    mockParams = { name: 'meta-token' };
    await render(<KeyScreen />);
    expect(screen.queryByRole('button', { name: 'Aprobar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quitar clave' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cambiar la clave' })).toBeOnTheScreen();
    expect(screen.getByText(/espera a que un propietario/)).toBeOnTheScreen();
  });
});
