// `ghostaff`, the agent's command for its earlier runs (and, when its row allows it, its organisation's
// other agents'), in place of ghostaff-ai/agents' `agente.py ejecuciones / leer`:
//
//   ghostaff ejecuciones [agente] [-n 10]     the latest runs, newest first
//   ghostaff leer [agente | id] [--crudo]     a run as text (the latest with a transcript, by default)
//
// It asks the runner on 127.0.0.1 (GHOSTAFF_RUNS, pastRuns.ts), never the engine: it holds no credential.
// Run as the agent through a wrapper in the image: /usr/local/bin/ghostaff.

import { readableTranscript } from './lib';

interface Listed {
  id: string;
  agent: string;
  origin: 'person' | 'schedule' | 'routine';
  state: 'running' | 'done' | 'failed';
  startedAt: string;
  summary: string | null;
  transcript: boolean;
}

const ORIGIN: Record<Listed['origin'], string> = { person: 'pedida', schedule: 'horario', routine: 'tarea programada' };
const STATE: Record<Listed['state'], string> = { running: 'en curso', done: 'acabada', failed: 'falló' };
const RUN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USAGE = 'Uso:\n  ghostaff ejecuciones [agente] [-n 10]\n  ghostaff leer [agente | id] [--crudo]';

class CliError extends Error {}

async function get(path: string): Promise<Response> {
  const base = process.env.GHOSTAFF_RUNS;
  if (!base) throw new CliError('Esta ejecución no puede leer ejecuciones (falta GHOSTAFF_RUNS).');
  const r = await fetch(`${base}${path}`);
  if (r.ok) return r;
  const body = (await r.json().catch(() => null)) as { message?: string } | null;
  throw new CliError(body?.message ?? `No se ha podido (${r.status}).`);
}

const when = (iso: string) => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'short', timeStyle: 'short' });

/** One line per run: id, when (Madrid), why it ran, how it ended, and the start of what it said. */
export function listLines(runs: Listed[]): string[] {
  return runs.map((r) => {
    const said = (r.summary ?? '').replace(/\s+/g, ' ').trim();
    const short = said.length > 100 ? `${said.slice(0, 100)}…` : said;
    return [r.id, when(r.startedAt), ORIGIN[r.origin] ?? r.origin, STATE[r.state] ?? r.state, r.transcript ? '' : '(sin transcripción)', short]
      .filter(Boolean)
      .join('  ');
  });
}

async function listRuns(agent: string | undefined, n: number): Promise<{ agent: string; runs: Listed[] }> {
  const q = new URLSearchParams({ n: String(n), ...(agent ? { agent } : {}) });
  return (await (await get(`/runs?${q}`)).json()) as { agent: string; runs: Listed[] };
}

export async function main(argv: string[]): Promise<string> {
  const [command, ...rest] = argv;
  const raw = rest.includes('--crudo');
  const nAt = rest.indexOf('-n');
  const n = nAt >= 0 ? Number(rest[nAt + 1]) : 10;
  const args = rest.filter((a, i) => a !== '--crudo' && (nAt < 0 || (i !== nAt && i !== nAt + 1)));
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new CliError('-n va de 1 a 50.');
  if (command === 'ejecuciones') {
    const { agent, runs } = await listRuns(args[0], n);
    return runs.length ? listLines(runs).join('\n') : `${agent} no tiene ejecuciones guardadas.`;
  }
  if (command === 'leer') {
    let id = args[0] && RUN.test(args[0]) ? args[0] : null;
    if (!id) {
      const { agent, runs } = await listRuns(args[0], 50);
      id = runs.find((r) => r.transcript)?.id ?? null;
      if (!id) return `${agent} no tiene ninguna ejecución con transcripción guardada.`;
    }
    const text = await (await get(`/runs/${id}`)).text();
    return raw ? text.trimEnd() : `# Ejecución ${id}\n\n${readableTranscript(text.split('\n'))}`;
  }
  throw new CliError(USAGE);
}

if (process.argv[1] && /cli\.ts$/.test(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (out) => {
      process.stdout.write(`${out}\n`);
    },
    (e: unknown) => {
      process.stderr.write(`${e instanceof CliError ? e.message : `No se ha podido: ${e instanceof Error ? e.message : String(e)}`}\n`);
      process.exit(1);
    },
  );
}
