import { describe, expect, it } from 'vitest';
import type { DecisionRow } from '@ghostaff/shared/services';
import { matchAgent } from '@ghostaff/shared/record';
import { planSync } from '../src/plan';

const yaml = (extra = '') => `area: seo
tipo: titulo-web
pregunta: ¿Cambio el título?
contexto: Porque sí.
propone: seo
creada: 2026-11-07
${extra}`;

const row = (over: Partial<DecisionRow> = {}): DecisionRow => ({
  id: 'row-1',
  org_id: 'org',
  record_id: 'seo-titulo',
  source_path: 'por-decidir/seo-titulo.yaml',
  area: 'seo',
  kind: 'titulo-web',
  question: '¿Cambio el título?',
  context: 'Porque sí.',
  proposed_by: 'seo',
  created_on: '2026-11-07',
  rule_proposal: null,
  recommendation: null,
  if_yes: null,
  if_no: null,
  quote: null,
  sources: [],
  due_on: null,
  options: [],
  recommended_option: null,
  high_stakes: false,
  agent_id: null,
  answer: null,
  answer_option: null,
  answered_by_name: null,
  answered_at: null,
  answer_note: null,
  answer_text: null,
  answer_source: null,
  written_back_at: null,
  closed_at: null,
  ...over,
});

const now = new Date('2026-11-12T10:00:00Z');

describe('planSync', () => {
  it('upserts every readable file of the record', () => {
    const plan = planSync({ orgId: 'org', files: [{ id: 'seo-titulo', yaml: yaml() }], existing: [], commit: 'abc', now });
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({ record_id: 'seo-titulo', kind: 'titulo-web', source_commit: 'abc', closed_at: null });
    expect(plan.upserts[0]).not.toHaveProperty('answer');
  });

  it('carries the optional parts the app lays out', () => {
    const extra = 'recomienda: Cambiarlo\ncon_si: Lo cambio.\ncon_no: Se queda.\ncita: 1.900 búsquedas\nfuentes:\n  - texto: Search Console\n    enlace: seo/datos.yaml\nvence: 2026-11-10\n';
    const plan = planSync({ orgId: 'org', files: [{ id: 'seo-titulo', yaml: yaml(extra) }], existing: [], commit: 'abc', now });
    expect(plan.upserts[0]).toMatchObject({
      recommendation: 'Cambiarlo', if_yes: 'Lo cambio.', if_no: 'Se queda.', quote: '1.900 búsquedas',
      sources: [{ text: 'Search Console', link: 'seo/datos.yaml' }], due_on: '2026-11-10',
    });
  });

  it('writes empty parts when the file has none', () => {
    const plan = planSync({ orgId: 'org', files: [{ id: 'seo-titulo', yaml: yaml() }], existing: [], commit: 'abc', now });
    expect(plan.upserts[0]).toMatchObject({ recommendation: null, sources: [], due_on: null });
  });

  it('closes a decision whose file the agent deleted', () => {
    const plan = planSync({ orgId: 'org', files: [], existing: [row()], commit: null, now });
    expect(plan.close).toEqual(['row-1']);
  });

  it('does not close a decision whose file is momentarily malformed', () => {
    const plan = planSync({ orgId: 'org', files: [{ id: 'seo-titulo', yaml: 'area: [' }], existing: [row()], commit: null, now });
    expect(plan.close).toEqual([]);
    expect(plan.invalid).toHaveLength(1);
  });

  it('takes an answer from the record', () => {
    const file = yaml('respuesta:\n  decision: no\n  por: Jaime\n  fecha: 2026-11-09 09:57\n');
    const [up] = planSync({ orgId: 'org', files: [{ id: 'seo-titulo', yaml: file }], existing: [row()], commit: null, now }).upserts;
    expect(up).toMatchObject({ answer: 'no', answered_by_name: 'Jaime', answered_at: '2026-11-09T08:57:00.000Z', answer_source: 'record' });
  });

  it('keeps an app answer and plans its write-back', () => {
    const existing = [row({ answer: 'ok', answered_by_name: 'Álvaro', answered_at: '2026-11-12T09:15:00Z', answer_note: 'vale', answer_source: 'app' })];
    const plan = planSync({ orgId: 'org', files: [{ id: 'seo-titulo', yaml: yaml() }], existing, commit: null, now });
    expect(plan.upserts[0]).not.toHaveProperty('answer');
    expect(plan.writeBacks).toEqual([
      { recordId: 'seo-titulo', rowId: 'row-1', answer: { decision: 'ok', por: 'Álvaro', fecha: '2026-11-12 10:15', nota: 'vale' } },
    ]);
  });

  it('lets the record win a conflict, and says so', () => {
    const existing = [row({ answer: 'ok', answered_by_name: 'Álvaro', answered_at: '2026-11-12T09:15:00Z', answer_source: 'app' })];
    const file = yaml('respuesta:\n  decision: no\n  por: Jaime\n  fecha: 2026-11-12 10:20\n');
    const plan = planSync({ orgId: 'org', files: [{ id: 'seo-titulo', yaml: file }], existing, commit: null, now });
    expect(plan.conflicts).toEqual([{ recordId: 'seo-titulo', app: 'ok', record: 'no' }]);
    expect(plan.upserts[0]).toMatchObject({ answer: 'no', answer_source: 'record' });
    expect(plan.writeBacks).toEqual([]);
  });
});

describe('options, stakes and the agent that asked', () => {
  const OPTIONS = yaml(`opciones:
  - id: lunes
    texto: El lunes
    con: Más visitas.
  - id: viernes
    texto: El viernes
recomienda: lunes
importancia: alta
`);
  const now = new Date('2026-11-25T10:00:00Z');
  const agents = [
    { id: 'a-seo', slug: 'seo', name: 'Posicionamiento', ghost: 'redes' },
    { id: 'a-fin', slug: null, name: 'Finanzas', ghost: 'finanzas' },
  ];

  it('carries the options, the pick, its words and the stakes', () => {
    const [up] = planSync({ orgId: 'org', files: [{ id: 'seo-titulo', yaml: OPTIONS }], existing: [], agents, commit: null, now }).upserts;
    expect(up?.options).toEqual([
      { id: 'lunes', text: 'El lunes', if: 'Más visitas.' },
      { id: 'viernes', text: 'El viernes' },
    ]);
    expect(up?.recommended_option).toBe('lunes');
    expect(up?.recommendation).toBe('El lunes');
    expect(up?.high_stakes).toBe(true);
    expect(up?.agent_id).toBe('a-seo');
  });

  it('matches propone by slug, then name, then a ghost only one agent has', () => {
    expect(matchAgent('seo', agents)).toBe('a-seo');
    expect(matchAgent('FINANZAS', agents)).toBe('a-fin');
    expect(matchAgent('redes', agents)).toBe('a-seo');
    expect(matchAgent('redes', [...agents, { id: 'x', slug: null, name: 'Otra', ghost: 'redes' }])).toBeNull();
    expect(matchAgent('nadie', agents)).toBeNull();
  });

  it('writes back the option chosen in the app', () => {
    const plan = planSync({
      orgId: 'org',
      files: [{ id: 'seo-titulo', yaml: OPTIONS }],
      existing: [row({ answer: 'no', answer_option: 'viernes', answered_by_name: 'Ana', answered_at: '2026-11-25T09:00:00Z', answer_source: 'app' })],
      commit: null,
      now,
    });
    expect(plan.writeBacks[0]?.answer).toMatchObject({ decision: 'no', opcion: 'viernes', por: 'Ana' });
  });

  it('reads the option from the record, or the pick for an ok', () => {
    const answered = (r: string) => planSync({ orgId: 'org', files: [{ id: 'seo-titulo', yaml: `${OPTIONS}respuesta:\n${r}` }], existing: [], commit: null, now }).upserts[0];
    expect(answered('  decision: no\n  opcion: viernes\n  por: Ana\n  fecha: 2026-11-25 10:00\n')?.answer_option).toBe('viernes');
    expect(answered('  decision: ok\n  por: Jaime\n  fecha: 2026-11-25 10:00\n')?.answer_option).toBe('lunes');
  });
});
