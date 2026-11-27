import { describe, expect, it } from 'vitest';
import { type PhotoRow, projectPhotos, type RecordRepo, type RecordSyncStore } from '../src/recordSync';

// Each agent's photo from its record into `agent_photos` (docs/plans/ongoing/agent-photo.md).

const NOW = new Date('2026-11-27T10:00:00Z');
const GOOD = 'actualizado: 2026-11-27T09:00:00Z\nbloques:\n  - { tipo: cifra, titulo: Activos, valor: 1284 }\n  - { tipo: grafico3d }\n';

/** A record of files by path, each file's blob sha its content's own name. */
function repo(files: Record<string, string>, opts: { treeFails?: boolean } = {}): RecordRepo & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async tree(dir: string) {
      if (opts.treeFails) throw new Error('tree agentes (too many files)');
      return Object.entries(files)
        .filter(([p]) => p.startsWith(`${dir}/`))
        .map(([p, c]) => ({ path: p.slice(dir.length + 1), sha: `sha-${c.length}-${p}` }));
    },
    async file(path: string) {
      reads.push(path);
      return files[path] ?? null;
    },
  } as unknown as RecordRepo & { reads: string[] };
}

function store(known: Record<string, string> = {}) {
  const set: PhotoRow[] = [];
  const failed: Array<[string, string]> = [];
  const removed: string[] = [];
  const s = {
    instructedAgents: async () => [
      { id: 'a-prod', slug: 'producto', task: null, taskInRecord: false },
      { id: 'a-seo', slug: 'seo', task: null, taskInRecord: false },
    ],
    photoShas: async () => new Map(Object.entries(known)),
    setPhoto: async (p: PhotoRow) => void set.push(p),
    failPhoto: async (_o: string, agentId: string, _sha: string, why: string) => void failed.push([agentId, why]),
    removePhoto: async (agentId: string) => void removed.push(agentId),
  } as unknown as RecordSyncStore;
  return { s, set, failed, removed };
}

describe('projectPhotos', () => {
  it('reads an agent’s photo into its row, the blocks it can draw and the ones it skipped', async () => {
    const db = store();
    const notes = await projectPhotos(db.s, repo({ 'agentes/producto/foto.yaml': GOOD, 'agentes/producto/AGENTS.md': '# x' }), 'org-1', 'head1', NOW);
    expect(db.set).toHaveLength(1);
    expect(db.set[0]).toMatchObject({ orgId: 'org-1', agentId: 'a-prod', updatedAt: '2026-11-27T09:00:00.000Z' });
    expect(db.set[0]!.blocks).toEqual([{ kind: 'figure', title: 'Activos', value: 1284, unit: null, change: null, period: null }]);
    expect(db.set[0]!.skipped).toHaveLength(1);
    expect(notes).toEqual(['producto: photo, 1 blocks, 1 skipped']);
  });

  it('reads a file again only when its blob changed', async () => {
    const files = { 'agentes/producto/foto.yaml': GOOD };
    const r = repo(files);
    const sha = (await r.tree('agentes', 'head1'))[0]!.sha;
    const db = store({ 'a-prod': sha });
    expect(await projectPhotos(db.s, r, 'org-1', 'head1', NOW)).toEqual([]);
    expect(r.reads).toEqual([]);
  });

  it('keeps the last good photo when the file can’t be read, saying why', async () => {
    const db = store();
    const notes = await projectPhotos(db.s, repo({ 'agentes/producto/foto.yaml': 'bloques: [' }), 'org-1', 'head1', NOW);
    expect(db.set).toEqual([]);
    expect(db.failed[0]![0]).toBe('a-prod');
    expect(db.failed[0]![1]).toMatch(/YAML/);
    expect(notes[0]).toMatch(/^producto: photo not read/);
  });

  it('removes a photo whose file is gone, and leaves alone an agent that never had one', async () => {
    const db = store({ 'a-prod': 'old' });
    expect(await projectPhotos(db.s, repo({}), 'org-1', 'head1', NOW)).toEqual(['producto: photo gone']);
    expect(db.removed).toEqual(['a-prod']);
  });

  it('never fails the sync: a record it can’t list is one line of the summary', async () => {
    const db = store();
    expect(await projectPhotos(db.s, repo({}, { treeFails: true }), 'org-1', 'head1', NOW)).toEqual(['photos not read: tree agentes (too many files)']);
  });
});
