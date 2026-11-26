import { describe, expect, it } from 'vitest';
import { memoryPath, memoryTitle } from '@ghostaff/shared';
import { COMPANY_STORE, gitBlobSha, type MemoryDeps, type MemoryFile, type MemoryPlace, type MemoryStore, memoryTools, OWN_MEMORY_BUDGET, ownMemoryLines, projectMemory } from '../src/memory';
import type { RecordChange, RecordRepo } from '../src/recordSync';

const ORG = '10000000-0000-0000-0000-000000000001';
const ANA = '00000000-0000-0000-0000-00000000000a';
const FINANZAS = '30000000-0000-0000-0000-000000000001';
const LEGAL = '30000000-0000-0000-0000-000000000002';
const own: MemoryPlace = { agentId: FINANZAS, slug: 'finanzas' };

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

/** The projection in memory, one map per store. */
function fakeStore(rows: MemoryFile[] = [], agents: Record<string, MemoryFile[]> = {}) {
  const maps = new Map<string | null, Map<string, MemoryFile>>();
  const of = (p: MemoryPlace) => {
    if (!maps.has(p.agentId)) maps.set(p.agentId, new Map());
    return maps.get(p.agentId)!;
  };
  for (const r of rows) of(COMPANY_STORE).set(r.path, r);
  for (const [agentId, files] of Object.entries(agents)) for (const r of files) of({ agentId, slug: '' }).set(r.path, r);
  const store: MemoryStore = {
    async memoryIndex(_org, place) {
      return [...of(place).values()].map((r) => ({ path: r.path, sha: r.sha, updatedAt: r.updatedAt }));
    },
    async memory(_org, place, path) {
      return of(place).get(path) ?? null;
    },
    async latestMemory(_org, place, max) {
      return [...of(place).values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.path.localeCompare(b.path)).slice(0, max);
    },
    async searchMemory(_org, place, words) {
      return [...of(place).values()].filter((r) => words.every((w) => `${r.path}\n${r.content}`.toLowerCase().includes(w.toLowerCase())));
    },
    async saveMemory(_org, place, files) {
      for (const f of files) of(place).set(f.path, { ...f, updatedAt: '2026-11-26T10:00:00Z' });
    },
    async forgetMemory(_org, place, paths) {
      for (const p of paths) of(place).delete(p);
    },
  };
  return Object.assign(store, { rows: of(COMPANY_STORE), place: of });
}

const row = (path: string, content: string, updatedBy: string | null = null): MemoryFile => ({ path, content, sha: gitBlobSha(content), updatedAt: '2026-11-20T09:00:00Z', updatedBy });

function tools(opts: { canWrite: boolean; store?: ReturnType<typeof fakeStore>; repo?: ReturnType<typeof fakeRepo>; own?: MemoryPlace }) {
  const store = opts.store ?? fakeStore();
  const r = opts.repo ?? fakeRepo();
  const deps: MemoryDeps = { store, repoFor: async () => r.repo, memberName: async () => 'Ana' };
  const ctx = { orgId: ORG, agentName: opts.canWrite ? 'Secretaría' : 'Finanzas', canWrite: opts.canWrite, userId: ANA, own: opts.own ?? null };
  return { t: memoryTools(deps, r.repo, ctx), store, r };
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

describe("each agent's own memory (agent-context.md PR 2)", () => {
  it('projects each agent\'s folder beside Empresa, and ignores a folder of no agent', async () => {
    const { repo } = fakeRepo({
      'memoria/empresa/a.md': 'A\n',
      'memoria/agentes/finanzas/como-trabajo.md': 'Informe en tres líneas\n',
      'memoria/agentes/nadie/x.md': 'de nadie\n',
    });
    const store = fakeStore([], { [LEGAL]: [row('viejo.md', 'ya no está\n')] });
    const notes = await projectMemory(store, repo, ORG, 'h1', [
      { id: FINANZAS, slug: 'finanzas' },
      { id: LEGAL, slug: 'legal' },
      { id: 'sin-slug', slug: null },
    ]);
    expect([...store.rows.keys()]).toEqual(['a.md']);
    expect([...store.place(own).keys()]).toEqual(['como-trabajo.md']);
    expect(store.place({ agentId: LEGAL, slug: 'legal' }).size).toBe(0);
    expect(notes).toEqual(['memory: 1 from the record, 0 gone', 'memory finanzas: 1 from the record, 0 gone', 'memory legal: 0 from the record, 1 gone']);
  });

  it('lets every agent write its own store, as one commit signed by who asked', async () => {
    const { t, store, r } = tools({ canWrite: false, own });
    expect(t.specs.map((s) => s.name)).toEqual(['memory_view', 'memory_search', 'memory_create', 'memory_str_replace']);
    const out = await t.run('memory_create', { store: 'propia', path: 'como-trabajo.md', content: 'Ana quiere el informe en tres líneas.' });
    expect(out).toEqual({ content: expect.stringContaining(`[como-trabajo.md](/agente/${FINANZAS}/memoria/como-trabajo.md)`), isError: false });
    expect(out.content).toContain('tu memoria');
    expect(r.state.commits[0]!.message).toBe('memoria: nuevo agentes/finanzas/como-trabajo.md (Finanzas (por Ana))');
    expect(r.state.files['memoria/agentes/finanzas/como-trabajo.md']).toBe('Ana quiere el informe en tres líneas.\n');
    expect(store.place(own).get('como-trabajo.md')?.updatedBy).toBe('Finanzas (por Ana)');
    expect(store.rows.size).toBe(0);
    // Its own store is where an agent that isn't Secretaría writes, said or not.
    expect((await t.run('memory_create', { path: 'otro.md', content: 'x' })).isError).toBe(false);
    expect(r.state.files['memoria/agentes/finanzas/otro.md']).toBe('x\n');
  });

  it('still keeps Empresa for Secretaría', async () => {
    const reader = tools({ canWrite: false, own });
    expect(await reader.t.run('memory_create', { store: 'empresa', path: 'a.md', content: 'x' })).toEqual({ content: expect.stringContaining('Solo Secretaría'), isError: true });
    const keeper = tools({ canWrite: true, own: { agentId: 'secretaria-id', slug: 'secretaria' } });
    await keeper.t.run('memory_create', { path: 'a.md', content: 'x' });
    await keeper.t.run('memory_create', { store: 'propia', path: 'b.md', content: 'y' });
    expect(Object.keys(keeper.r.state.files).sort()).toEqual(['memoria/agentes/secretaria/b.md', 'memoria/empresa/a.md']);
  });

  it('reads and searches its own store when asked to, and Empresa otherwise', async () => {
    const store = fakeStore([row('clientes/acme.md', 'Acme\n')], { [FINANZAS]: [row('como-trabajo.md', 'Informe en tres líneas\n')] });
    const { t } = tools({ canWrite: false, own, store });
    expect((await t.run('memory_view', {})).content).toContain('clientes/');
    const mine = await t.run('memory_view', { store: 'propia' });
    expect(mine.content).toContain('Tu memoria');
    expect(mine.content).toContain('como-trabajo.md');
    const file = await t.run('memory_view', { store: 'propia', path: 'memoria/agentes/finanzas/como-trabajo.md' });
    expect(file.content).toContain(`/agente/${FINANZAS}/memoria/como-trabajo.md`);
    expect((await t.run('memory_search', { store: 'propia', query: 'informe' })).content).toContain('como-trabajo.md');
    expect((await t.run('memory_search', { query: 'informe' })).content).toContain('Nada');
  });

  it('has no own store without a slug', async () => {
    const { t } = tools({ canWrite: false });
    expect(t.specs.map((s) => s.name)).toEqual(['memory_view', 'memory_search']);
    expect((await t.run('memory_view', { store: 'propia' })).isError).toBe(true);
  });

  it('is in the prompt whole while it fits, and as an index past the budget', () => {
    const files = [row('a.md', 'Primera línea de a\nmás\n'), row('b.md', 'Primera de b\n')];
    const whole = ownMemoryLines(own, files, false).join('\n');
    expect(whole).toContain('memoria/agentes/finanzas/');
    expect(whole).toContain('<fichero ruta="a.md">\nPrimera línea de a\nmás\n</fichero>');
    expect(whole).toContain('<fichero ruta="b.md">');
    const big = [row('grande.md', 'x'.repeat(OWN_MEMORY_BUDGET)), row('b.md', 'Primera de b\nsegunda\n')];
    const index = ownMemoryLines(own, big, true).join('\n');
    expect(index).toContain('<fichero ruta="grande.md">');
    expect(index).toContain('- b.md: Primera de b');
    expect(index).not.toContain('segunda');
    expect(index).toContain('memory_view');
    expect(ownMemoryLines(own, [], false).join('\n')).toContain('vacía');
    expect(ownMemoryLines(own, null, false).join('\n')).toContain('No has podido leer');
  });
});
