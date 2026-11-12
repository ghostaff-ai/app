import { describe, expect, it } from 'vitest';
import {
  appendHistoryRow,
  fromMadridMinute,
  historyRow,
  madridMinute,
  readDecision,
  recordIdFromPath,
  writeAnswer,
} from '../src/record';
import { sortInbox } from '../src/services';
import type { Decision } from '../src/models';

const FILE = `area: seo          # la pestaña
tipo: titulo-web
pregunta: ¿Cambio el título del glosario?
contexto: |
  La cifra y de dónde sale.
propone: seo
creada: 2026-11-07
`;

const RULE = `area: direccion
tipo: regla
pregunta: ¿Firmas esta regla?
contexto: Sale de una nota.
propone: direccion
creada: 2026-11-10
propuesta: Los títulos hablan como quien busca dónde jugar.
origen: tablon/2026-11-10-nota.md
`;

describe('readDecision', () => {
  it('reads an open decision', () => {
    const d = readDecision('seo-glosario', FILE);
    expect(d).toEqual({
      id: 'seo-glosario',
      area: 'seo',
      tipo: 'titulo-web',
      pregunta: '¿Cambio el título del glosario?',
      contexto: 'La cifra y de dónde sale.',
      propone: 'seo',
      creada: '2026-11-07',
    });
  });

  it('reads an answer the panel wrote', () => {
    const yaml = `${FILE}respuesta:\n  decision: ok\n  por: Jaime\n  fecha: 2026-11-09 09:57\n  nota: hecho\n`;
    expect(readDecision('seo-glosario', yaml).respuesta).toEqual({ decision: 'ok', por: 'Jaime', fecha: '2026-11-09 09:57', nota: 'hecho' });
  });

  it('accepts any organisation’s areas, not only Órdago’s', () => {
    expect(readDecision('x', FILE.replace('area: seo', 'area: convocatorias')).area).toBe('convocatorias');
  });

  it('rejects a file without a question', () => {
    expect(() => readDecision('x', FILE.replace(/pregunta:.*\n/, ''))).toThrow(/pregunta/);
  });

  it('rejects an id that could leave the folder', () => {
    expect(() => readDecision('../x', FILE)).toThrow();
  });

  it('reads a rule with its proposal', () => {
    expect(readDecision('direccion-regla-x', RULE).regla).toEqual({
      propuesta: 'Los títulos hablan como quien busca dónde jugar.',
      origen: 'tablon/2026-11-10-nota.md',
    });
  });
});

describe('writeAnswer', () => {
  it('adds the answer and keeps comments', () => {
    const out = writeAnswer(FILE, 'seo-glosario', { decision: 'no', por: 'Álvaro', fecha: '2026-11-12 10:00', nota: ' mejor no ' });
    expect(out).toContain('# la pestaña');
    expect(readDecision('seo-glosario', out).respuesta).toEqual({ decision: 'no', por: 'Álvaro', fecha: '2026-11-12 10:00', nota: 'mejor no' });
  });

  it('never overwrites an answer', () => {
    const once = writeAnswer(FILE, 'x', { decision: 'ok', por: 'A', fecha: '2026-11-12 10:00' });
    expect(() => writeAnswer(once, 'x', { decision: 'no', por: 'B', fecha: '2026-11-12 10:01' })).toThrow(/already/);
  });

  it('signs a rule only with its text', () => {
    expect(() => writeAnswer(RULE, 'r', { decision: 'ok', por: 'A', fecha: '2026-11-12 10:00' })).toThrow(/signed/);
    expect(() => writeAnswer(FILE, 'x', { decision: 'ok', por: 'A', fecha: '2026-11-12 10:00', texto: 't' })).toThrow(/rule/);
    const out = writeAnswer(RULE, 'r', { decision: 'ok', por: 'A', fecha: '2026-11-12 10:00', texto: 'Texto firmado.' });
    expect(readDecision('r', out).respuesta?.texto).toBe('Texto firmado.');
  });
});

describe('history', () => {
  it('appends a row with the days the decision waited', () => {
    const d = readDecision('seo-glosario', FILE);
    const row = historyRow(d, { decision: 'ok', por: 'A', fecha: '2026-11-09 09:57', nota: 'sí, con nota' });
    expect(appendHistoryRow(null, row)).toBe(
      'fecha,agente,tipo,decision,con_nota,dias,id\n2026-11-09 09:57,seo,titulo-web,ok,si,2,seo-glosario\n',
    );
  });

  it('refuses a file with another header', () => {
    const row = historyRow(readDecision('x', FILE), { decision: 'no', por: 'A', fecha: '2026-11-09 09:57' });
    expect(() => appendHistoryRow('otra,cabecera\n', row)).toThrow(/header/);
  });
});

describe('paths and dates', () => {
  it('turns a decision path into its id and skips the README', () => {
    expect(recordIdFromPath('por-decidir/seo-envites.yaml')).toBe('seo-envites');
    expect(recordIdFromPath('por-decidir/README.md')).toBeNull();
  });

  it('round-trips Madrid minutes in winter and summer', () => {
    for (const iso of ['2026-11-12T09:15:00.000Z', '2026-07-01T20:45:00.000Z']) {
      expect(fromMadridMinute(madridMinute(new Date(iso)))).toBe(iso);
    }
    expect(madridMinute(new Date('2026-11-12T09:15:00Z'))).toBe('2026-11-12 10:15');
  });
});

describe('sortInbox', () => {
  const base = { orgId: 'o', sourcePath: '', area: 'a', kind: 'k', question: '', context: '', proposedBy: 'p', ruleProposal: null, closedAt: null };
  it('puts what waits for you first, newest first', () => {
    const ds: Decision[] = [
      { ...base, id: '1', recordId: '1', createdOn: '2026-11-10', answer: null },
      { ...base, id: '2', recordId: '2', createdOn: '2026-11-11', answer: { answer: 'ok', byName: 'A', at: '', note: null, signedText: null, source: 'app', writtenBackAt: null } },
      { ...base, id: '3', recordId: '3', createdOn: '2026-11-09', answer: null },
    ];
    expect(sortInbox(ds).map((d) => d.id)).toEqual(['1', '3', '2']);
  });
});
