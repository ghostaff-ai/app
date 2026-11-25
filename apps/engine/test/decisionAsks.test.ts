import { readDecision } from '@ghostaff/shared/record';
import { describe, expect, it } from 'vitest';
import { briefOf, decisionFromInput, decisionLine, type DecisionOpener, proposeDecision } from '../src/decisionAsks';
import { toTurns } from '../src/chat';

const who = { propone: 'redes', area: 'Marketing', today: '2026-11-25' };

describe('pedir_decision', () => {
  it('builds a file the reader takes, with options and the pick by id', () => {
    const d = decisionFromInput(
      {
        pregunta: '¿Cuándo publico el roscón?',
        contexto: 'El lunes tuvo el doble.',
        tipo: 'Cuándo publicar',
        recomienda: 'lunes',
        opciones: [
          { id: 'lunes', texto: 'El lunes a las 9:00', con: 'Más visitas.' },
          { id: 'viernes', texto: 'El viernes' },
        ],
        importancia: 'alta',
        fuentes: ['Instagram, 2025'],
      },
      who,
    );
    expect(d).toMatchObject({ area: 'marketing', tipo: 'cuando-publicar', propone: 'redes', creada: '2026-11-25', recomienda: 'lunes', importancia: 'alta' });
    expect(d.opciones).toHaveLength(2);
  });

  it('refuses what the reader would refuse, in words the model can fix from', () => {
    expect(() => decisionFromInput({ pregunta: '¿X?', contexto: 'c', tipo: 't', recomienda: 'martes', opciones: [{ id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }] }, who)).toThrow(/recomienda/);
    expect(() => decisionFromInput({ contexto: 'c', tipo: 't', recomienda: 'Sí' }, who)).toThrow(/pregunta/);
  });

  it('opens it in the record and puts a card in the message', async () => {
    const opened: string[] = [];
    const opener: DecisionOpener = {
      async open(a) {
        const yaml = a.decision(a.base);
        readDecision(a.base, yaml);
        opened.push(a.base);
        return { decisionId: 'row-1', recordId: a.base };
      },
      briefs: async () => new Map(),
    };
    const r = await proposeDecision(opener, { orgId: 'o', agentId: 'a', ...who }, { pregunta: '¿Subo el pan?', contexto: 'c', tipo: 'precio', recomienda: 'Subirlo' }, []);
    expect(r.part).toEqual({ type: 'decision', decisionId: 'row-1', question: '¿Subo el pan?' });
    expect(r.outcome.isError).toBe(false);
    expect(opened).toEqual(['redes-subo-el-pan']);
  });

  it('says so when the organisation has no record yet', async () => {
    const opener: DecisionOpener = { open: async () => null, briefs: async () => new Map() };
    const r = await proposeDecision(opener, { orgId: 'o', agentId: 'a', ...who }, { pregunta: '¿X?', contexto: 'c', tipo: 't', recomienda: 'Sí' }, []);
    expect(r.outcome.isError).toBe(true);
    expect(r.part).toBeUndefined();
  });
});

describe('what the agent reads back', () => {
  const brief = briefOf({
    id: 'd1',
    question: '¿Cuándo publico?',
    recommendation: 'El lunes',
    options: [
      { id: 'viernes', text: 'El viernes' },
      { id: 'lunes', text: 'El lunes' },
    ],
    recommended_option: 'lunes',
    answer: 'no',
    answer_option: 'viernes',
    answered_by_name: 'Ana',
    answer_note: 'mejor antes',
    closed_at: null,
  });

  it('puts the pick first and the answer in words', () => {
    expect(brief.choices).toEqual(['El lunes', 'El viernes']);
    expect(decisionLine(brief, 'mine', '')).toBe('[Pedí decidir: «¿Cuándo publico?»; respondida: El viernes, por Ana («mejor antes»).]');
  });

  it('reads its own card and a quoted decision into the turns', () => {
    const turns = toTurns(
      [
        { id: 'm1', threadId: 't', authorKind: 'person', authorUserId: 'u', authorAgentId: null, authorName: 'Ana', parts: [{ type: 'text', text: 'Hola' }], state: 'done', steps: [], createdAt: '' },
        { id: 'm2', threadId: 't', authorKind: 'agent', authorUserId: null, authorAgentId: 'a', authorName: 'Redes', parts: [{ type: 'text', text: 'Te pregunto.' }, { type: 'decision', decisionId: 'd1', question: '¿Cuándo publico?' }], state: 'done', steps: [], createdAt: '' },
        { id: 'm3', threadId: 't', authorKind: 'person', authorUserId: 'u', authorAgentId: null, authorName: 'Ana', parts: [{ type: 'decision_quote', decisionId: 'd1', question: '¿Cuándo publico?' }, { type: 'text', text: '¿Por qué?' }], state: 'done', steps: [], createdAt: '' },
      ],
      'a',
      new Map([['d1', brief]]),
    );
    expect(turns[1]!.content).toContain('[Pedí decidir: «¿Cuándo publico?»; respondida: El viernes');
    expect(turns[2]!.content).toMatch(/^Ana: \[Pregunta sobre la decisión «¿Cuándo publico\?» \(respondida: El viernes.*\n\n¿Por qué\?$/s);
  });
});
