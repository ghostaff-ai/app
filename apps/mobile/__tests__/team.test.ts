import { AGENT_GHOSTS } from '@ghostaff/shared';
import { GHOSTS, GHOST_ORDER, ghostFor } from '@/lib/team';

describe('ghostFor', () => {
  it("draws Órdago's agents as the ghost of their job", () => {
    expect(ghostFor('correo')).toBe('secretaria');
    expect(ghostFor('direccion')).toBe('secretaria');
    expect(ghostFor('organico')).toBe('redes');
    expect(ghostFor('seo')).toBe('redes');
    expect(ghostFor('lamesa')).toBe('productor');
    expect(ghostFor(' Finanzas ')).toBe('finanzas');
  });

  it('draws any other agent as the plain ghost', () => {
    expect(ghostFor('legal')).toBe('base');
    expect(ghostFor('')).toBe('base');
  });
});

describe('GHOST_ORDER', () => {
  it('offers every ghost the database accepts, each once', () => {
    expect([...GHOST_ORDER].sort()).toEqual([...AGENT_GHOSTS].sort());
    for (const g of GHOST_ORDER) expect(GHOSTS[g]).toBeTruthy();
  });
});
