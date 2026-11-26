import { describe, expect, it } from 'vitest';
import {
  type ExternalFile,
  type ExternalSyncRow,
  externalSlug,
  freeExternalPath,
  isExternalFile,
  planExternalSync,
  readExternal,
  writeExternal,
} from '../src/record/externos';

const ANA = `---
tipo: persona
nombre: Ana López
hace: Hace las ilustraciones de los carteles
departamentos: [marketing]
email: ana@ejemplo.com
web: https://analopez.es
alta:
  por: Jaime Rubio
  fecha: 2026-11-26 10:30
  propone: Marketing
---

Cobra por encargo; factura a 30 días.
`;

describe('a party file (external-parties.md, «The file»)', () => {
  it('reads the front matter into the database\'s words', () => {
    expect(readExternal(ANA)).toEqual({
      kind: 'person',
      name: 'Ana López',
      role: 'Hace las ilustraciones de los carteles',
      departments: ['marketing'],
      email: 'ana@ejemplo.com',
      phone: null,
      website: 'https://analopez.es',
      addedByName: 'Jaime Rubio',
      addedAt: '2026-11-26T09:30:00.000Z',
      proposedByName: 'Marketing',
    });
  });

  it('writes the same file back, keeping the body byte for byte', () => {
    expect(writeExternal(readExternal(ANA), ANA)).toBe(ANA);
  });

  it('changes only the front matter', () => {
    const changed = writeExternal({ ...readExternal(ANA), role: 'Ilustra y maqueta', departments: ['marketing', 'producto'], email: null }, ANA);
    expect(changed).toContain('hace: Ilustra y maqueta\n');
    expect(changed).toContain('departamentos: [marketing, producto]\n');
    expect(changed).not.toContain('email:');
    expect(changed.endsWith('\nCobra por encargo; factura a 30 días.\n')).toBe(true);
  });

  it('writes a new one with no body, and reads what Órdago might write by hand', () => {
    const p = { ...readExternal(ANA), proposedByName: null, website: null };
    expect(readExternal(writeExternal(p))).toEqual(p);
    expect(readExternal('---\ntipo: servicio\nnombre: bunq\nhace: El banco\n---\n')).toMatchObject({ kind: 'service', departments: [], addedByName: '', addedAt: null });
  });

  it('says why it cannot read one', () => {
    expect(() => readExternal('# Nacho\n')).toThrow('no front matter');
    expect(() => readExternal('---\ntipo: amigo\nnombre: X\nhace: Y\n---\n')).toThrow('tipo');
    expect(() => readExternal('---\ntipo: persona\nnombre: X\n---\n')).toThrow('hace is required');
    expect(() => readExternal('---\ntipo: persona\nnombre: X\nhace: Y\ndepartamentos: [ventas]\n---\n')).toThrow('departamentos');
  });

  it('names files from names, never taking one', () => {
    expect(externalSlug('Gestoría López, S.L.')).toBe('gestoria-lopez-s-l');
    expect(externalSlug('¡!')).toBe('externo');
    expect(freeExternalPath('Ana', new Set(['externos/ana.md', 'externos/ana-2.md']))).toBe('externos/ana-3.md');
    expect(isExternalFile('ana.md')).toBe(true);
    expect(isExternalFile('.gitkeep')).toBe(false);
  });
});

describe('the sync of externos/ (external-parties.md, «The sync, both ways»)', () => {
  const now = new Date('2026-11-27T08:00:00Z');
  const file = (path: string, content: string, hash = `h-${path}`): ExternalFile => ({ path, content, hash });
  const row = (over: Partial<ExternalSyncRow>): ExternalSyncRow => ({
    id: 'r1',
    path: 'externos/ana-lopez.md',
    kind: 'person',
    name: 'Ana López',
    role: 'Hace las ilustraciones de los carteles',
    departments: ['marketing'],
    email: 'ana@ejemplo.com',
    phone: null,
    website: 'https://analopez.es',
    added_by_name: 'Jaime Rubio',
    added_at: '2026-11-26T09:30:00.000Z',
    proposed_by_name: 'Marketing',
    content_hash: 'h-externos/ana-lopez.md',
    pending: null,
    updated_at: '2026-11-26T09:30:00.000Z',
    ...over,
  });
  const plan = (files: ExternalFile[], rows: ExternalSyncRow[]) => planExternalSync({ orgId: 'o', files, rows, now });

  it('brings a new file in, and leaves an unchanged one alone', () => {
    const p = plan([file('externos/ana-lopez.md', ANA), file('externos/bunq.md', '---\ntipo: servicio\nnombre: bunq\nhace: El banco\n---\n')], [row({})]);
    expect(p.upserts).toHaveLength(1);
    expect(p.upserts[0]).toMatchObject({ path: 'externos/bunq.md', kind: 'service', pending: null, content_hash: 'h-externos/bunq.md', added_at: now.toISOString() });
    expect(p.writes).toEqual([]);
  });

  it('takes a file changed in the record', () => {
    const p = plan([file('externos/ana-lopez.md', ANA, 'new')], [row({})]);
    expect(p.upserts).toHaveLength(1);
    expect(p.upserts[0]).toMatchObject({ path: 'externos/ana-lopez.md', content_hash: 'new' });
  });

  it('drops a row whose file is gone, and keeps one whose file cannot be read', () => {
    expect(plan([], [row({})]).deletes).toEqual(['r1']);
    const bad = plan([file('externos/ana-lopez.md', '# Ana\n')], [row({})]);
    expect(bad.deletes).toEqual([]);
    expect(bad.invalid).toEqual([{ path: 'externos/ana-lopez.md', error: 'no front matter' }]);
  });

  it('writes a new party at a free path', () => {
    const p = plan([file('externos/ana-lopez.md', ANA)], [row({}), row({ id: 'r2', path: null, name: 'Ana López', role: 'Fotos', pending: 'save' })]);
    expect(p.writes).toHaveLength(1);
    expect(p.writes[0]).toMatchObject({ rowId: 'r2', path: 'externos/ana-lopez-2.md' });
    expect(readExternal(p.writes[0]!.content!).role).toBe('Fotos');
  });

  it('writes an app change on top of the file it read, body kept', () => {
    const p = plan([file('externos/ana-lopez.md', ANA)], [row({ role: 'Ilustra y maqueta', pending: 'save', updated_at: 'u2' })]);
    expect(p.upserts).toEqual([]);
    expect(p.writes).toEqual([{ rowId: 'r1', path: 'externos/ana-lopez.md', content: expect.stringContaining('hace: Ilustra y maqueta'), updatedAt: 'u2' }]);
    expect(p.writes[0]!.content).toContain('Cobra por encargo');
  });

  it('deletes the file of a party removed in the app', () => {
    expect(plan([file('externos/ana-lopez.md', ANA)], [row({ pending: 'remove' })]).writes).toEqual([
      { rowId: 'r1', path: 'externos/ana-lopez.md', content: null, updatedAt: '2026-11-26T09:30:00.000Z' },
    ]);
  });

  it('lets the record win over an app change to a file that changed meanwhile', () => {
    const p = plan([file('externos/ana-lopez.md', ANA, 'someone-else')], [row({ role: 'Mía', pending: 'save' })]);
    expect(p.writes).toEqual([]);
    expect(p.upserts[0]).toMatchObject({ role: 'Hace las ilustraciones de los carteles', pending: null, content_hash: 'someone-else' });
    expect(p.conflicts).toEqual([{ path: 'externos/ana-lopez.md', name: 'Ana López' }]);
    const gone = plan([], [row({ pending: 'save' })]);
    expect(gone.deletes).toEqual(['r1']);
    expect(gone.conflicts).toHaveLength(1);
  });
});
