import { describe, expect, it } from 'vitest';
import { PHOTO_VIEW, PHOTO_WRITE, photoLines, photoTools } from '../src/photo';
import type { PhotoRow, RecordRepo } from '../src/recordSync';

// A chat agent's photo tools (docs/plans/ongoing/agent-photo.md, PR 2).

const GOOD = 'actualizado: 2026-11-28T09:00:00Z\nbloques:\n  - { tipo: cifra, titulo: Activos, valor: 1284 }\n';

function repo(files: Record<string, string> = {}, opts: { moves?: number } = {}) {
  const commits: Array<{ message: string; files: Array<{ path: string; content: string | null }> }> = [];
  let moves = opts.moves ?? 0;
  const r = {
    async head() {
      return { branch: 'main', sha: `head${commits.length}` };
    },
    async file(path: string) {
      return files[path] ?? null;
    },
    async commit(_head: unknown, changed: Array<{ path: string; content: string | null }>, message: string) {
      if (moves-- > 0) return false;
      commits.push({ message, files: changed });
      for (const f of changed) if (f.content !== null) files[f.path] = f.content;
      return true;
    },
  } as unknown as RecordRepo;
  return { r, commits };
}

function deps() {
  const set: PhotoRow[] = [];
  return { set, d: { setPhoto: async (p: PhotoRow) => void set.push(p), memberName: async () => 'Ana', now: () => new Date('2026-11-28T10:00:00Z') } };
}

const ctx = { orgId: 'org-1', agentId: 'a-cuentas', agentName: 'Cuentas', slug: 'cuentas', userId: 'u-ana' };

describe('photoTools', () => {
  it('reads the photo, or says there is none yet', async () => {
    const empty = photoTools(deps().d, repo().r, ctx);
    expect((await empty.run(PHOTO_VIEW, {})).content).toContain('Aún no tienes foto');
    const kept = photoTools(deps().d, repo({ 'agentes/cuentas/foto.yaml': GOOD }).r, ctx);
    expect((await kept.run(PHOTO_VIEW, {})).content).toContain('titulo: Activos');
  });

  it('commits a good photo signed for whom it works, and shows it at once', async () => {
    const { r, commits } = repo();
    const { d, set } = deps();
    const out = await photoTools(d, r, ctx).run(PHOTO_WRITE, { yaml: GOOD });
    expect(out).toEqual({ content: 'Guardada: 1 bloque. Ya se ve en tu ficha.', isError: false });
    expect(commits).toEqual([{ message: 'foto: agentes/cuentas/foto.yaml (Cuentas (por Ana))', files: [{ path: 'agentes/cuentas/foto.yaml', content: GOOD }] }]);
    expect(set[0]).toMatchObject({ orgId: 'org-1', agentId: 'a-cuentas', skipped: [], updatedAt: '2026-11-28T09:00:00.000Z' });
    expect(set[0]!.blocks).toHaveLength(1);
  });

  it('saves nothing when a block is wrong, and says which and why', async () => {
    const { r, commits } = repo();
    const { d, set } = deps();
    const out = await photoTools(d, r, ctx).run(PHOTO_WRITE, { yaml: `${GOOD}  - { tipo: grafico3d }\n` });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/el bloque 2: tipo «grafico3d» no existe/);
    expect(commits).toEqual([]);
    expect(set).toEqual([]);
  });

  it('refuses a file it cannot read, or one with no blocks', async () => {
    const t = photoTools(deps().d, repo().r, ctx);
    expect((await t.run(PHOTO_WRITE, { yaml: 'bloques: [' })).content).toMatch(/YAML/);
    expect((await t.run(PHOTO_WRITE, { yaml: 'bloques: []' })).content).toMatch(/ningún bloque/);
    expect((await t.run(PHOTO_WRITE, {})).content).toMatch(/Falta `yaml`/);
  });

  it('tries once more when the record moved meanwhile', async () => {
    const { r, commits } = repo({}, { moves: 1 });
    expect((await photoTools(deps().d, r, ctx).run(PHOTO_WRITE, { yaml: GOOD })).isError).toBe(false);
    expect(commits).toHaveLength(1);
  });

  it('changes nothing outside Ghostaff, so asks for no approval', () => {
    const t = photoTools(deps().d, repo().r, ctx);
    expect(t.writes(PHOTO_WRITE)).toBe(false);
    expect(t.specs.map((s) => s.name)).toEqual([PHOTO_VIEW, PHOTO_WRITE]);
  });

  it('tells the agent the format, never to invent a figure, and to propose a photo before making one', () => {
    const lines = photoLines().join('\n');
    expect(lines).toContain(PHOTO_WRITE);
    expect(lines).toContain('Nunca inventes una cifra');
    expect(lines).toContain('no la crees por tu cuenta');
  });
});
