import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProjectAgents } from '../src/agents';

function project() {
  const dir = join(mkdtempSync(join(tmpdir(), 'agents-')), 'ordago');
  mkdirSync(join(dir, 'agentes'), { recursive: true });
  writeFileSync(join(dir, 'proyecto.yaml'), 'cerebro: ordago-app/business\ngcp:\n  proyecto: ordago-agents\n  region: europe-west1\n');
  writeFileSync(
    join(dir, 'agentes', 'legal.yaml'),
    'descripcion: >-\n  dice qué dice la ley\n  de lo que hace Órdago.\nhorario: "0 9 15 1 *"\nmodelo: claude-opus-5-5\n' +
      'herramientas: [Bash, Read, WebSearch]\nmax_turnos: 200\nprompt: |\n  Eres el agente legal de Órdago.\n  Revisa la ley.\n',
  );
  writeFileSync(
    join(dir, 'agentes', 'organico.yaml'),
    'modelo: claude-opus-5-5\nherramientas: [Bash]\nprompt: Publica reels.\n' +
      'repos:\n  - ordago-app/business\n  - ordago-app/ordago-apps\n  - ordago-app/ordago-reels\n  - ordago-app/ordago-apps\npush_a_main:\n  - ordago-app/ordago-reels\n',
  );
  writeFileSync(join(dir, 'agentes', 'desarrollo.yaml'), 'descripcion: hace de noche el trabajo objetivo\n');
  writeFileSync(join(dir, 'agentes', 'prueba.yaml'), 'descripcion: x\n');
  writeFileSync(join(dir, 'agentes', 'nuevo.yaml'), 'descripcion: algo nuevo\n');
  return dir;
}

describe('readProjectAgents', () => {
  it('turns each agent file into a job agent, in the department Álvaro chose', () => {
    const agents = readProjectAgents(project());
    expect(agents.map((a) => a.slug)).toEqual(['desarrollo', 'legal', 'nuevo', 'organico']);
    expect(agents[1]).toEqual({
      slug: 'legal',
      name: 'Legal',
      ghost: 'base',
      department: 'legal',
      description: 'Dice qué dice la ley de lo que hace Órdago.',
      schedule: '0 9 15 1 *',
      runner: 'ordago_job',
      job_project: 'ordago-agents',
      job_region: 'europe-west1',
      job_name: 'ordago-legal',
      job_identity: 'ordago-legal@ordago-agents.iam.gserviceaccount.com',
    });
    expect(agents[0]).toMatchObject({ department: 'producto', schedule: null });
    expect(agents[2]).toMatchObject({ name: 'Nuevo', department: 'direccion', ghost: 'base' });
  });

  it('with runner ghostaff and only legal, moves Legal onto our runner with its task, model, tools, turns and timetable', () => {
    const agents = readProjectAgents(project(), { runner: 'ghostaff', only: ['legal'] });
    expect(agents).toEqual([
      {
        slug: 'legal',
        name: 'Legal',
        ghost: 'base',
        department: 'legal',
        description: 'Dice qué dice la ley de lo que hace Órdago.',
        schedule: '0 9 15 1 *',
        runner: 'ghostaff',
        task: 'Eres el agente legal de Órdago.\nRevisa la ley.',
        model: 'claude-opus-5-5',
        tools: ['Bash', 'Read', 'WebSearch'],
        max_turns: 200,
        repos: [],
        job_project: null,
        job_region: null,
        job_name: null,
        job_identity: null,
      },
    ]);
  });

  it('takes its other repos from its yaml, without the record, once each, writable only where its job pushed to main', () => {
    const [organico] = readProjectAgents(project(), { runner: 'ghostaff', only: ['organico'] });
    expect(organico).toMatchObject({
      runner: 'ghostaff',
      max_turns: 100,
      repos: [
        { repo: 'ordago-app/ordago-apps', write: false },
        { repo: 'ordago-app/ordago-reels', write: true },
      ],
    });
  });

  it('refuses to move an agent whose yaml lacks what our runner needs', () => {
    expect(() => readProjectAgents(project(), { runner: 'ghostaff', only: ['desarrollo'] })).toThrow(/prompt/);
  });

  it('on demand, it gets no timetable: its old job keeps it', () => {
    const [legal] = readProjectAgents(project(), { runner: 'ghostaff', only: ['legal'], onDemand: true });
    expect(legal).toMatchObject({ slug: 'legal', runner: 'ghostaff', schedule: null });
  });
});
