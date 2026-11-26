import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AgentRepo } from '@ghostaff/shared/record';
import { parse } from 'yaml';

// Órdago's agents as Ghostaff agents (docs/plans/ongoing/ordago-agents-in-ghostaff.md,
// step 2): each `proyectos/<proyecto>/agentes/<agente>.yaml` of ghostaff-ai/agents
// becomes a row in `agents` that runs as its job (`ordago_job`), with the
// department and ghost Álvaro chose (2026-11-21). With `runner: 'ghostaff'`
// (step 5) it runs on Ghostaff's own runner instead, with its task, model,
// tools, turns and timetable copied from its yaml. Worked out without the
// database, so it can be tested.

/** Álvaro, 2026-11-21: five departments; `prueba` stays out. */
const PLACES: Record<string, { name: string; ghost: string; department: string }> = {
  direccion: { name: 'Dirección', ghost: 'base', department: 'direccion' },
  correo: { name: 'Correo', ghost: 'secretaria', department: 'direccion' },
  finanzas: { name: 'Finanzas', ghost: 'finanzas', department: 'finanzas' },
  legal: { name: 'Legal', ghost: 'base', department: 'legal' },
  producto: { name: 'Producto', ghost: 'base', department: 'producto' },
  desarrollo: { name: 'Desarrollo', ghost: 'base', department: 'producto' },
  comercial: { name: 'Comercial', ghost: 'base', department: 'marketing' },
  organico: { name: 'Orgánico', ghost: 'redes', department: 'marketing' },
  seo: { name: 'SEO', ghost: 'redes', department: 'marketing' },
  productor: { name: 'Productor', ghost: 'productor', department: 'marketing' },
  lamesa: { name: 'La Mesa', ghost: 'productor', department: 'marketing' },
};

export const LEFT_OUT = new Set(['prueba']);

interface ImportedBase {
  slug: string;
  name: string;
  ghost: string;
  department: string;
  description: string | null;
  schedule: string | null;
}

/** Still its job in Órdago's project (step 2). */
export interface ImportedJobAgent extends ImportedBase {
  runner: 'ordago_job';
  job_project: string;
  job_region: string;
  job_name: string;
  job_identity: string;
}

/** On Ghostaff's own runner (step 5): its task, model, tools and turns from its yaml; no job. */
export interface ImportedRunnerAgent extends ImportedBase {
  runner: 'ghostaff';
  task: string;
  model: string;
  tools: string[];
  max_turns: number;
  /**
   * Its yaml's `repos` besides the record (the project's `cerebro`): read-only, unless named in `--writes`
   * (pushes to any branch but `main` and `beta`) or in its `push_a_main` (`main` too).
   */
  repos: AgentRepo[];
  /**
   * Whether its runs read the other agents' runs (Ghostaff's transcripts): when its yaml's `gcp` granted it the
   * project's transcripts bucket, as Dirección's does for its weekly review.
   */
  reads_org_runs: boolean;
  job_project: null;
  job_region: null;
  job_name: null;
  job_identity: null;
}

export type ImportedAgent = ImportedJobAgent | ImportedRunnerAgent;

export interface ImportOptions {
  /** `ghostaff`: the agents imported run on our runner instead of their job. */
  runner?: 'ghostaff';
  /** Only these slugs. */
  only?: string[];
  /**
   * Repos these agents may push to (not `main` or `beta`): the yamls don't say, since the old jobs could
   * write every repo they cloned, so whoever moves them names it (SEO and Producto push to `ordago-apps`).
   */
  writes?: string[];
  /** No timetable: they run only when someone writes to them (while their old job keeps the timetable). */
  onDemand?: boolean;
}

type AgentYaml = {
  descripcion?: string;
  horario?: string;
  prompt?: string;
  modelo?: string;
  herramientas?: unknown;
  max_turnos?: number;
  repos?: unknown;
  push_a_main?: unknown;
  gcp?: unknown;
};

type ProjectYaml = { cerebro?: string; gcp?: { proyecto?: string; region?: string; bucket_transcripciones?: string } };

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((t): t is string => typeof t === 'string') : []);

/** The repos it clones besides the record: read-only unless named in `writes`, or in its `push_a_main` (main too). */
function otherRepos(a: AgentYaml, record: string, writes: string[]): AgentRepo[] {
  const toMain = new Set(strings(a.push_a_main).map((r) => r.toLowerCase()));
  const write = new Set(writes.map((r) => r.toLowerCase()));
  return [...new Set(strings(a.repos))]
    .filter((r) => r.toLowerCase() !== record.toLowerCase())
    .map((repo) => {
      const main = toMain.has(repo.toLowerCase());
      return main ? { repo, write: true, main: true } : { repo, write: write.has(repo.toLowerCase()) };
    });
}

/** Whether the agent's yaml grants it the project's transcripts bucket: in the old system, reading the other agents' runs. */
function readsTranscripts(a: AgentYaml, bucket: string | undefined): boolean {
  if (!bucket || !Array.isArray(a.gcp)) return false;
  return a.gcp.some((g: { recursos?: unknown }) => strings(g?.recursos).includes(`bucket:${bucket}`));
}

function onOurRunner(
  slug: string,
  a: AgentYaml,
  conf: ProjectYaml,
  writes: string[],
): Pick<ImportedRunnerAgent, 'task' | 'model' | 'tools' | 'max_turns' | 'repos' | 'reads_org_runs'> {
  const record = conf.cerebro ?? '';
  const tools = Array.isArray(a.herramientas) ? a.herramientas.filter((t): t is string => typeof t === 'string') : [];
  if (typeof a.prompt !== 'string' || !a.prompt.trim()) throw new Error(`${slug}.yaml has no prompt`);
  if (typeof a.modelo !== 'string' || !a.modelo) throw new Error(`${slug}.yaml has no modelo`);
  if (tools.length === 0) throw new Error(`${slug}.yaml has no herramientas`);
  return {
    task: a.prompt.trim(),
    model: a.modelo,
    tools,
    max_turns: Number.isInteger(a.max_turnos) && a.max_turnos! > 0 ? a.max_turnos! : 100,
    repos: otherRepos(a, record, writes),
    reads_org_runs: readsTranscripts(a, conf.gcp?.bucket_transcripciones),
  };
}

/** «dice qué dice la ley…» → «Dice qué dice la ley…», on one line. */
function sentence(s: unknown): string | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const t = s.replace(/\s+/g, ' ').trim().slice(0, 1000);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The agents of one project folder (`…/agents/proyectos/ordago`). */
export function readProjectAgents(projectDir: string, opts: ImportOptions = {}): ImportedAgent[] {
  const project = basename(projectDir);
  const conf = parse(readFileSync(join(projectDir, 'proyecto.yaml'), 'utf8')) as ProjectYaml;
  const gcp = conf.gcp?.proyecto;
  const region = conf.gcp?.region;
  if (!gcp || !region) throw new Error(`${projectDir}/proyecto.yaml has no gcp.proyecto and gcp.region`);
  const dir = join(projectDir, 'agentes');
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => f.slice(0, -'.yaml'.length))
    .filter((slug) => !LEFT_OUT.has(slug) && (!opts.only || opts.only.includes(slug)))
    .sort()
    .map((slug): ImportedAgent => {
      const a = parse(readFileSync(join(dir, `${slug}.yaml`), 'utf8')) as AgentYaml;
      const place = PLACES[slug] ?? { name: slug.charAt(0).toUpperCase() + slug.slice(1), ghost: 'base', department: 'direccion' };
      const base = { slug, ...place, description: sentence(a.descripcion), schedule: !opts.onDemand && typeof a.horario === 'string' ? a.horario : null };
      if (opts.runner === 'ghostaff') {
        return { ...base, runner: 'ghostaff', ...onOurRunner(slug, a, conf, opts.writes ?? []), job_project: null, job_region: null, job_name: null, job_identity: null };
      }
      const job = `${project}-${slug}`;
      return {
        ...base,
        runner: 'ordago_job' as const,
        job_project: gcp,
        job_region: region,
        job_name: job,
        job_identity: `${job}@${gcp}.iam.gserviceaccount.com`,
      };
    });
}
