import { describe, expect, it } from 'vitest';
import { type GoalBlock, goalPathAt, goalVerdict, PHOTO_LIMITS } from '../src/photo';
import { agentPhotoPath, photoGuide, readPhoto } from '../src/record/photo';

const FILE = `
actualizado: 2026-11-27T09:12:00+01:00
bloques:
  - tipo: meta
    titulo: Vuelven a la semana siguiente
    unidad: '%'
    base: 22
    desde: 2026-09-01
    objetivo: 40
    fecha: 2027-03-31
    serie: [[2026-09-01, 22], [2026-11-24, 31]]
  - tipo: cifra
    titulo: Jugadores activos
    valor: 1284
    cambio: 0.06
    periodo: semana
  - tipo: serie
    titulo: Partidas por semana
    forma: barras
    puntos: [[2026-11-03, 3720], [2026-11-10, 3990]]
  - tipo: titulares
    hizo: Cuadró 39 de 42 movimientos.
  - tipo: lista
    titulo: Esta semana
    elementos:
      - { titulo: 'Reel', detalle: 'Mañana', estado: espera }
      - { titulo: 'Carrusel', estado: hecho }
`;

describe('readPhoto', () => {
  it('reads every block type into the app’s words', () => {
    const p = readPhoto(FILE);
    expect(p.skipped).toEqual([]);
    expect(p.updatedAt).toBe('2026-11-27T08:12:00.000Z');
    expect(p.blocks.map((b) => b.kind)).toEqual(['goal', 'figure', 'series', 'headlines', 'list']);
    expect(p.blocks[0]).toEqual({
      kind: 'goal',
      title: 'Vuelven a la semana siguiente',
      unit: '%',
      base: 22,
      from: '2026-09-01',
      target: 40,
      by: '2027-03-31',
      points: [
        ['2026-09-01', 22],
        ['2026-11-24', 31],
      ],
    });
    expect(p.blocks[1]).toEqual({ kind: 'figure', title: 'Jugadores activos', value: 1284, unit: null, change: 0.06, period: 'semana' });
    expect(p.blocks[2]).toMatchObject({ kind: 'series', shape: 'bars', points: [['2026-11-03', 3720], ['2026-11-10', 3990]] });
    expect(p.blocks[3]).toEqual({ kind: 'headlines', did: 'Cuadró 39 de 42 movimientos.', found: null, changes: null });
    expect(p.blocks[4]).toEqual({
      kind: 'list',
      title: 'Esta semana',
      items: [
        { title: 'Reel', detail: 'Mañana', state: 'waiting' },
        { title: 'Carrusel', detail: null, state: 'done' },
      ],
    });
  });

  it('skips a type it does not draw, and a broken block, naming why, and keeps the rest', () => {
    const p = readPhoto(`
bloques:
  - { tipo: grafico3d, titulo: Algo }
  - { tipo: cifra, titulo: Sin valor }
  - { tipo: cifra, titulo: Bien, valor: 3 }
`);
    expect(p.blocks).toHaveLength(1);
    expect(p.skipped[0]).toMatchObject({ index: 0, reason: expect.stringContaining('grafico3d') });
    expect(p.skipped[1]).toMatchObject({ index: 1, reason: expect.stringContaining('valor') });
  });

  it('draws text as text: markup is never anything else', () => {
    const p = readPhoto('bloques:\n  - { tipo: cifra, titulo: "<script>x</script>", valor: 1 }\n');
    expect(p.blocks[0]).toMatchObject({ title: '<script>x</script>' });
  });

  it('keeps to the limits', () => {
    const many = Array.from({ length: PHOTO_LIMITS.blocks + 2 }, (_, i) => `  - { tipo: cifra, titulo: C${i}, valor: ${i} }`).join('\n');
    const p = readPhoto(`bloques:\n${many}\n`);
    expect(p.blocks).toHaveLength(PHOTO_LIMITS.blocks);
    expect(p.skipped).toHaveLength(2);
    expect(() => readPhoto(`bloques: []\n# ${'x'.repeat(PHOTO_LIMITS.fileBytes)}`)).toThrow(/KB/);
  });

  it('throws only when the whole file cannot be read', () => {
    expect(() => readPhoto('bloques: [')).toThrow(/YAML/);
    expect(() => readPhoto('- una lista')).toThrow(/mapa/);
    expect(() => readPhoto('actualizado: hoy')).toThrow(/bloques/);
  });

  it('takes a goal with only today’s value, for an agent with no history yet', () => {
    const p = readPhoto('bloques:\n  - { tipo: meta, titulo: Seguidores, valor: 4120, base: 3000, desde: 2026-10-01, objetivo: 5000, fecha: 2027-01-31 }\n');
    expect(p.blocks[0]).toMatchObject({ kind: 'goal', points: [[expect.any(String), 4120]] });
  });
});

describe('goalVerdict', () => {
  const g = (last: number, target = 40): GoalBlock => ({
    kind: 'goal',
    title: 'x',
    unit: null,
    base: 20,
    from: '2026-01-01',
    target,
    by: '2026-12-31',
    points: [['2026-07-02', last]],
  });

  it('reads where the goal stands against its straight path', () => {
    expect(goalPathAt(g(0), '2026-07-02')).toBeCloseTo(30, 0);
    expect(goalVerdict(g(30))).toBe('on');
    expect(goalVerdict(g(35))).toBe('ahead');
    expect(goalVerdict(g(25))).toBe('behind');
  });

  it('works for a goal that goes down', () => {
    expect(goalVerdict({ ...g(5, 0), base: 20 })).toBe('ahead');
    expect(goalVerdict({ ...g(15, 0), base: 20 })).toBe('behind');
  });
});

describe('the agent’s guide', () => {
  it('names its own file, forbids inventing figures, and asks for a proposal when it has none', () => {
    expect(agentPhotoPath('producto')).toBe('agentes/producto/foto.yaml');
    const g = photoGuide('producto');
    expect(g).toContain('agentes/producto/foto.yaml');
    expect(g).toContain('Nunca inventes una cifra');
    expect(g).toContain('propón');
  });
});
