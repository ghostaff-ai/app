import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readProjectAgents } from '../src/agents';

function project() {
  const dir = join(mkdtempSync(join(tmpdir(), 'agents-')), 'ordago');
  mkdirSync(join(dir, 'agentes'), { recursive: true });
  writeFileSync(join(dir, 'proyecto.yaml'), 'cerebro: ordago-app/business\ngcp:\n  proyecto: ordago-agents\n  region: europe-west1\n  bucket_transcripciones: ordago-agents-transcripciones\n');
  writeFileSync(
    join(dir, 'agentes', 'legal.yaml'),
    'descripcion: >-\n  dice qué dice la ley\n  de lo que hace Órdago.\nhorario: "0 9 15 1 *"\nmodelo: claude-opus-5-5\n' +
      'herramientas: [Bash, Read, WebSearch]\nmax_turnos: 200\nprompt: |\n  Eres el agente legal de Órdago.\n  Revisa la ley.\n',
  );
  writeFileSync(
    join(dir, 'agentes', 'organico.yaml'),
    'modelo: claude-opus-5-5\nherramientas: [Bash]\nprompt: Publica reels.\n' +
      'repos:\n  - ordago-app/business\n  - ordago-app/ordago-apps\n  - ordago-app/ordago-reels\n  - ordago-app/ordago-apps\npush_a_main:\n  - ordago-app/ordago-reels\n' +
      'secretos:\n  META_TOKEN: ordago-meta-token\n  ELEVENLABS_API_KEY: ordago-elevenlabs\n',
  );
  writeFileSync(
    join(dir, 'agentes', 'direccion.yaml'),
    'modelo: claude-opus-5-5\nherramientas: [Bash]\nprompt: Coordina.\n' +
      'gcp:\n  - recursos: [proyecto:ordago-agents]\n    roles: [roles/bigquery.jobUser]\n' +
      '  - recursos: [bucket:ordago-agents-transcripciones]\n    roles: [roles/storage.objectViewer]\n',
  );
  writeFileSync(join(dir, 'agentes', 'desarrollo.yaml'), 'descripcion: hace de noche el trabajo objetivo\n');
  writeFileSync(join(dir, 'agentes', 'prueba.yaml'), 'descripcion: x\n');
  writeFileSync(
    join(dir, 'agentes', 'nocturno.yaml'),
    'modelo: claude-opus-5-5\nprompt: Abre PRs de noche.\nhorario: "0 2-5 * * *"\n' +
      'herramientas: [Bash, Read, Edit, Agent, WebFetch, "WebSearch(ordago)"]\nprohibidas: [WebFetch, WebSearch]\n' +
      'ritmo:\n  max_ejecuciones_por_dia: 3\n  repo_ci: ordago-app/ordago-apps\n  max_ci_en_cola: 4\n' +
      'recursos:\n  cpu: "4"\n  memoria: 16Gi\n  timeout: 10800s\n  reintentos: 0\n',
  );
  writeFileSync(join(dir, 'agentes', 'nuevo.yaml'), 'descripcion: algo nuevo\n');
  return dir;
}

describe('readProjectAgents', () => {
  it('turns each agent file into a job agent, in the department Álvaro chose', () => {
    const agents = readProjectAgents(project());
    expect(agents.map((a) => a.slug)).toEqual(['desarrollo', 'direccion', 'legal', 'nocturno', 'nuevo', 'organico']);
    expect(agents[2]).toEqual({
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
    expect(agents[4]).toMatchObject({ name: 'Nuevo', department: 'direccion', ghost: 'base' });
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
        reads_org_runs: false,
        timeout_seconds: 3600,
        size: 'standard',
        max_runs_per_day: null,
        ci_repo: null,
        max_ci_queued: null,
        secrets: {},
        job_project: null,
        job_region: null,
        job_name: null,
        job_identity: null,
      },
    ]);
  });

  it('takes its other repos from its yaml, without the record, once each, read-only unless its job pushed to main there', () => {
    const [organico] = readProjectAgents(project(), { runner: 'ghostaff', only: ['organico'] });
    expect(organico).toMatchObject({
      runner: 'ghostaff',
      max_turns: 100,
      repos: [
        { repo: 'ordago-app/ordago-apps', write: false },
        { repo: 'ordago-app/ordago-reels', write: true, main: true },
      ],
    });
  });

  it('lets an agent read the other agents’ runs only when its yaml granted it the transcripts bucket (Dirección)', () => {
    const agents = readProjectAgents(project(), { runner: 'ghostaff', only: ['direccion', 'organico'] });
    expect(agents.map((a) => [a.slug, 'reads_org_runs' in a && a.reads_org_runs])).toEqual([
      ['direccion', true],
      ['organico', false],
    ]);
  });

  it('may write a repo whoever moves it names, never its main unless its yaml says push_a_main', () => {
    const [organico] = readProjectAgents(project(), { runner: 'ghostaff', only: ['organico'], writes: ['Ordago-App/ordago-apps'] });
    expect(organico).toMatchObject({
      repos: [
        { repo: 'ordago-app/ordago-apps', write: true },
        { repo: 'ordago-app/ordago-reels', write: true, main: true },
      ],
    });
    expect((organico as { repos: { main?: boolean }[] }).repos[0]!.main).toBeUndefined();
  });

  it('takes its secrets from its yaml, each the organisation’s secret named without the project’s prefix', () => {
    const [organico] = readProjectAgents(project(), { runner: 'ghostaff', only: ['organico'] });
    expect(organico).toMatchObject({ secrets: { META_TOKEN: 'meta-token', ELEVENLABS_API_KEY: 'elevenlabs' } });
  });

  it('refuses a secret our runner would not give: a variable it relies on, or a name the vault cannot hold', () => {
    const dir = project();
    const yaml = (secretos: string) =>
      writeFileSync(join(dir, 'agentes', 'correo.yaml'), `modelo: claude-opus-5-5\nherramientas: [Bash]\nprompt: Lee el correo.\nsecretos:\n${secretos}`);
    yaml('  CORREO_INFO_PASSWORD: ordago-correo-info\n');
    expect(readProjectAgents(dir, { runner: 'ghostaff', only: ['correo'] })[0]).toMatchObject({ secrets: { CORREO_INFO_PASSWORD: 'correo-info' } });
    yaml('  CLAUDE_CODE_OAUTH_TOKEN: ordago-correo-info\n');
    expect(() => readProjectAgents(dir, { runner: 'ghostaff', only: ['correo'] })).toThrow(/CLAUDE_CODE_OAUTH_TOKEN/);
    yaml('  CORREO_INFO_PASSWORD: Ordago_Correo\n');
    expect(() => readProjectAgents(dir, { runner: 'ghostaff', only: ['correo'] })).toThrow(/Ordago_Correo/);
  });

  it('refuses to move an agent whose yaml lacks what our runner needs', () => {
    expect(() => readProjectAgents(project(), { runner: 'ghostaff', only: ['desarrollo'] })).toThrow(/prompt/);
  });

  it('on demand, it gets no timetable: its old job keeps it', () => {
    const [legal] = readProjectAgents(project(), { runner: 'ghostaff', only: ['legal'], onDemand: true });
    expect(legal).toMatchObject({ slug: 'legal', runner: 'ghostaff', schedule: null });
  });

  it('carries its legacy limits: timeout and size from recursos, its ritmo, and its tools without the forbidden ones', () => {
    const [nocturno] = readProjectAgents(project(), { runner: 'ghostaff', only: ['nocturno'] });
    expect(nocturno).toMatchObject({
      tools: ['Bash', 'Read', 'Edit', 'Agent'],
      timeout_seconds: 10_800,
      size: 'large',
      max_runs_per_day: 3,
      ci_repo: 'ordago-app/ordago-apps',
      max_ci_queued: 4,
    });
    expect(nocturno).not.toHaveProperty('reintentos');
  });

  it('sizes an agent by the smallest job that holds what it asked for', () => {
    const sized = (recursos: string) => {
      const dir = project();
      writeFileSync(join(dir, 'agentes', 'x.yaml'), `modelo: m\nprompt: p\nherramientas: [Read]\nrecursos:\n${recursos}`);
      return readProjectAgents(dir, { runner: 'ghostaff', only: ['x'] })[0]!;
    };
    expect(sized('  cpu: "1"\n  memoria: 2Gi\n  timeout: 900s\n')).toMatchObject({ size: 'standard', timeout_seconds: 900 });
    expect(sized('  cpu: "2"\n  memoria: 4Gi\n  timeout: 3600s\n')).toMatchObject({ size: 'standard' });
    expect(sized('  cpu: "4"\n  memoria: 8Gi\n  timeout: 3600s\n')).toMatchObject({ size: 'large' });
    expect(sized('  cpu: "2"\n  memoria: 512Mi\n  timeout: 60s\n')).toMatchObject({ size: 'standard', timeout_seconds: 60 });
    expect(() => sized('  cpu: "8"\n  memoria: 32Gi\n  timeout: 3600s\n')).toThrow(/largest job/);
    expect(() => sized('  cpu: "2"\n  memoria: 4Gi\n  timeout: 4h\n')).toThrow(/recursos.timeout/);
    expect(() => sized('  cpu: "2"\n  memoria: 4Gi\n  timeout: 10801s\n')).toThrow(/recursos.timeout/);
  });

  it('refuses a ritmo it cannot hold: no cap, or half a CI rule', () => {
    const withRitmo = (ritmo: string) => {
      const dir = project();
      writeFileSync(join(dir, 'agentes', 'x.yaml'), `modelo: m\nprompt: p\nherramientas: [Read]\nritmo:\n${ritmo}`);
      return () => readProjectAgents(dir, { runner: 'ghostaff', only: ['x'] });
    };
    expect(withRitmo('  max_ejecuciones_por_dia: 0\n')).toThrow(/max_ejecuciones_por_dia/);
    expect(withRitmo('  max_ejecuciones_por_dia: 2\n  repo_ci: ordago-app/ordago-apps\n')).toThrow(/repo_ci/);
    expect(withRitmo('  max_ejecuciones_por_dia: 2\n')()[0]).toMatchObject({ max_runs_per_day: 2, ci_repo: null, max_ci_queued: null });
  });
});
