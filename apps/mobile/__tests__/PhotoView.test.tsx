import type { AgentPhoto, PhotoBlock } from '@ghostaff/shared';
import { render, screen } from '@testing-library/react-native';
import { formatNumber, PhotoView, photoRows } from '@/components/photo/PhotoView';

const goal: PhotoBlock = {
  kind: 'goal',
  title: 'Vuelven a la semana siguiente',
  unit: '%',
  base: 22,
  from: '2026-09-01',
  target: 40,
  by: '2027-03-31',
  points: [
    ['2026-09-01', 22],
    ['2026-11-24', 24],
  ],
};
const figure = (title: string, value: number, change: number | null = null): PhotoBlock => ({ kind: 'figure', title, value, unit: null, change, period: 'semana' });

const photo = (blocks: PhotoBlock[], extra: Partial<AgentPhoto> = {}): AgentPhoto => ({
  agentId: 'a',
  blocks,
  skipped: [],
  updatedAt: '2026-11-27T08:12:00Z',
  error: null,
  ...extra,
});

describe('PhotoView', () => {
  it('draws each block with the app’s own pieces', async () => {
    await render(
      <PhotoView
        agentName="Producto"
        photo={photo([
          goal,
          figure('Jugadores activos', 1284, 0.06),
          figure('Partidas', 3910, -0.02),
          { kind: 'series', title: 'Altas', unit: null, shape: 'bars', points: [['2026-11-03', 3], ['2026-11-10', 5]] },
          { kind: 'headlines', did: 'Cuadró noviembre.', found: null, changes: 'Reclama cada mes.' },
          { kind: 'list', title: 'Esta semana', items: [{ title: 'Reel', detail: 'Mañana', state: 'waiting' }] },
        ])}
      />,
    );
    expect(screen.getByText('Vuelven a la semana siguiente')).toBeOnTheScreen();
    expect(screen.getByText('Por debajo del camino')).toBeOnTheScreen();
    expect(screen.getByText('1284')).toBeOnTheScreen();
    expect(screen.getByText(/↑ 6 % semana/)).toBeOnTheScreen();
    expect(screen.getByText(/↓ 2 % semana/)).toBeOnTheScreen();
    expect(screen.getByText('Altas')).toBeOnTheScreen();
    expect(screen.getByText('Cuadró noviembre.')).toBeOnTheScreen();
    expect(screen.queryByText('Encontró')).toBeNull();
    expect(screen.getByText('Te espera')).toBeOnTheScreen();
  });

  it('draws whatever the agent writes as plain text', async () => {
    await render(<PhotoView agentName="X" photo={photo([figure('<b>hola</b>', 1)])} />);
    expect(screen.getByText('<b>hola</b>')).toBeOnTheScreen();
  });

  it('says when blocks could not be drawn, and when its last file could not be read', async () => {
    await render(<PhotoView agentName="Producto" photo={photo([figure('A', 1)], { skipped: [{ index: 1, reason: 'x' }], error: 'no es YAML válido' })} />);
    expect(screen.getByText(/Un bloque no se puede dibujar/)).toBeOnTheScreen();
    expect(screen.getByText(/no es YAML válido/)).toBeOnTheScreen();
  });
});

describe('photoRows', () => {
  it('puts figures two to a row and every other block on its own', () => {
    const rows = photoRows([figure('a', 1), figure('b', 2), figure('c', 3), goal]);
    expect(rows.map((r) => (r.kind === 'figures' ? r.figures.length : r.block.kind))).toEqual([2, 1, 'goal']);
  });
});

describe('formatNumber', () => {
  it('writes numbers the Spanish way', () => {
    expect(formatNumber(31.5)).toBe('31,5');
    expect(formatNumber(12840.4)).toBe('12.840');
    expect(formatNumber(2.5)).toBe('2,5');
  });
});
