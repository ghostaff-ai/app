import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { main as cli } from '../src/cli';
import { agentEnv, CUT_EVENT, readableTranscript, redact, transcriptSink } from '../src/lib';
import { type AskEngine, servePastRuns } from '../src/pastRuns';

const RUN_A = '40000000-0000-0000-0000-00000000000a';
const RUN_B = '40000000-0000-0000-0000-00000000000b';

const assistant = (...content: unknown[]) => JSON.stringify({ type: 'assistant', message: { content } });
const result = (text: string, isError = false) => JSON.stringify({ type: 'result', is_error: isError, num_turns: 3, result: text });

describe('the run’s transcript', () => {
  it('keeps every line, as redacted as the logs', () => {
    const out: string[] = [];
    const sink = transcriptSink((t) => out.push(t));
    const secrets = ['sk-ant-oat-secreto-largo', 'ghs_tokendelregistro'];
    for (const l of [assistant({ type: 'text', text: 'token sk-ant-oat-secreto-largo' }), '', result('push con ghs_tokendelregistro')]) sink.line(redact(l, secrets));
    sink.end(redact(result('push con ghs_tokendelregistro'), secrets));
    const text = out.join('');
    expect(text.split('\n').filter(Boolean)).toHaveLength(2);
    expect(text).not.toContain('sk-ant-oat-secreto-largo');
    expect(text).not.toContain('ghs_tokendelregistro');
    expect(text).toContain('[secreto]');
  });

  it('past its size, says it was cut and keeps only how the run ended', () => {
    const out: string[] = [];
    const sink = transcriptSink((t) => out.push(t), 100);
    const first = assistant({ type: 'text', text: 'hola' });
    sink.line(first);
    sink.line(assistant({ type: 'text', text: 'x'.repeat(200) }));
    sink.line(assistant({ type: 'text', text: 'perdido' }));
    const last = result('Hecho.');
    sink.line(last);
    sink.end(last);
    const lines = out.join('').trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(first);
    expect(JSON.parse(lines[1]!)).toMatchObject({ type: CUT_EVENT, max: 100 });
    expect(lines[2]).toBe(last);
  });

  it('within its size, the final event is not written twice', () => {
    const out: string[] = [];
    const sink = transcriptSink((t) => out.push(t));
    const last = result('Hecho.');
    sink.line(last);
    sink.end(last);
    expect(out).toEqual([`${last}\n`]);
  });

  it('reads as what the agent said, the tools it used on what, and how it ended', () => {
    const text = readableTranscript([
      JSON.stringify({ type: 'system', subtype: 'init' }),
      assistant({ type: 'text', text: 'Miro el registro.' }, { type: 'tool_use', name: 'Bash', input: { command: 'git log --oneline\nsecond line' } }),
      assistant({ type: 'tool_use', name: 'Read', input: { file_path: 'x'.repeat(200) } }),
      'no es json',
      JSON.stringify({ type: CUT_EVENT, bytes: 1, max: 20 * 1024 * 1024 }),
      result('SIN NOVEDAD'),
    ]);
    expect(text).toContain('Miro el registro.\n  → Bash: git log --oneline\n  → Read: ');
    expect(text).toContain(`${'x'.repeat(160)}…`);
    expect(text).toContain('transcripción cortada: pasaba de 20 MB');
    expect(text).toContain('=== Acabó bien, en 3 turnos ===\nSIN NOVEDAD');
    expect(text).not.toContain('second line');
  });

  it('Claude Code is told where to ask for earlier runs, and nothing else of the runner’s', () => {
    const env = agentEnv('tok', '/home/agente', null, 'http://127.0.0.1:4321');
    expect(env.GHOSTAFF_RUNS).toBe('http://127.0.0.1:4321');
    expect(Object.keys(env).sort()).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'GHOSTAFF_RUNS', 'HOME', 'LANG', 'PATH']);
  });
});

describe('earlier runs, through the runner (pastRuns.ts) and the agent’s command (cli.ts)', () => {
  const closers: (() => void)[] = [];
  afterEach(() => {
    while (closers.length) closers.pop()!();
    delete process.env.GHOSTAFF_RUNS;
  });

  /** The runner's local server over a fake engine; what it asked the engine is in `asked`. */
  async function serve(engine: AskEngine) {
    const asked: [string, Record<string, unknown>][] = [];
    const errors: unknown[] = [];
    const s = await servePastRuns(
      async (path, body) => {
        asked.push([path, body]);
        return engine(path, body);
      },
      (e) => errors.push(e),
    );
    closers.push(s.close);
    process.env.GHOSTAFF_RUNS = s.url;
    return { ...s, asked, errors };
  }

  const listed = (agent: string) => ({
    agent,
    runs: [
      { id: RUN_B, agent, origin: 'schedule', state: 'running', startedAt: '2026-11-30T09:00:00Z', finishedAt: null, summary: null, transcript: false },
      { id: RUN_A, agent, origin: 'person', state: 'done', startedAt: '2026-11-23T09:00:00Z', finishedAt: '2026-11-23T09:05:00Z', summary: 'SEO subió\nun 4 %.', transcript: true },
    ],
  });
  const engine: AskEngine = async (path, body) => {
    if (path === '/past-runs') {
      if (body.agent === 'taller') return Response.json({ error: 'no_agent', message: 'no agent «taller» here' }, { status: 404 });
      return Response.json(listed((body.agent as string) ?? 'direccion'));
    }
    if (path === `/past-runs/${RUN_A}`) {
      return new Response(gzipSync(`${assistant({ type: 'text', text: 'Revisé el tráfico.' })}\n${result('SEO subió un 4 %.')}\n`), {
        headers: { 'Content-Type': 'application/gzip' },
      });
    }
    return Response.json({ error: 'not_allowed', message: 'solo puedes leer tus propias ejecuciones' }, { status: 403 });
  };

  it('lists an agent’s runs: the runner asks the engine, the agent never holds the nonce', async () => {
    const s = await serve(engine);
    const out = await cli(['ejecuciones', 'seo', '-n', '5']);
    expect(s.asked).toEqual([['/past-runs', { agent: 'seo', limit: 5 }]]);
    const lines = out.split('\n');
    expect(lines[0]).toContain(RUN_B);
    expect(lines[0]).toContain('horario  en curso  (sin transcripción)');
    expect(lines[1]).toContain('pedida  acabada  SEO subió un 4 %.');
    // Its own, without naming an agent.
    await cli(['ejecuciones']);
    expect(s.asked.at(-1)).toEqual(['/past-runs', { limit: 10 }]);
  });

  it('reads the latest run with a transcript, as text or raw', async () => {
    const s = await serve(engine);
    const text = await cli(['leer', 'seo']);
    expect(s.asked).toEqual([
      ['/past-runs', { agent: 'seo', limit: 50 }],
      [`/past-runs/${RUN_A}`, {}],
    ]);
    expect(text).toBe(`# Ejecución ${RUN_A}\n\nRevisé el tráfico.\n\n=== Acabó bien, en 3 turnos ===\nSEO subió un 4 %.`);
    const raw = await cli(['leer', RUN_A, '--crudo']);
    expect(raw.split('\n').map((l) => JSON.parse(l).type)).toEqual(['assistant', 'result']);
  });

  it('says what the engine refused, in its words', async () => {
    await serve(engine);
    await expect(cli(['leer', RUN_B])).rejects.toThrow('solo puedes leer tus propias ejecuciones');
    await expect(cli(['ejecuciones', 'taller'])).rejects.toThrow('no agent «taller» here');
    await expect(cli(['ejecuciones', '-n', '99'])).rejects.toThrow('-n va de 1 a 50');
    await expect(cli(['otra'])).rejects.toThrow('Uso:');
  });

  it('forwards nothing it cannot check: a bad slug, number or run id never reaches the engine', async () => {
    const s = await serve(engine);
    for (const path of ['/runs?agent=../x', '/runs?n=1e3', '/runs/../../spec', '/runs/not-a-run', '/spec']) {
      expect((await fetch(`${s.url}${path}`)).status, path).toBeGreaterThanOrEqual(400);
    }
    expect((await fetch(`${s.url}/runs`, { method: 'POST' })).status).toBe(405);
    expect(s.asked).toEqual([]);
  });

  it('without the runner’s address, says it cannot read runs', async () => {
    await expect(cli(['ejecuciones'])).rejects.toThrow('GHOSTAFF_RUNS');
  });
});
