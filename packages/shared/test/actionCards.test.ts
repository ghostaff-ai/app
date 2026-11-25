import { describe, expect, it } from 'vitest';
import { ACTION_KIND } from '../src/models';
import { actionCardFromRow, sortInbox } from '../src/services';

const row = {
  id: 'a1',
  thread_id: 't1',
  agent_id: 'g1',
  agent_name: 'Redes',
  agent_ghost: 'redes',
  label: 'Publicar en Instagram',
  preview: 'texto: Hola',
  created_at: '2026-11-25T09:30:00Z',
};

describe('an OK card for an agent action', () => {
  it('reads as a yes-or-no card whose OK is «Aprobar», pointing at its action and conversation', () => {
    const c = actionCardFromRow(row, 'o1');
    expect(c).toMatchObject({
      id: 'a1',
      orgId: 'o1',
      kind: ACTION_KIND,
      question: 'Publicar en Instagram',
      context: 'texto: Hola',
      recommendation: 'Aprobar',
      createdOn: '2026-11-25',
      options: [],
      highStakes: false,
      agent: { id: 'g1', name: 'Redes', ghost: 'redes' },
      answer: null,
      action: { id: 'a1', threadId: 't1' },
    });
  });

  it('without its agent, still says who asked', () => {
    const c = actionCardFromRow({ ...row, agent_id: null, agent_name: null, agent_ghost: null }, 'o1');
    expect(c.agent).toBeNull();
    expect(c.proposedBy).toBe('agente');
  });

  it('sorts among the decisions by its day', () => {
    const c = actionCardFromRow(row, 'o1');
    const older = { ...c, id: 'd1', action: undefined, kind: 'precio', createdOn: '2026-11-20' };
    expect(sortInbox([older, c]).map((d) => d.id)).toEqual(['a1', 'd1']);
  });
});
