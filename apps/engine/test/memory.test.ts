import { describe, expect, it } from 'vitest';
import { memoryPath, memoryTitle } from '@ghostaff/shared';
import { gitBlobSha, type MemoryDeps, type MemoryFile, type MemoryStore, memoryTools, projectMemory } from '../src/memory';
import type { RecordChange, RecordRepo } from '../src/recordSync';

const ORG = '10000000-0000-0000-0000-000000000001';
const ANA = '00000000-0000-0000-0000-00000000000a';

/** A record in memory: files by full path, a head that moves with each commit. */
function fakeRepo(files: Record<string, string> = {}) {
  const state = { files: { ...files }, head: 1, commits: [] as Array<{ message: string; files: RecordChange[] }>, moveOnce: false };
  const repo: RecordRepo = {
    async head() {
      return { branch: 'main', sha: `h${state.head}` };
    },
    async files() {
      return [];
    },
    async file(path) {
      return state.files[path] ?? null;
    },
    async tree(dir) {
      return Object.keys(state.files)
        .filter((p) => p.startsWith(`${dir}/`))
        .map((p) => ({ path: p.slice(dir.length + 1), sha: gitBlobSha(state.files[p]!) }));
    },
    async blob(sha) {
      const hit = Object.values(state.files).find((c) => gitBlobSha(c) === sha);
      if (hit === undefined) throw new Error(`no blob ${sha}`);
      return hit;
    },
    async commit(head, changed, message) {
      if (state.moveOnce) {
        state.moveOnce = false;
        state.head++;
        return false;
      }
      if (head.sha !== `h${state.head}`) return false;
      for (const f of changed) {
        if (f.content === null) delete state.files[f.path];
        else state.files[f.path] = f.content;
      }
      state.commits.push({ message, files: changed });
      state.head++;
      return true;
    },
  };
  return { repo, state };
}

/** The projection in memory. */
function fakeStore(rows: MemoryFile[] = []): MemoryStore & { rows: Map<string, MemoryFile> } {
  const byPath = new Map(rows.map((r) => [r.path, r]));
  return {
    rows: byPath,
    async memoryIndex() {
      return [...byPath.values()].map((r) => ({ path: r.path, sha: r.sha, updatedAt: r.updatedAt }));
    },
    async memory(_org, path) {
      return byPath.get(path) ?? null;
    },
    async searchMemory(_org, words) {
      return [...byPath.values()].filter((r) => words.every((w) => `${r.path}\n${r.content}`.toLowerCase().includes(w.toLowerCase())));
    },
    async saveMemory(_org, files) {
      for (const f of files) byPath.set(f.path, { ...f, updatedAt: '2026-11-26T10:00:00Z' });
    },
    async forgetMemory(_org, paths) {
      for (const p of paths) byPath.delete(p);
    },
  };
}

const row = (path: string, content: string, updatedBy: string | null = null): MemoryFile => ({ path, content, sha: gitBlobSha(content), updatedAt: '2026-11-20T09:00:00Z', updatedBy });

function tools(opts: { canWrite: boolean; store?: ReturnType<typeof fakeStore>; repo?: ReturnType<typeof fakeRepo> }) {
  const store = opts.store ?? fakeStore();
  const r = opts.repo ?? fakeRepo();
  const deps: MemoryDeps = { store, repoFor: async () => r.repo, memberName: async () => 'Ana' };
  return { t: memoryTools(deps, r.repo, { orgId: ORG, agentName: opts.canWrite ? 'Secretaría' : 'Finanzas', canWrite: opts.canWrite, userId: ANA }), store, r };
}

describe('memory paths (packages/shared/src/memory.ts)', () => {
  it('keeps a file inside the store, whichever way it is written', () => {
    expect(memoryPath('proveedores/gestoria.md')).toBe('proveedores/gestoria.md');
    expect(memoryPath('/memoria/proveedores/gestoria.md')).toBe('proveedores/gestoria.md');
    expect(memoryPath('memoria/empresa/a.md')).toBe('a.md');
    for (const bad of ['../fuera.md', 'a/../../b.md', '.git/config.md', 'a/.oculto.md', 'notas.txt', '', 'a//b.md']) expect(memoryPath(bad), bad).toBeNull();
  });

  it('names a file for a person', () => {
    expect(memoryTitle('facturas/2026-10-acme.md')).toBe('Facturas › 2026 10 acme');
  });
});

describe('projectMemory', () => {
  it('brings in new and changed files, forgets the ones gone, leaves the unchanged alone', async () => {
    const { repo } = fakeRepo({
      'memoria/empresa/proveedores/gestoria.md': 'Gestoría López\n',
      'memoria/empresa/clientes/acme.md': 'Acme, desde 2025\n',
      'memoria/empresa/.gitkeep': '',
      'por-decidir/a.yaml': 'x',
    });
    const store = fakeStore([
      row('proveedores/gestoria.md', 'Gestoría López\n', 'Secretaría (por Ana)'),
      row('clientes/acme.md', 'Acme\n'),
      row('viejo.md', 'ya no está\n'),
    ]);
    const notes = await projectMemory(store, repo, ORG, 'h1');
    expect([...store.rows.keys()].sort()).toEqual(['clientes/acme.md', 'proveedores/gestoria.md']);
    expect(store.rows.get('clientes/acme.md')?.content).toBe('Acme, desde 2025\n');
    expect(store.rows.get('proveedores/gestoria.md')?.updatedBy).toBe('Secretaría (por Ana)');
    expect(notes).toEqual(['memory: 1 from the record, 1 gone']);
  });

  it('leaves out a file over the limit, and says so', async () => {
    const { repo } = fakeRepo({ 'memoria/empresa/largo.md': 'x'.repeat(10241) });
    const store = fakeStore([row('largo.md', 'corto\n')]);
    const notes = await projectMemory(store, repo, ORG, 'h1');
    expect(store.rows.size).toBe(0);
    expect(notes[0]).toContain('largo.md over 10240 characters');
  });
});

describe('memoryTools', () => {
  it('reads for every agent and writes only for Secretaría', async () => {
    const reader = tools({ canWrite: false }).t;
    expect(reader.specs.map((s) => s.name)).toEqual(['memory_view', 'memory_search']);
    const refused = await reader.run('memory_create', { path: 'a.md', content: 'x' });
    expect(refused).toEqual({ content: expect.stringContaining('Solo Secretaría'), isError: true });
    const keeper = tools({ canWrite: true }).t;
    expect(keeper.specs.map((s) => s.name)).toEqual(['memory_view', 'memory_search', 'memory_create', 'memory_str_replace']);
    // No approval card: nothing outside Ghostaff changes.
    expect(keeper.writes('memory_create', {})).toBe(false);
  });

  it('lists a folder and reads a file, with its link', async () => {
    const store = fakeStore([row('proveedores/gestoria.md', 'Gestoría López\n', 'Secretaría (por Ana)'), row('proveedores/luz.md', 'Iberdrola\n'), row('clientes/acme.md', 'Acme\n')]);
    const { t } = tools({ canWrite: false, store });
    const root = await t.run('memory_view', {});
    expect(root.content).toContain('- clientes/ (1)');
    expect(root.content).toContain('- proveedores/ (2)');
    const file = await t.run('memory_view', { path: '/memoria/proveedores/gestoria.md' });
    expect(file.content).toContain('enlace: /memoria/proveedores/gestoria.md');
    expect(file.content).toContain('por Secretaría (por Ana)');
    expect(file.content).toContain('Gestoría López');
    expect((await t.run('memory_view', { path: '../secreto' })).isError).toBe(true);
  });

  it('searches with every word and shows the matching lines', async () => {
    const store = fakeStore([row('facturas/2026-10-acme.md', '# Acme\nFactura de octubre: 1.200 €\nPagada el 5\n'), row('clientes/acme.md', 'Acme, cliente\n')]);
    const { t } = tools({ canWrite: false, store });
    const out = await t.run('memory_search', { query: '¿factura octubre?' });
    expect(out.content).toContain('facturas/2026-10-acme.md');
    expect(out.content).toContain('> Factura de octubre: 1.200 €');
    expect(out.content).not.toContain('clientes/acme.md');
    expect((await t.run('memory_search', { query: 'x' })).isError).toBe(true);
  });

  it('files a new note as one commit signed by who asked, then the projection', async () => {
    const { t, store, r } = tools({ canWrite: true });
    const out = await t.run('memory_create', { path: 'proveedores/gestoria.md', content: 'Gestoría López. Nos lo dijo Ana el 26 nov.' });
    expect(out).toEqual({ content: expect.stringContaining('[proveedores/gestoria.md](/memoria/proveedores/gestoria.md)'), isError: false });
    expect(r.state.commits).toHaveLength(1);
    expect(r.state.commits[0]!.message).toBe('memoria: nuevo proveedores/gestoria.md (Secretaría (por Ana))');
    expect(r.state.files['memoria/empresa/proveedores/gestoria.md']).toBe('Gestoría López. Nos lo dijo Ana el 26 nov.\n');
    const saved = store.rows.get('proveedores/gestoria.md');
    expect(saved?.sha).toBe(gitBlobSha('Gestoría López. Nos lo dijo Ana el 26 nov.\n'));
    expect(saved?.updatedBy).toBe('Secretaría (por Ana)');
    // A second create of the same topic is sent to str_replace.
    const again = await t.run('memory_create', { path: 'proveedores/gestoria.md', content: 'otra' });
    expect(again).toEqual({ content: expect.stringContaining('ya existe'), isError: true });
  });

  it('replaces text that appears once, on the record’s own copy, and tries again when the record moved', async () => {
    const r = fakeRepo({ 'memoria/empresa/clientes/acme.md': 'Acme\nContacto: Luis\n' });
    r.state.moveOnce = true;
    const { t } = tools({ canWrite: true, repo: r });
    const out = await t.run('memory_str_replace', { path: 'clientes/acme.md', old_str: 'Contacto: Luis\n', new_str: 'Contacto: Luis\nPaga a 30 días\n' });
    expect(out.isError).toBe(false);
    expect(r.state.files['memoria/empresa/clientes/acme.md']).toBe('Acme\nContacto: Luis\nPaga a 30 días\n');
    expect((await t.run('memory_str_replace', { path: 'clientes/acme.md', old_str: 'no está', new_str: 'x' })).content).toContain('no está en');
    expect((await t.run('memory_str_replace', { path: 'clientes/nadie.md', old_str: 'a', new_str: 'b' })).content).toContain('créalo con memory_create');
  });

  it('refuses a path outside the store, a file too long and a full store', async () => {
    const { t } = tools({ canWrite: true });
    expect((await t.run('memory_create', { path: '../AGENTS.md', content: 'x' })).isError).toBe(true);
    expect((await t.run('memory_create', { path: 'a.md', content: 'x'.repeat(10241) })).content).toContain('máximo');
    const full = fakeStore(Array.from({ length: 1000 }, (_, i) => row(`n/${i}.md`, `${i}\n`)));
    expect((await tools({ canWrite: true, store: full }).t.run('memory_create', { path: 'otro.md', content: 'x' })).content).toContain('1000 ficheros');
  });

  it('says it could not save when the record fails, and never that it saved', async () => {
    const r = fakeRepo();
    r.repo.head = async () => {
      throw new Error('Forgejo 502');
    };
    const out = await tools({ canWrite: true, repo: r }).t.run('memory_create', { path: 'a.md', content: 'x' });
    expect(out).toEqual({ content: expect.stringContaining('No he podido'), isError: true });
  });
});
