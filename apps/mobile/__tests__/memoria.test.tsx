import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import MemoriaDeLaEmpresa from '@/app/(app)/(tabs)/empresa/memoria';
import Recuerdo from '@/app/(app)/memoria/[...path]';

let mockPath: string | string[] = ['proveedores', 'gestoria.md'];
const mockList = jest.fn();
const mockRead = jest.fn();

jest.mock('@/lib/tabs', () => ({ useTabScreenTop: () => 0 }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() }, useFocusEffect: jest.fn(), useLocalSearchParams: () => ({ path: mockPath }) }));
jest.mock('@/lib/org/ActiveOrgContext', () => ({ useActiveOrg: () => ({ active: { id: 'org-1' } }) }));
jest.mock('@ghostaff/shared/services', () => ({
  listMemories: (...a: unknown[]) => mockList(...a),
  readMemory: (...a: unknown[]) => mockRead(...a),
}));

beforeEach(() => {
  mockList.mockReset();
  mockRead.mockReset();
  (router.push as jest.Mock).mockReset();
  mockPath = ['proveedores', 'gestoria.md'];
});

describe('Memoria de la empresa', () => {
  it('lists what was filed, the latest first, and opens a file', async () => {
    mockList.mockResolvedValue([
      { path: 'facturas/2026-10-acme.md', updatedAt: '2026-11-26T09:00:00Z', updatedBy: 'Secretaría (por Ana)' },
      { path: 'proveedores/gestoria.md', updatedAt: '2026-11-20T09:00:00Z', updatedBy: null },
    ]);
    await render(<MemoriaDeLaEmpresa />);
    expect(await screen.findByText('Facturas › 2026 10 acme')).toBeOnTheScreen();
    expect(screen.getByText('26 nov 2026 · Secretaría (por Ana)')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Proveedores › Gestoria'));
    expect(router.push).toHaveBeenCalledWith('/memoria/proveedores/gestoria.md');
  });

  it('says what to do when nothing is filed yet', async () => {
    mockList.mockResolvedValue([]);
    await render(<MemoriaDeLaEmpresa />);
    expect(await screen.findByText('Aún no hay nada guardado')).toBeOnTheScreen();
  });

  it('says it could not load, with a retry', async () => {
    mockList.mockRejectedValue(new Error('sin red'));
    await render(<MemoriaDeLaEmpresa />);
    expect(await screen.findByText('No hemos podido cargar la memoria')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeOnTheScreen();
  });
});

describe('a file of the memory', () => {
  it('shows its text, when it changed and who changed it', async () => {
    mockRead.mockResolvedValue({ path: 'proveedores/gestoria.md', content: 'Trabajamos con **Gestoría López**.', updatedAt: '2026-11-26T09:00:00Z', updatedBy: 'Secretaría (por Ana)' });
    await render(<Recuerdo />);
    expect(await screen.findByText('Proveedores › Gestoria')).toBeOnTheScreen();
    expect(screen.getByText('Gestoría López')).toBeOnTheScreen();
    expect(screen.getByText('Proveedores · 26 nov 2026 · Secretaría (por Ana)')).toBeOnTheScreen();
  });

  it('lets a note that opens with a heading be its own title', async () => {
    mockRead.mockResolvedValue({ path: 'facturas/2026-10-acme.md', content: '# Factura de Acme, octubre\n\n1.200 €', updatedAt: '2026-11-26T09:00:00Z', updatedBy: null });
    await render(<Recuerdo />);
    expect(await screen.findByText('Factura de Acme, octubre')).toBeOnTheScreen();
    expect(screen.queryByText('Facturas › 2026 10 acme')).toBeNull();
    expect(screen.getByText('Facturas · 26 nov 2026')).toBeOnTheScreen();
    expect(mockRead).toHaveBeenCalledWith({}, 'org-1', 'proveedores/gestoria.md');
  });

  it('says when it is no longer there', async () => {
    mockRead.mockResolvedValue(null);
    await render(<Recuerdo />);
    expect(await screen.findByText('Ya no está en la memoria')).toBeOnTheScreen();
  });

  it('never reads a path outside the memory', async () => {
    mockPath = ['..', 'secreto.md'];
    await render(<Recuerdo />);
    expect(await screen.findByText('Este enlace no lleva a la memoria')).toBeOnTheScreen();
    expect(mockRead).not.toHaveBeenCalled();
  });
});
