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
import { countStreak, sortInbox } from '../src/services';
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
  const base = { orgId: 'o', sourcePath: '', area: 'a', kind: 'k', question: '', context: '', proposedBy: 'p', ruleProposal: null, closedAt: null,
    recommendation: null, ifYes: null, ifNo: null, quote: null, sources: [], dueOn: null, options: [], recommendedOption: null, highStakes: false, agent: null };
  it('puts what waits for you first, newest first', () => {
    const ds: Decision[] = [
      { ...base, id: '1', recordId: '1', createdOn: '2026-11-10', answer: null },
      { ...base, id: '2', recordId: '2', createdOn: '2026-11-11', answer: { answer: 'ok', byName: 'A', at: '', note: null, signedText: null, source: 'app', option: null, writtenBackAt: null } },
      { ...base, id: '3', recordId: '3', createdOn: '2026-11-09', answer: null },
    ];
    expect(sortInbox(ds).map((d) => d.id)).toEqual(['1', '3', '2']);
  });

  it('puts the nearest deadline first among what waits', () => {
    const ds: Decision[] = [
      { ...base, id: 'new', recordId: 'new', createdOn: '2026-11-12', answer: null },
      { ...base, id: 'late', recordId: 'late', createdOn: '2026-11-01', dueOn: '2026-11-20', answer: null },
      { ...base, id: 'soon', recordId: 'soon', createdOn: '2026-11-02', dueOn: '2026-11-18', answer: null },
    ];
    expect(sortInbox(ds).map((d) => d.id)).toEqual(['soon', 'late', 'new']);
  });
});

describe('countStreak', () => {
  it('counts OKs in a row until a no or a correcting note', () => {
    const ok = { answer: 'ok' as const, answer_note: null };
    expect(countStreak([ok, ok, { answer: 'ok', answer_note: 'mal el importe' }, ok])).toBe(2);
    expect(countStreak([{ answer: 'no', answer_note: null }, ok])).toBe(0);
    expect(countStreak([])).toBe(0);
  });
});

describe('readDecision, optional fields for the app', () => {
  const FULL = `${FILE}recomienda: Cambiarlo
con_si: Lo cambio hoy y lo mido a 14 días.
con_no: Se queda como está.
cita: «amarraco» tiene 1.900 búsquedas al mes
fuentes:
  - Search Console, 06/11
  - texto: Consultas
    enlace: seo/datos/consultas.yaml
vence: 2026-11-10
`;

  it('reads them', () => {
    const d = readDecision('seo-glosario', FULL);
    expect(d.recomienda).toBe('Cambiarlo');
    expect(d.con_si).toBe('Lo cambio hoy y lo mido a 14 días.');
    expect(d.con_no).toBe('Se queda como está.');
    expect(d.cita).toBe('«amarraco» tiene 1.900 búsquedas al mes');
    expect(d.fuentes).toEqual([{ texto: 'Search Console, 06/11' }, { texto: 'Consultas', enlace: 'seo/datos/consultas.yaml' }]);
    expect(d.vence).toBe('2026-11-10');
  });

  it('leaves them out when absent or empty', () => {
    const d = readDecision('seo-glosario', `${FILE}recomienda: ""\n`);
    expect(d).not.toHaveProperty('recomienda');
    expect(d).not.toHaveProperty('fuentes');
  });

  it('refuses a bad date or a source that is not text', () => {
    expect(() => readDecision('seo-glosario', `${FILE}vence: pronto\n`)).toThrow(/vence/);
    expect(() => readDecision('seo-glosario', `${FILE}fuentes:\n  - 3\n`)).toThrow(/fuentes\[0\]/);
  });

  it('keeps them when the answer is written back', () => {
    const out = writeAnswer(FULL, 'seo-glosario', { decision: 'ok', por: 'Álvaro', fecha: '2026-11-17 10:00' });
    expect(readDecision('seo-glosario', out).recomienda).toBe('Cambiarlo');
  });
});

describe('readDecision, options and stakes', () => {
  const OPTIONS = `${FILE}opciones:
  - id: lunes
    texto: El lunes a las 9:00
    con: El lunes tuvo el doble de visitas.
  - id: viernes
    texto: El viernes por la tarde
  - id: nada
    texto: No publicarlo
recomienda: lunes
importancia: alta
`;

  it('reads the options, the pick by id and the stakes', () => {
    const d = readDecision('seo-x', OPTIONS);
    expect(d.opciones).toEqual([
      { id: 'lunes', texto: 'El lunes a las 9:00', con: 'El lunes tuvo el doble de visitas.' },
      { id: 'viernes', texto: 'El viernes por la tarde' },
      { id: 'nada', texto: 'No publicarlo' },
    ]);
    expect(d.recomienda).toBe('lunes');
    expect(d.importancia).toBe('alta');
  });

  it('keeps a yes-or-no file as it was', () => {
    const d = readDecision('seo-x', `${FILE}recomienda: Cambiarlo\n`);
    expect(d.opciones).toBeUndefined();
    expect(d.recomienda).toBe('Cambiarlo');
  });

  it('refuses a pick that is not an option, one option, or a repeated id', () => {
    expect(() => readDecision('seo-x', OPTIONS.replace('recomienda: lunes', 'recomienda: martes'))).toThrow(/recomienda/);
    expect(() => readDecision('seo-x', `${FILE}opciones:\n  - id: a\n    texto: A\nrecomienda: a\n`)).toThrow(/2 or 3/);
    expect(() => readDecision('seo-x', OPTIONS.replace('id: viernes', 'id: lunes'))).toThrow(/two options/);
    expect(() => readDecision('seo-x', OPTIONS.replace('importancia: alta', 'importancia: media'))).toThrow(/importancia/);
  });

  it('writes the option chosen, with ok only for the pick', () => {
    const y = writeAnswer(OPTIONS, 'seo-x', { decision: 'no', opcion: 'viernes', por: 'Álvaro', fecha: '2026-11-25 10:00' });
    expect(readDecision('seo-x', y).respuesta).toEqual({ decision: 'no', opcion: 'viernes', por: 'Álvaro', fecha: '2026-11-25 10:00' });
    expect(() => writeAnswer(OPTIONS, 'seo-x', { decision: 'ok', opcion: 'viernes', por: 'Á', fecha: '2026-11-25 10:00' })).toThrow(/recommended/);
    expect(() => writeAnswer(OPTIONS, 'seo-x', { decision: 'no', opcion: 'martes', por: 'Á', fecha: '2026-11-25 10:00' })).toThrow(/options/);
  });
});
