import { GHOSTS, TEAM, ghostFor } from '@/lib/team';

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

describe('TEAM', () => {
  it('has every agent drawn, and each once', () => {
    const agents = TEAM.flatMap((d) => d.agents);
    expect(new Set(agents).size).toBe(agents.length);
    for (const a of agents) expect(GHOSTS[a]).toBeTruthy();
  });
});
